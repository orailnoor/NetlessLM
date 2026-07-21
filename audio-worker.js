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
import { KokoroTTS } from 'kokoro-js';

// Configure environment
env.allowLocalModels = false;
env.useBrowserCache = true;

// Global model instances
let asrPipeline = null;
let ttsInstance = null;

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

// Initializing models
async function initASR(device) {
    if (asrPipeline) return;
    self.postMessage({ type: 'status', message: 'Loading Speech Recognition (Whisper-Tiny)...' });
    asrPipeline = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
        device: device,
        progress_callback: createProgressCallback('asr')
    });
    self.postMessage({ type: 'status', message: 'ASR Ready!' });
}

async function initTTS(device) {
    if (ttsInstance) return;
    self.postMessage({ type: 'status', message: 'Loading Speech Synthesis (Kokoro-82M)...' });
    
    // We use the 8-bit quantized model to save bandwidth and memory
    ttsInstance = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: 'q8',
        device: device === 'webgpu' ? 'webgpu' : 'wasm',
        progress_callback: createProgressCallback('tts')
    });
    self.postMessage({ type: 'status', message: 'TTS Ready!' });
}

// Handle messages from main thread
self.addEventListener('message', async (event) => {
    const { type, data } = event.data;
    const device = data?.device || 'webgpu';

    try {
        if (type === 'init') {
            await initASR(device);
            await initTTS(device);
            self.postMessage({ type: 'init_complete', worker: 'audio' });
        } 
        
        else if (type === 'asr') {
            if (!asrPipeline) await initASR(device);
            
            self.postMessage({ type: 'asr_start' });
            
            let result;
            try {
                result = await asrPipeline(data.audio, {
                    chunk_length_s: 30,
                    stride_length_s: 5,
                    language: 'english',
                    task: 'transcribe'
                });
            } catch (err) {
                console.warn("ASR call failed with multilingual options, retrying with English-only settings:", err);
                result = await asrPipeline(data.audio, {
                    chunk_length_s: 30,
                    stride_length_s: 5
                });
            }

            self.postMessage({ type: 'asr_result', text: result.text });
        } 
        
        else if (type === 'tts') {
            if (!ttsInstance) await initTTS(device);
            
            self.postMessage({ type: 'tts_start' });
            
            const text = data.text;
            const voice = data.voice || 'af_sky';
            
            const audio = await ttsInstance.generate(text, {
                voice: voice
            });

            self.postMessage({ 
                type: 'tts_result', 
                audio: audio.audio,
                samplingRate: audio.sampling_rate
            });
        }
    } catch (error) {
        console.error(`Error in Audio Web Worker:`, error);
        self.postMessage({ type: 'error', message: error.message });
    }
});
