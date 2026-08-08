export type Backend = 'webgpu' | 'wasm';
export type AppMode = 'text' | 'vision' | 'audio';
export type ModelTask = 'text-generation' | 'audio' | 'vision-language';
export type CapabilityTier = 'recommended' | 'fast' | 'quality' | 'optional';
export type ModelDtype = 'auto' | 'fp32' | 'fp16' | 'q8' | 'int8' | 'uint8' | 'q4' | 'q4f16' | 'bnb4' | 'q2' | 'q2f16' | 'q1' | 'q1f16';
export type AttachmentKind = 'image' | 'audio' | 'document' | 'generated-audio';

export interface ModelDescriptor {
  id: string;
  revision: string;
  name: string;
  publisher: string;
  mode: AppMode;
  task: ModelTask;
  backend: Backend;
  dtype: Partial<Record<Backend, ModelDtype | Record<string, ModelDtype>>>;
  downloadBytes: number;
  contextTokens: number;
  license: string;
  tier: CapabilityTier;
  description: string;
  browserVerified?: boolean;
  supportsThinking?: boolean;
}

export interface AppPreferencesV2 {
  version: 2;
  onboardingComplete: boolean;
  activeMode: AppMode;
  selectedModelByMode: Record<AppMode, string>;
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

export interface GenerationMetadata {
  tokenCount?: number;
  elapsedMs?: number;
  stopped?: boolean;
  reasoning?: string;
}

export interface PersistedMessageV1 {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  attachmentIds: string[];
  modelId: string;
  metadata?: GenerationMetadata;
}

export interface ConversationRecordV1 {
  id: string;
  version: 1;
  mode: AppMode;
  title: string;
  selectedModelId: string;
  createdAt: number;
  updatedAt: number;
  messages: PersistedMessageV1[];
}

export interface DocumentChunk {
  text: string;
  page?: number;
  index: number;
}

export interface AttachmentRecordV1 {
  id: string;
  version: 1;
  conversationId: string;
  messageId?: string;
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  blob: Blob;
  extractedText?: string;
  chunks?: DocumentChunk[];
  pageCount?: number;
  createdAt: number;
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
  | { type: 'generate'; requestId: string; messages: ChatMessage[]; maxNewTokens: number; enableThinking: boolean }
  | { type: 'cancel'; requestId: string }
  | { type: 'dispose'; requestId: string };

export type WorkerResponse =
  | { type: 'progress'; requestId: string; progress: EngineProgress }
  | { type: 'ready'; requestId: string; modelId: string }
  | { type: 'token'; requestId: string; text: string; reasoning: string; thinkingComplete: boolean; tokenCount: number; elapsedMs: number }
  | { type: 'complete'; requestId: string; text: string; reasoning: string; tokenCount: number; elapsedMs: number; cancelled: boolean }
  | { type: 'disposed'; requestId: string }
  | { type: 'error'; requestId: string; code: string; message: string; recoverable: boolean };

export type MediaRequest =
  | { type: 'loadModel'; requestId: string; model: ModelDescriptor; backend: Backend }
  | { type: 'transcribe'; requestId: string; audio: Float32Array; sampleRate: number; backend: Backend }
  | { type: 'speak'; requestId: string; text: string; backend: Backend }
  | { type: 'converseAudio'; requestId: string; audio: Float32Array; sampleRate: number; prompt: string; backend: Backend }
  | { type: 'analyzeImage'; requestId: string; image: string; messages: ChatMessage[]; model: ModelDescriptor; backend: Backend }
  | { type: 'dispose'; requestId: string };

export type MediaResponse =
  | { type: 'progress'; requestId: string; progress: EngineProgress; feature: ModelTask }
  | { type: 'ready'; requestId: string; modelId: string }
  | { type: 'transcription'; requestId: string; text: string }
  | { type: 'audio'; requestId: string; samples: Float32Array; sampleRate: number }
  | { type: 'audioConversation'; requestId: string; text: string; samples: Float32Array; sampleRate: number }
  | { type: 'vision'; requestId: string; text: string }
  | { type: 'disposed'; requestId: string }
  | { type: 'error'; requestId: string; code: string; message: string; recoverable: boolean };
