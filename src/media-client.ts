import type { Backend, ChatMessage, EngineProgress, MediaRequest, MediaResponse, ModelDescriptor } from './types';

interface MediaPending {
  resolve(value: unknown): void;
  reject(reason: Error): void;
  onProgress?: (progress: EngineProgress) => void;
}

export interface MediaEngine {
  initialize(model: ModelDescriptor, backend: Backend, onProgress?: (progress: EngineProgress) => void): Promise<void>;
  transcribe(audio: Float32Array, sampleRate: number, backend: Backend, onProgress?: (progress: EngineProgress) => void): Promise<string>;
  speak(text: string, backend: Backend, onProgress?: (progress: EngineProgress) => void): Promise<{ samples: Float32Array; sampleRate: number }>;
  converseAudio(audio: Float32Array, sampleRate: number, prompt: string, backend: Backend, onProgress?: (progress: EngineProgress) => void): Promise<{ text: string; samples: Float32Array; sampleRate: number }>;
  analyzeImage(image: string, messages: ChatMessage[], model: ModelDescriptor, backend: Backend, onProgress?: (progress: EngineProgress) => void): Promise<string>;
  cancel(): void;
  dispose(): Promise<void>;
}

export class MediaClient implements MediaEngine {
  #worker: Worker | null = null;
  #pending = new Map<string, MediaPending>();

  #ensureWorker(): Worker {
    if (this.#worker) return this.#worker;
    this.#worker = new Worker(new URL('./media-worker.ts', import.meta.url), { type: 'module' });
    this.#worker.addEventListener('message', (event: MessageEvent<MediaResponse>) => this.#onMessage(event.data));
    this.#worker.addEventListener('error', (event) => {
      const error = new Error(event.message || 'The optional media worker stopped unexpectedly.');
      for (const pending of this.#pending.values()) pending.reject(error);
      this.#pending.clear();
      this.#worker?.terminate();
      this.#worker = null;
    });
    return this.#worker;
  }

  #onMessage(message: MediaResponse): void {
    const pending = this.#pending.get(message.requestId);
    if (!pending) return;
    if (message.type === 'progress') {
      pending.onProgress?.(message.progress);
      return;
    }
    if (message.type === 'error') pending.reject(new Error(message.message));
    else if (message.type === 'transcription' || message.type === 'vision') pending.resolve(message.text);
    else if (message.type === 'audio') pending.resolve({ samples: message.samples, sampleRate: message.sampleRate });
    else if (message.type === 'audioConversation') pending.resolve({ text: message.text, samples: message.samples, sampleRate: message.sampleRate });
    else pending.resolve(undefined);
    this.#pending.delete(message.requestId);
  }

  initialize(model: ModelDescriptor, backend: Backend, onProgress?: (progress: EngineProgress) => void): Promise<void> {
    return this.#post({ type: 'loadModel', requestId: crypto.randomUUID(), model, backend }, [], onProgress);
  }

  #post<T>(message: MediaRequest, transfer: Transferable[] = [], onProgress?: (progress: EngineProgress) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(message.requestId, { resolve: resolve as (value: unknown) => void, reject, onProgress });
      this.#ensureWorker().postMessage(message, transfer);
    });
  }

  transcribe(audio: Float32Array, sampleRate: number, backend: Backend, onProgress?: (progress: EngineProgress) => void): Promise<string> {
    const id = crypto.randomUUID();
    return this.#post<string>({ type: 'transcribe', requestId: id, audio, sampleRate, backend }, [audio.buffer], onProgress);
  }

  speak(text: string, backend: Backend, onProgress?: (progress: EngineProgress) => void): Promise<{ samples: Float32Array; sampleRate: number }> {
    const id = crypto.randomUUID();
    return this.#post({ type: 'speak', requestId: id, text, backend }, [], onProgress);
  }

  converseAudio(audio: Float32Array, sampleRate: number, prompt: string, backend: Backend, onProgress?: (progress: EngineProgress) => void): Promise<{ text: string; samples: Float32Array; sampleRate: number }> {
    return this.#post({ type: 'converseAudio', requestId: crypto.randomUUID(), audio, sampleRate, prompt, backend }, [audio.buffer], onProgress);
  }

  analyzeImage(image: string, messages: ChatMessage[], model: ModelDescriptor, backend: Backend, onProgress?: (progress: EngineProgress) => void): Promise<string> {
    const id = crypto.randomUUID();
    return this.#post({ type: 'analyzeImage', requestId: id, image, messages, model, backend }, [], onProgress);
  }

  cancel(): void {
    const error = new Error('Media model setup was cancelled.');
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    this.#worker?.terminate();
    this.#worker = null;
  }

  async dispose(): Promise<void> {
    if (!this.#worker) return;
    const id = crypto.randomUUID();
    await this.#post<void>({ type: 'dispose', requestId: id });
    this.#worker.terminate();
    this.#worker = null;
  }
}

export class MockMediaClient implements MediaEngine {
  async initialize(model: ModelDescriptor, _backend: Backend, onProgress?: (progress: EngineProgress) => void): Promise<void> {
    for (const percent of [18, 54, 100]) {
      onProgress?.({ status: percent === 100 ? 'warming' : 'downloading', loaded: model.downloadBytes * percent / 100, total: model.downloadBytes, percent, file: `${model.mode}.onnx` });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  async transcribe(_audio: Float32Array, _sampleRate: number, _backend: Backend): Promise<string> {
    return 'Mock local transcription';
  }

  async speak(_text: string, _backend: Backend): Promise<{ samples: Float32Array; sampleRate: number }> {
    return { samples: new Float32Array(160), sampleRate: 16_000 };
  }

  async converseAudio(_audio: Float32Array, _sampleRate: number, prompt: string, _backend: Backend): Promise<{ text: string; samples: Float32Array; sampleRate: number }> {
    return { text: `Mock local voice response to: ${prompt}`, samples: new Float32Array(2_400), sampleRate: 24_000 };
  }

  async analyzeImage(_image: string, messages: ChatMessage[], _model: ModelDescriptor, _backend: Backend, onProgress?: (progress: EngineProgress) => void): Promise<string> {
    for (const percent of [20, 65, 100]) {
      onProgress?.({
        status: percent === 100 ? 'warming' : 'downloading',
        loaded: percent,
        total: 100,
        percent,
        file: 'lfm2.5-vl.onnx'
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return `The LFM2.5 vision model directly analyzed the image for: ${messages.at(-1)?.content ?? 'Describe this image.'}`;
  }

  cancel(): void {}

  async dispose(): Promise<void> {}
}

export function createMediaClient(): MediaEngine {
  const mockRequested = import.meta.env.DEV
    && typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('mockMedia') === '1';
  return mockRequested ? new MockMediaClient() : new MediaClient();
}
