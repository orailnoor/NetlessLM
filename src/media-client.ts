import type { Backend, EngineProgress, MediaRequest, MediaResponse } from './types';

interface MediaPending {
  resolve(value: unknown): void;
  reject(reason: Error): void;
  onProgress?: (progress: EngineProgress) => void;
}

export interface MediaEngine {
  transcribe(audio: Float32Array, sampleRate: number, backend: Backend, onProgress?: (progress: EngineProgress) => void): Promise<string>;
  speak(text: string, backend: Backend, onProgress?: (progress: EngineProgress) => void): Promise<{ samples: Float32Array; sampleRate: number }>;
  analyzeImage(image: string, prompt: string, backend: Backend, onProgress?: (progress: EngineProgress) => void): Promise<string>;
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
    else pending.resolve(undefined);
    this.#pending.delete(message.requestId);
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

  analyzeImage(image: string, prompt: string, backend: Backend, onProgress?: (progress: EngineProgress) => void): Promise<string> {
    const id = crypto.randomUUID();
    return this.#post({ type: 'analyzeImage', requestId: id, image, prompt, backend }, [], onProgress);
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
  async transcribe(_audio: Float32Array, _sampleRate: number, _backend: Backend): Promise<string> {
    return 'Mock local transcription';
  }

  async speak(_text: string, _backend: Backend): Promise<{ samples: Float32Array; sampleRate: number }> {
    return { samples: new Float32Array(160), sampleRate: 16_000 };
  }

  async analyzeImage(_image: string, prompt: string, _backend: Backend, onProgress?: (progress: EngineProgress) => void): Promise<string> {
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
    return `The LFM2.5 vision model directly analyzed the image for: ${prompt}`;
  }

  async dispose(): Promise<void> {}
}

export function createMediaClient(): MediaEngine {
  const mockRequested = import.meta.env.DEV
    && typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('mockMedia') === '1';
  return mockRequested ? new MockMediaClient() : new MediaClient();
}
