import type { Backend, ModelDescriptor } from './types';

export const MODEL_CATALOG: readonly ModelDescriptor[] = [
  {
    id: 'onnx-community/Qwen3-0.6B-ONNX',
    revision: 'da1453100cf3ff33ef56d17983fc7a8648706db6',
    name: 'Qwen 3 0.6B',
    publisher: 'Qwen / ONNX Community',
    task: 'text-generation',
    backend: 'webgpu',
    dtype: { webgpu: 'q4f16' },
    downloadBytes: 569_789_750,
    contextTokens: 32_768,
    license: 'Apache-2.0',
    tier: 'recommended',
    description: 'The best default for modern desktop GPUs: compact, multilingual, and responsive.'
  },
  {
    id: 'onnx-community/Qwen2.5-0.5B-Instruct',
    revision: 'cc5cc01a65cc3ff17bdb73a7de33d879f62599b0',
    name: 'Qwen 2.5 0.5B',
    publisher: 'Qwen / ONNX Community',
    task: 'text-generation',
    backend: 'either',
    dtype: { webgpu: 'q4f16', wasm: 'q8' },
    downloadBytes: 512_096_557,
    contextTokens: 32_768,
    license: 'Apache-2.0',
    tier: 'fallback',
    description: 'A universal fallback for systems without WebGPU. CPU generation is slower.'
  },
  {
    id: 'LiquidAI/LFM2.5-1.2B-Instruct-ONNX',
    revision: '10f72e70abf67ac0fd7ebf15bc5854726891d864',
    name: 'LFM 2.5 1.2B Instruct',
    publisher: 'Liquid AI',
    task: 'text-generation',
    backend: 'webgpu',
    dtype: { webgpu: 'q4f16' },
    downloadBytes: 760_462_213,
    contextTokens: 32_768,
    license: 'LFM-1.0',
    tier: 'quality',
    description: 'A larger optional model for stronger instruction following on capable desktops.'
  },
  {
    id: 'LiquidAI/LFM2.5-Audio-1.5B-ONNX',
    revision: '62318d95ddf42a65e742cdd6fd33df91874a801d',
    name: 'LFM 2.5 Audio 1.5B',
    publisher: 'Liquid AI',
    task: 'audio',
    backend: 'webgpu',
    dtype: { webgpu: 'q4' },
    downloadBytes: 1_600_000_000,
    contextTokens: 0,
    license: 'LFM-1.0',
    tier: 'optional',
    description: 'Local speech recognition and speech output. Loaded only when voice is used.',
    hiddenFromHub: true
  },
  {
    id: 'LiquidAI/LFM2.5-VL-450M-ONNX',
    revision: '95c283d4497a56477a83177079fa6b7121abb1b1',
    name: 'LFM 2.5 VL 450M',
    publisher: 'Liquid AI',
    task: 'vision-language',
    backend: 'webgpu',
    dtype: {
      webgpu: {
        vision_encoder: 'fp16',
        embed_tokens: 'fp16',
        decoder_model_merged: 'q4'
      }
    },
    downloadBytes: 770_000_000,
    contextTokens: 32_768,
    license: 'LFM-1.0',
    tier: 'optional',
    description: 'Direct local visual reasoning, screenshot understanding, and image Q&A.',
    hiddenFromHub: true
  }
] as const;

export const TEXT_MODELS = MODEL_CATALOG.filter((model) => model.task === 'text-generation');

export function getModel(modelId: string): ModelDescriptor | undefined {
  return MODEL_CATALOG.find((model) => model.id === modelId);
}

export function recommendedModel(backend: Backend): ModelDescriptor {
  const tier = backend === 'webgpu' ? 'recommended' : 'fallback';
  const model = TEXT_MODELS.find((candidate) => candidate.tier === tier);
  if (!model) throw new Error(`No ${tier} model is configured.`);
  return model;
}

export function modelSupportsBackend(model: ModelDescriptor, backend: Backend): boolean {
  return (model.backend === 'either' || model.backend === backend) && Boolean(model.dtype[backend]);
}
