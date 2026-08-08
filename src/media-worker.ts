/// <reference lib="webworker" />

import { MODEL_CATALOG } from './models';
import { DownloadProgressTracker } from './progress';
import type { MediaRequest, MediaResponse, ModelDescriptor } from './types';

declare const self: DedicatedWorkerGlobalScope;

let transformersModule: typeof import('@huggingface/transformers') | null = null;
let visionRuntime: { model: any; processor: any; RawImage: any; modelId: string } | null = null;
let audioRuntime: AudioRuntime | null = null;

interface AudioRuntime {
  transcribe(audio: Float32Array, sampleRate: number, options?: Record<string, unknown>): Promise<string>;
  generateSpeech(text: string, options?: Record<string, unknown>): Promise<{ audioCodes: number[][] }>;
  generateInterleaved(audio: Float32Array, sampleRate: number, prompt?: string, options?: Record<string, unknown>): Promise<{ text?: string; audioCodes?: number[][] }>;
  decodeAudioCodes(codes: number[][]): Promise<Float32Array>;
  dispose(): void;
}

function post(message: MediaResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

function descriptor(task: ModelDescriptor['task']): ModelDescriptor {
  const model = MODEL_CATALOG.find((candidate) => candidate.task === task);
  if (!model) throw new Error(`No model configured for ${task}.`);
  return model;
}

async function getVisionRuntime(requestId: string, descriptorValue: ModelDescriptor): Promise<NonNullable<typeof visionRuntime>> {
  if (visionRuntime?.modelId === descriptorValue.id) return visionRuntime;
  await visionRuntime?.model.dispose?.();
  visionRuntime = null;
  audioRuntime?.dispose();
  audioRuntime = null;
  transformersModule ??= await import('@huggingface/transformers');
  const { AutoModelForImageTextToText, AutoProcessor, RawImage, env } = transformersModule;
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  env.useWasmCache = true;
  const progressTracker = new DownloadProgressTracker(descriptorValue.downloadBytes);
  const progressCallback = (event: { status?: string; file?: string; loaded?: number; total?: number; progress?: number }) => {
    const complete = event.status === 'ready';
    post({
      type: 'progress',
      requestId,
      feature: 'vision-language',
      progress: {
        status: complete ? 'warming' : 'downloading',
        file: event.file,
        ...progressTracker.update(
          event.file ?? 'vision model files',
          event.loaded ?? 0,
          event.total ?? 0,
          event.progress,
          complete
        )
      }
    });
  };
  const model = await AutoModelForImageTextToText.from_pretrained(descriptorValue.id, {
    revision: descriptorValue.revision,
    device: 'webgpu',
    dtype: descriptorValue.dtype.webgpu as any,
    progress_callback: progressCallback
  });
  const processor = await AutoProcessor.from_pretrained(descriptorValue.id, {
    revision: descriptorValue.revision,
    progress_callback: progressCallback
  });
  visionRuntime = { model, processor, RawImage, modelId: descriptorValue.id };
  return visionRuntime;
}

async function analyzeImage(requestId: string, imageSource: string, history: import('./types').ChatMessage[], descriptorValue: ModelDescriptor): Promise<string> {
  const { model, processor, RawImage } = await getVisionRuntime(requestId, descriptorValue);
  const image = await RawImage.fromURL(imageSource);
  const conversation = history.filter((message) => message.role !== 'system');
  const messages = conversation.map((message, index) => ({
    role: message.role,
    content: message.role === 'user' && index === 0
      ? [{ type: 'image' }, { type: 'text', text: message.content }]
      : [{ type: 'text', text: message.content }]
  }));
  const chatPrompt = processor.apply_chat_template(messages, { add_generation_prompt: true });
  const inputs = await processor(image, chatPrompt, { add_special_tokens: false });
  const outputs = await model.generate({
    ...inputs,
    do_sample: false,
    max_new_tokens: 256
  });
  const inputLength = inputs.input_ids.dims.at(-1);
  const generated = outputs.slice(null, [inputLength, null]);
  return String(processor.batch_decode(generated, { skip_special_tokens: true })[0] ?? '').trim();
}

async function getAudioRuntime(requestId: string): Promise<AudioRuntime> {
  if (audioRuntime) return audioRuntime;
  await visionRuntime?.model.dispose?.();
  visionRuntime = null;
  const model = descriptor('audio');
  const source = `https://huggingface.co/${model.id}/resolve/${model.revision}`;
  const { AudioModel } = await import('lfm2-audio-webgpu-demo/audio-model.js');
  const runtime = new AudioModel() as AudioRuntime & {
    load(path: string, options: Record<string, unknown>): Promise<void>;
  };
  await runtime.load(source, {
    device: 'webgpu',
    quantization: {
      decoder: 'q4',
      audioEncoder: 'q4',
      audioEmbedding: 'q4',
      audioDetokenizer: 'q4',
      vocoder: 'q4'
    },
    progressCallback: (event: { status?: string; progress?: number; file?: string }) => {
      const percent = Math.max(0, Math.min(100, Number(event.progress ?? 0)));
      post({
        type: 'progress',
        requestId,
        feature: 'audio',
        progress: {
          status: event.status === 'done' ? 'warming' : 'downloading',
          file: event.file,
          loaded: Math.round(model.downloadBytes * percent / 100),
          total: model.downloadBytes,
          percent
        }
      });
    }
  });
  audioRuntime = runtime;
  return runtime;
}

self.addEventListener('message', async (event: MessageEvent<MediaRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'transcribe') {
      if (request.backend !== 'webgpu') throw new Error('LFM2.5 Audio requires WebGPU in this browser.');
      const runtime = await getAudioRuntime(request.requestId);
      const text = await runtime.transcribe(request.audio, request.sampleRate, { maxNewTokens: 160 });
      post({ type: 'transcription', requestId: request.requestId, text: String(text).trim() });
    } else if (request.type === 'loadModel') {
      if (request.backend !== 'webgpu') throw new Error('LFM2.5 models require WebGPU in this browser.');
      if (request.model.task === 'vision-language') await getVisionRuntime(request.requestId, request.model);
      else if (request.model.task === 'audio') await getAudioRuntime(request.requestId);
      else throw new Error('This model does not use the media runtime.');
      post({ type: 'ready', requestId: request.requestId, modelId: request.model.id });
    } else if (request.type === 'speak') {
      if (request.backend !== 'webgpu') throw new Error('LFM2.5 Audio requires WebGPU in this browser.');
      const runtime = await getAudioRuntime(request.requestId);
      const output = await runtime.generateSpeech(request.text, { maxNewTokens: 512 });
      const samples = await runtime.decodeAudioCodes(output.audioCodes);
      post(
        { type: 'audio', requestId: request.requestId, samples, sampleRate: 24_000 },
        [samples.buffer]
      );
    } else if (request.type === 'converseAudio') {
      if (request.backend !== 'webgpu') throw new Error('LFM2.5 Audio requires WebGPU in this browser.');
      const runtime = await getAudioRuntime(request.requestId);
      const result = await runtime.generateInterleaved(request.audio, request.sampleRate, request.prompt, { maxNewTokens: 512 });
      const samples = result.audioCodes?.length ? await runtime.decodeAudioCodes(result.audioCodes) : new Float32Array(0);
      post({ type: 'audioConversation', requestId: request.requestId, text: String(result.text ?? '').trim(), samples, sampleRate: 24_000 }, [samples.buffer]);
    } else if (request.type === 'analyzeImage') {
      if (request.backend !== 'webgpu') throw new Error('LFM2.5 vision requires WebGPU in this browser.');
      const text = await analyzeImage(request.requestId, request.image, request.messages, request.model);
      post({ type: 'vision', requestId: request.requestId, text });
    } else if (request.type === 'dispose') {
      await visionRuntime?.model.dispose?.();
      visionRuntime = null;
      audioRuntime?.dispose();
      audioRuntime = null;
      post({ type: 'disposed', requestId: request.requestId });
    }
  } catch (error) {
    post({
      type: 'error',
      requestId: request.requestId,
      code: 'OPTIONAL_FEATURE_FAILED',
      message: error instanceof Error ? error.message : String(error),
      recoverable: true
    });
  }
});
