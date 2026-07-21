// Polyfill for Vite HMR in Web Workers
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
    self.window = self;
    self.document = {
        querySelectorAll: () => [],
        querySelector: () => null,
        getElementsByTagName: () => [],
        createElement: () => ({})
    };
}

import { pipeline, env } from '@huggingface/transformers';
import { Gemma4Mobile } from './gemma-4-e2b.js';
import { Lfm2Mobile } from './lfm2_5.js';

// Configure environment
env.allowLocalModels = false;
env.useBrowserCache = true;

// Global model instances
let chatPipeline = null;
let visionPipeline = null;

// Progress callback wrapper
function createProgressCallback(modelName) {
    return (data) => {
        if (data.status === 'initiate') {
            self.postMessage({
                type: 'initiate',
                model: modelName,
                file: data.file
            });
        } else if (data.status === 'progress') {
            self.postMessage({
                type: 'progress',
                model: modelName,
                file: data.file,
                progress: data.progress,
                loaded: data.loaded,
                total: data.total
            });
        } else if (data.status === 'done') {
            self.postMessage({
                type: 'done',
                model: modelName,
                file: data.file
            });
        } else if (data.status === 'ready') {
            self.postMessage({
                type: 'ready',
                model: modelName,
                file: data.file
            });
        }
    };
}

// Progress callback wrapper for custom WebGPU engines (Gemma4 & LFM2.5 230M)
function createCustomProgressCallback(modelName) {
    return (event) => {
        if (event.status === 'init') {
            self.postMessage({
                type: 'initiate',
                model: modelName,
                file: 'WebGPU Device Init'
            });
        } else if (event.status === 'tokenizer') {
            self.postMessage({
                type: 'initiate',
                model: modelName,
                file: 'Tokenizer Config'
            });
        } else if (event.status === 'weights') {
            let pct = event.fraction ? event.fraction : 0;
            self.postMessage({
                type: 'progress',
                model: modelName,
                file: 'Model Weights',
                progress: pct * 100,
                loaded: event.loaded || 0,
                total: event.total || 100
            });
        } else if (event.status === 'ready') {
            self.postMessage({
                type: 'ready',
                model: modelName,
                file: 'WebGPU Engine Ready'
            });
        }
    };
}

// Initializing models
let currentChatModel = null;

async function initChat(modelId, device) {
    if (chatPipeline && currentChatModel === modelId) return;
    self.postMessage({ type: 'status', message: `Loading Chat Model (${modelId})...` });
    
    // Explicitly release previous model to help garbage collection
    if (chatPipeline && typeof chatPipeline.dispose === 'function') {
        try { chatPipeline.dispose(); } catch(e) {}
    }
    chatPipeline = null;
    currentChatModel = null;
    
    if (modelId === 'google/gemma-4-E2B-it-qat-mobile-transformers') {
        chatPipeline = await Gemma4Mobile.load(modelId, {
            onProgress: createCustomProgressCallback(modelId)
        });
        self.postMessage({ type: 'status', message: 'Warming up Gemma 4 kernels...' });
        await chatPipeline.warmup();
    } else if (modelId === 'LiquidAI/LFM2.5-230M-GGUF') {
        chatPipeline = await Lfm2Mobile.load(modelId, {
            onProgress: createCustomProgressCallback(modelId)
        });
        self.postMessage({ type: 'status', message: 'Warming up LFM2.5 kernels...' });
        await chatPipeline.warmup();
    } else {
        chatPipeline = await pipeline('text-generation', modelId, {
            device: device,
            dtype: 'q4', // Use 4-bit quantization to prevent memory errors and speed up loading
            progress_callback: createProgressCallback(modelId)
        });
    }
    currentChatModel = modelId;
    self.postMessage({ type: 'status', message: `Chat Model Ready!` });
}

async function initVision(device) {
    if (visionPipeline) return;
    self.postMessage({ type: 'status', message: 'Loading Image Captioning Model (ViT-GPT2)...' });
    visionPipeline = await pipeline('image-to-text', 'Xenova/vit-gpt2-image-captioning', {
        device: device,
        progress_callback: createProgressCallback('vision')
    });
    self.postMessage({ type: 'status', message: 'Vision Model Ready!' });
}

