import type { AppMode, ModelDescriptor } from './types';

export const MODEL_CATALOG: readonly ModelDescriptor[] = [
  {
    id: 'onnx-community/LFM2.5-350M-ONNX',
    revision: '2c07371c2e84776cad597f3d813b7d306d292aea',
    name: 'LFM 2.5 350M',
    publisher: 'Liquid AI / ONNX Community',
    mode: 'text',
    task: 'text-generation',
    backend: 'webgpu',
    dtype: { webgpu: 'q4' },
    downloadBytes: 276_000_000,
    contextTokens: 32_768,
    license: 'LFM-1.0',
    tier: 'fast',
    description: 'Fastest local chat model for lower-memory desktops.'
  },
  {
    id: 'LiquidAI/LFM2.5-1.2B-Instruct-ONNX',
    revision: '10f72e70abf67ac0fd7ebf15bc5854726891d864',
    name: 'LFM 2.5 1.2B Instruct',
    publisher: 'Liquid AI',
    mode: 'text',
    task: 'text-generation',
    backend: 'webgpu',
    dtype: { webgpu: 'q4f16' },
    downloadBytes: 760_462_213,
    contextTokens: 32_768,
    license: 'LFM-1.0',
    tier: 'recommended',
    description: 'Recommended for higher-quality local chat and document Q&A.'
  },
  {
    id: 'LiquidAI/LFM2.5-1.2B-Thinking-ONNX',
    revision: 'e7fe61974e3a167dff77c5722db9a1cb7b57140f',
    name: 'LFM 2.5 1.2B Thinking',
    publisher: 'Liquid AI',
    mode: 'text',
    task: 'text-generation',
    backend: 'webgpu',
    dtype: { webgpu: 'q4f16' },
    downloadBytes: 763_764_000,
    contextTokens: 32_768,
    license: 'LFM-1.0',
    tier: 'quality',
    description: 'Reasoning model for math, coding, logic, and complex document questions.',
    supportsThinking: true
  },
  {
    id: 'LiquidAI/LFM2.5-VL-450M-ONNX',
    revision: '95c283d4497a56477a83177079fa6b7121abb1b1',
    name: 'LFM 2.5 VL 450M',
    publisher: 'Liquid AI',
    mode: 'vision',
    task: 'vision-language',
    backend: 'webgpu',
    dtype: { webgpu: { vision_encoder: 'fp16', embed_tokens: 'fp16', decoder_model_merged: 'q4' } },
    downloadBytes: 770_000_000,
    contextTokens: 32_768,
    license: 'LFM-1.0',
    tier: 'fast',
    description: 'Compact visual reasoning, image understanding, and screenshot Q&A.'
  },
  {
    id: 'LiquidAI/LFM2.5-VL-1.6B-ONNX',
    revision: 'd0e00ca26cc42892d9f3c4380faa631927218209',
    name: 'LFM 2.5 VL 1.6B',
    publisher: 'Liquid AI',
    mode: 'vision',
    task: 'vision-language',
    backend: 'webgpu',
    dtype: { webgpu: { vision_encoder: 'fp16', embed_tokens: 'fp16', decoder_model_merged: 'q4' } },
    downloadBytes: 1_500_000_000,
    contextTokens: 32_768,
    license: 'LFM-1.0',
    tier: 'recommended',
    description: 'Recommended vision model for more accurate visual reasoning.',
    browserVerified: false
  }
] as const;

export function modelsForMode(mode: AppMode): readonly ModelDescriptor[] {
  return MODEL_CATALOG.filter((model) => model.mode === mode && model.browserVerified !== false);
}

export function getModel(modelId: string): ModelDescriptor | undefined {
  return MODEL_CATALOG.find((model) => model.id === modelId);
}

export function recommendedModel(mode: AppMode): ModelDescriptor {
  const models = modelsForMode(mode);
  const model = models.find((candidate) => candidate.tier === 'recommended') ?? models[0];
  if (!model) throw new Error(`No ${mode} model is configured.`);
  return model;
}
