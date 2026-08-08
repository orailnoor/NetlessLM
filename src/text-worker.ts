/// <reference lib="webworker" />

import type { ChatMessage, ModelDescriptor, WorkerRequest, WorkerResponse } from './types';
import { DownloadProgressTracker } from './progress';
import { splitThinkingOutput } from './thinking';

declare const self: DedicatedWorkerGlobalScope;

type TextPipeline = ((messages: ChatMessage[], options: Record<string, unknown>) => Promise<unknown>) & {
  tokenizer: unknown;
  dispose?: () => Promise<void> | void;
};

let generator: TextPipeline | null = null;
let loadedModelId = '';
let stoppingCriteria: { interrupt(): void; reset(): void } | null = null;
let transformersModule: typeof import('@huggingface/transformers') | null = null;

function post(message: WorkerResponse): void {
  self.postMessage(message);
}

function outputText(output: unknown): string {
  const first = Array.isArray(output) ? output[0] : undefined;
  if (!first || typeof first !== 'object' || !('generated_text' in first)) return '';
  const generated = (first as { generated_text: unknown }).generated_text;
  if (typeof generated === 'string') return generated;
  if (Array.isArray(generated)) {
    const last = generated.at(-1);
    if (last && typeof last === 'object' && 'content' in last) {
      return String((last as { content: unknown }).content);
    }
  }
  return '';
}

async function initializeRuntime(requestId?: string): Promise<void> {
  transformersModule ??= await import('@huggingface/transformers');
  const { env } = transformersModule;
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  env.useWasmCache = true;
  if (requestId) post({ type: 'ready', requestId, modelId: loadedModelId });
}

async function loadModel(requestId: string, model: ModelDescriptor, backend: 'webgpu' | 'wasm'): Promise<void> {
  if (generator && loadedModelId === model.id) {
    post({ type: 'ready', requestId, modelId: model.id });
    return;
  }
  if (generator?.dispose) await generator.dispose();
  generator = null;

  if (!transformersModule) await initializeRuntime();
  const { pipeline, InterruptableStoppingCriteria } = transformersModule!;
  stoppingCriteria = new InterruptableStoppingCriteria();

  const progressTracker = new DownloadProgressTracker(model.downloadBytes);
  generator = await pipeline('text-generation', model.id, {
    revision: model.revision,
    device: backend,
    dtype: model.dtype[backend],
    progress_callback: (event: { status?: string; file?: string; loaded?: number; total?: number; progress?: number }) => {
      const file = event.file ?? 'model files';
      const complete = event.status === 'ready';
      const { loaded, total, percent } = progressTracker.update(
        file,
        event.loaded ?? 0,
        event.total ?? 0,
        event.progress,
        complete
      );
      post({
        type: 'progress',
        requestId,
        progress: {
          status: complete ? 'warming' : 'downloading',
          file,
          loaded,
          total,
          percent
        }
      });
    }
  }) as unknown as TextPipeline;
  loadedModelId = model.id;
  post({ type: 'ready', requestId, modelId: model.id });
}

async function generate(requestId: string, messages: ChatMessage[], maxNewTokens: number, enableThinking: boolean): Promise<void> {
  if (!generator || !transformersModule || !stoppingCriteria) throw new Error('Load a model before generating.');
  stoppingCriteria.reset();
  const started = performance.now();
  let streamed = '';
  let tokenCount = 0;
  const { TextStreamer } = transformersModule;
  const streamer = new TextStreamer(generator.tokenizer as never, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (chunk: string) => {
      streamed += chunk;
      const partialThinkingTag = enableThinking && !/<think>/i.test(streamed) && '<think>'.startsWith(streamed.trimStart().toLowerCase());
      const parsed = partialThinkingTag
        ? { answer: '', reasoning: '', thinkingComplete: false }
        : splitThinkingOutput(streamed);
      post({
        type: 'token',
        requestId,
        text: parsed.answer,
        reasoning: parsed.reasoning,
        thinkingComplete: parsed.thinkingComplete,
        tokenCount,
        elapsedMs: performance.now() - started
      });
    },
    token_callback_function: (tokens: bigint[]) => {
      tokenCount += tokens.length;
    }
  });
  const output = await generator(messages, {
    max_new_tokens: maxNewTokens,
    do_sample: false,
    streamer,
    stopping_criteria: [stoppingCriteria],
    tokenizer_encode_kwargs: { enable_thinking: enableThinking }
  });
  const parsed = splitThinkingOutput(outputText(output) || streamed);
  post({
    type: 'complete',
    requestId,
    text: parsed.answer,
    reasoning: parsed.reasoning,
    tokenCount,
    elapsedMs: performance.now() - started,
    cancelled: stoppingCriteria ? (stoppingCriteria as unknown as { interrupted: boolean }).interrupted : false
  });
}

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'initialize') {
      await initializeRuntime(request.requestId);
    } else if (request.type === 'loadModel') {
      await loadModel(request.requestId, request.model, request.backend);
    } else if (request.type === 'generate') {
      await generate(request.requestId, request.messages, request.maxNewTokens, request.enableThinking);
    } else if (request.type === 'cancel') {
      stoppingCriteria?.interrupt();
    } else if (request.type === 'dispose') {
      if (generator?.dispose) await generator.dispose();
      generator = null;
      loadedModelId = '';
      post({ type: 'disposed', requestId: request.requestId });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    post({
      type: 'error',
      requestId: request.requestId,
      code: request.type === 'initialize'
        ? 'RUNTIME_INITIALIZE_FAILED'
        : request.type === 'loadModel'
          ? 'MODEL_LOAD_FAILED'
          : 'INFERENCE_FAILED',
      message,
      recoverable: true
    });
  }
});