// Handle messages from main thread
self.addEventListener('message', async (event) => {
    const { type, data } = event.data;
    const device = data?.device || 'webgpu';

    try {
        if (type === 'init') {
            const modelId = data?.modelId || 'LiquidAI/LFM2.5-1.2B-Thinking-ONNX';
            await initChat(modelId, device);
            self.postMessage({ type: 'init_complete', worker: 'chat', modelId: modelId });
        } 
        
        else if (type === 'chat') {
            const modelId = data.modelId || 'LiquidAI/LFM2.5-1.2B-Thinking-ONNX';
            if (!chatPipeline || currentChatModel !== modelId) {
                await initChat(modelId, device);
            }
            
            const messages = data.messages;
            self.postMessage({ type: 'chat_start' });
            
            const isCustomWebGPUModel = modelId === 'google/gemma-4-E2B-it-qat-mobile-transformers' || modelId === 'LiquidAI/LFM2.5-230M-GGUF';
            
            if (isCustomWebGPUModel) {
                let generatedText = "";
                let tokenCount = 0;
                const startTime = performance.now();
                let firstTokenAt = 0;
                
                try {
                    const stream = chatPipeline.generate(messages, {
                        maxNewTokens: 1024
                    });
                    
                    for await (const chunk of stream) {
                        const now = performance.now();
                        if (!firstTokenAt) firstTokenAt = now;
                        tokenCount++;
                        generatedText = chunk.text;
                        
                        const currentElapsed = (performance.now() - startTime) / 1000;
                        const decodeSeconds = Math.max((now - firstTokenAt) / 1000, 1e-9);
                        const currentTps = decodeSeconds > 0 ? Math.round((tokenCount / decodeSeconds) * 10) / 10 : 0;
                        
                        self.postMessage({ 
                            type: 'chat_stream', 
                            text: generatedText, 
                            tps: currentTps,
                            tokens: tokenCount,
                            time: Math.round(currentElapsed * 10) / 10
                        });
                    }
                } catch (err) {
                    console.error("Custom WebGPU model generation error:", err);
                    throw err;
                }
                
                const elapsed = (performance.now() - startTime) / 1000;
                const tps = elapsed > 0 ? Math.round((tokenCount / elapsed) * 10) / 10 : 0;
                
                self.postMessage({ 
                    type: 'chat_result', 
                    text: generatedText, 
                    tps: tps,
                    tokens: tokenCount,
                    time: Math.round(elapsed * 10) / 10
                });
            } else {
                // Dynamically apply the model's template for chat history (works for any model)
                const prompt = chatPipeline.tokenizer.apply_chat_template(messages, {
                    tokenize: false,
                    add_generation_prompt: true
                });

                // Pre-calculate clean prompt length without special tokens
                const promptTokenIds = chatPipeline.tokenizer.encode(prompt);
                const cleanPromptText = chatPipeline.tokenizer.decode(promptTokenIds, { skip_special_tokens: true });
                const promptCutoffLength = cleanPromptText.length;

                let tokenCount = 0;
                const startTime = performance.now();

                const output = await chatPipeline(prompt, {
                    max_new_tokens: 1024, // Reasoning models generate detailed chains of thought
                    temperature: 0.7,
                    do_sample: true,
                    top_k: 50,
                    callback_function: (beams) => {
                        tokenCount = beams[0].output_token_ids.length;
                        let decodedText = chatPipeline.tokenizer.decode(beams[0].output_token_ids, { skip_special_tokens: true });
                        // Slice at the exact prompt cutoff length to avoid leakage
                        if (decodedText.length > promptCutoffLength) {
                            decodedText = decodedText.substring(promptCutoffLength);
                        } else {
                            decodedText = "";
                        }
                        decodedText = decodedText.replace(/<\|im_end\|>/g, '').trim();
                        
                        const currentElapsed = (performance.now() - startTime) / 1000;
                        const currentNewTokens = Math.max(0, tokenCount - promptTokenIds.length);
                        const currentTps = currentElapsed > 0 ? Math.round((currentNewTokens / currentElapsed) * 10) / 10 : 0;
                        
                        self.postMessage({ 
                            type: 'chat_stream', 
                            text: decodedText, 
                            tps: currentTps,
                            tokens: currentNewTokens,
                            time: Math.round(currentElapsed * 10) / 10
                        });
                    }
                });

                const elapsed = (performance.now() - startTime) / 1000;
                const newTokens = Math.max(0, tokenCount - promptTokenIds.length);
                const tps = elapsed > 0 ? Math.round((newTokens / elapsed) * 10) / 10 : 0;

                // Extract the generated text after the prompt using the same cutoff
                let generatedText = output[0].generated_text;
                const cleanOutputText = chatPipeline.tokenizer.decode(chatPipeline.tokenizer.encode(generatedText), { skip_special_tokens: true });
                
                if (cleanOutputText.length > promptCutoffLength) {
                    generatedText = cleanOutputText.substring(promptCutoffLength);
                } else if (generatedText.startsWith(prompt)) {
                    generatedText = generatedText.substring(prompt.length);
                }
                
                // Strip any trailing <|im_end|> tags
                generatedText = generatedText.replace(/<\|im_end\|>/g, '').trim();

                self.postMessage({ 
                    type: 'chat_result', 
                    text: generatedText, 
                    tps: tps,
                    tokens: newTokens,
                    time: Math.round(elapsed * 10) / 10
                });
            }
        } 
        
        else if (type === 'vision') {
            if (!visionPipeline) await initVision(device);
            if (!data?.image) return;
            
            self.postMessage({ type: 'vision_start' });
            
            // data.image is a Data URL or ImageBitmap
            const result = await visionPipeline(data.image);
            
            self.postMessage({ type: 'vision_result', caption: result[0].generated_text });
        }
    } catch (error) {
        console.error(`Error in Web Worker:`, error);
        self.postMessage({ type: 'error', message: error.message });
    }
});
