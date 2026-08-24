/// <reference lib="webworker" />

import { MODEL_CATALOG } from './models';
import { DownloadProgressTracker } from './progress';
import type { MediaRequest, MediaResponse, ModelDescriptor } from './types';

declare const self: DedicatedWorkerGlobalScope;

let transformersModule: typeof import('@huggingface/transformers') | null = null;
let visionRuntime: { model: any; processor: any; RawImage: any; modelId: string } | null = null;

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



self.addEventListener('message', async (event: MessageEvent<MediaRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'loadModel') {
      if (request.backend !== 'webgpu') throw new Error('LFM2.5 models require WebGPU in this browser.');
      if (request.model.task === 'vision-language') await getVisionRuntime(request.requestId, request.model);
      else throw new Error('This model does not use the media runtime.');
      post({ type: 'ready', requestId: request.requestId, modelId: request.model.id });
    } else if (request.type === 'analyzeImage') {
      if (request.backend !== 'webgpu') throw new Error('LFM2.5 vision requires WebGPU in this browser.');
      const text = await analyzeImage(request.requestId, request.image, request.messages, request.model);
      post({ type: 'vision', requestId: request.requestId, text });
    } else if (request.type === 'dispose') {
      await visionRuntime?.model.dispose?.();
      visionRuntime = null;
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
