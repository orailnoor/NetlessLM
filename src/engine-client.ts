import type {
  Backend,
  ChatMessage,
  EngineProgress,
  ModelDescriptor,
  WorkerRequest,
  WorkerResponse
} from './types';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  onProgress?: (progress: EngineProgress) => void;
  onToken?: (text: string, tokenCount: number, elapsedMs: number) => void;
}

export interface GenerationResult {
  text: string;
  tokenCount: number;
  elapsedMs: number;
  cancelled: boolean;
}

export interface TextEngine {
  initialize(model: ModelDescriptor, backend: Backend, onProgress?: (progress: EngineProgress) => void): Promise<void>;
  generate(
    messages: ChatMessage[],
    maxNewTokens: number,
    onToken: (text: string, tokenCount: number, elapsedMs: number) => void
  ): Promise<GenerationResult>;
  cancel(): void;
  dispose(): Promise<void>;
}

function requestId(): string {
  return crypto.randomUUID();
}

export class WorkerTextEngine implements TextEngine {
  #worker: Worker | null = null;
  #pending = new Map<string, PendingRequest>();
  #activeGenerationId: string | null = null;
  #activeInitializeId: string | null = null;

  #ensureWorker(): Worker {
    if (this.#worker) return this.#worker;
    this.#worker = new Worker(new URL('./text-worker.ts', import.meta.url), { type: 'module' });
    this.#worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => this.#handleMessage(event.data));
    this.#worker.addEventListener('error', (event) => {
      const error = new Error(event.message || 'The local inference worker stopped unexpectedly.');
      for (const pending of this.#pending.values()) pending.reject(error);
      this.#pending.clear();
      this.#worker?.terminate();
      this.#worker = null;
    });
    return this.#worker;
  }

  #post<T>(message: WorkerRequest, pending: Omit<PendingRequest, 'resolve' | 'reject'> = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(message.requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        ...pending
      });
      this.#ensureWorker().postMessage(message);
    });
  }

  #handleMessage(message: WorkerResponse): void {
    const pending = this.#pending.get(message.requestId);
    if (!pending) return;
    if (message.type === 'progress') {
      pending.onProgress?.(message.progress);
      return;
    }
    if (message.type === 'token') {
      pending.onToken?.(message.text, message.tokenCount, message.elapsedMs);
      return;
    }
    if (message.type === 'error') {
      pending.reject(Object.assign(new Error(message.message), { code: message.code, recoverable: message.recoverable }));
    } else if (message.type === 'complete') {
      pending.resolve({
        text: message.text,
        tokenCount: message.tokenCount,
        elapsedMs: message.elapsedMs,
        cancelled: message.cancelled
      });
    } else {
      pending.resolve(undefined);
    }
    this.#pending.delete(message.requestId);
    if (message.requestId === this.#activeGenerationId) this.#activeGenerationId = null;
    if (message.requestId === this.#activeInitializeId) this.#activeInitializeId = null;
  }

  async initialize(model: ModelDescriptor, backend: Backend, onProgress?: (progress: EngineProgress) => void): Promise<void> {
    const bootstrapId = requestId();
    this.#activeInitializeId = bootstrapId;
    await this.#post<void>({ type: 'initialize', requestId: bootstrapId });
    const loadId = requestId();
    this.#activeInitializeId = loadId;
    await this.#post<void>({ type: 'loadModel', requestId: loadId, model, backend }, { onProgress });
  }

  async generate(
    messages: ChatMessage[],
    maxNewTokens: number,
    onToken: (text: string, tokenCount: number, elapsedMs: number) => void
  ): Promise<GenerationResult> {
    const id = requestId();
    this.#activeGenerationId = id;
    return this.#post<GenerationResult>(
      { type: 'generate', requestId: id, messages, maxNewTokens },
      { onToken }
    );
  }

  cancel(): void {
    if (!this.#worker) return;
    if (this.#activeGenerationId) {
      this.#worker.postMessage({ type: 'cancel', requestId: this.#activeGenerationId } satisfies WorkerRequest);
      return;
    }
    if (this.#activeInitializeId) {
      const error = Object.assign(new Error('Model setup was cancelled.'), { code: 'CANCELLED' });
      this.#pending.get(this.#activeInitializeId)?.reject(error);
      this.#pending.delete(this.#activeInitializeId);
      this.#activeInitializeId = null;
      this.#worker.terminate();
      this.#worker = null;
    }
  }

  async dispose(): Promise<void> {
    if (!this.#worker) return;
    const id = requestId();
    await this.#post<void>({ type: 'dispose', requestId: id });
    this.#worker.terminate();
    this.#worker = null;
  }
}

export class MockTextEngine implements TextEngine {
  #cancelled = false;

  async initialize(_model: ModelDescriptor, _backend: Backend, onProgress?: (progress: EngineProgress) => void): Promise<void> {
    for (const percent of [8, 38, 72, 100]) {
      onProgress?.({
        status: percent === 100 ? 'warming' : 'downloading',
        loaded: percent,
        total: 100,
        percent,
        file: percent === 100 ? 'Preparing model' : 'model_q4.onnx'
      });
      await new Promise((resolve) => setTimeout(resolve, 35));
    }
  }

  async generate(
    messages: ChatMessage[],
    _maxNewTokens: number,
    onToken: (text: string, tokenCount: number, elapsedMs: number) => void
  ): Promise<GenerationResult> {
    this.#cancelled = false;
    const prompt = messages.at(-1)?.content ?? '';
    const answer = `This is a private local response to: ${prompt}`;
    let text = '';
    const started = performance.now();
    let tokens = 0;
    for (const word of answer.split(' ')) {
      if (this.#cancelled) break;
      text += `${text ? ' ' : ''}${word}`;
      tokens += 1;
      onToken(text, tokens, performance.now() - started);
      await new Promise((resolve) => setTimeout(resolve, 18));
    }
    return { text, tokenCount: tokens, elapsedMs: performance.now() - started, cancelled: this.#cancelled };
  }

  cancel(): void {
    this.#cancelled = true;
  }

  async dispose(): Promise<void> {}
}

export function createTextEngine(): TextEngine {
  const mockRequested = import.meta.env.DEV && new URLSearchParams(location.search).get('mockEngine') === '1';
  return mockRequested ? new MockTextEngine() : new WorkerTextEngine();
}
