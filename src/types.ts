export type Backend = 'webgpu' | 'wasm';
export type ModelTask = 'text-generation' | 'audio' | 'vision-language';
export type CapabilityTier = 'recommended' | 'fallback' | 'quality' | 'optional';
export type ModelDtype = 'auto' | 'fp32' | 'fp16' | 'q8' | 'int8' | 'uint8' | 'q4' | 'q4f16' | 'bnb4' | 'q2' | 'q2f16' | 'q1' | 'q1f16';

export interface ModelDescriptor {
  id: string;
  revision: string;
  name: string;
  publisher: string;
  task: ModelTask;
  backend: Backend | 'either';
  dtype: Partial<Record<Backend, ModelDtype | Record<string, ModelDtype>>>;
  downloadBytes: number;
  contextTokens: number;
  license: string;
  tier: CapabilityTier;
  description: string;
  hiddenFromHub?: boolean;
}

export interface AppPreferencesV1 {
  version: 1;
  onboardingComplete: boolean;
  selectedModelId: string;
  backend: Backend;
  speakResponses: boolean;
  compactSidebar: boolean;
}

export type RuntimeState =
  | 'boot'
  | 'onboarding'
  | 'preflight'
  | 'downloading'
  | 'warming'
  | 'ready'
  | 'generating'
  | 'error';

export interface StorageSnapshot {
  usage: number;
  quota: number;
  available: number;
  persisted: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface EngineProgress {
  status: 'downloading' | 'warming';
  file?: string;
  loaded: number;
  total: number;
  percent: number;
}

export type WorkerRequest =
  | { type: 'initialize'; requestId: string }
  | { type: 'loadModel'; requestId: string; model: ModelDescriptor; backend: Backend }
  | { type: 'generate'; requestId: string; messages: ChatMessage[]; maxNewTokens: number }
  | { type: 'cancel'; requestId: string }
  | { type: 'dispose'; requestId: string };

export type WorkerResponse =
  | { type: 'progress'; requestId: string; progress: EngineProgress }
  | { type: 'ready'; requestId: string; modelId: string }
  | { type: 'token'; requestId: string; text: string; tokenCount: number; elapsedMs: number }
  | { type: 'complete'; requestId: string; text: string; tokenCount: number; elapsedMs: number; cancelled: boolean }
  | { type: 'disposed'; requestId: string }
  | { type: 'error'; requestId: string; code: string; message: string; recoverable: boolean };

export type MediaRequest =
  | { type: 'transcribe'; requestId: string; audio: Float32Array; sampleRate: number; backend: Backend }
  | { type: 'speak'; requestId: string; text: string; backend: Backend }
  | { type: 'analyzeImage'; requestId: string; image: string; prompt: string; backend: Backend }
  | { type: 'dispose'; requestId: string };

export type MediaResponse =
  | { type: 'progress'; requestId: string; progress: EngineProgress; feature: ModelTask }
  | { type: 'transcription'; requestId: string; text: string }
  | { type: 'audio'; requestId: string; samples: Float32Array; sampleRate: number }
  | { type: 'vision'; requestId: string; text: string }
  | { type: 'disposed'; requestId: string }
  | { type: 'error'; requestId: string; code: string; message: string; recoverable: boolean };
