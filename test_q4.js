import { env, pipeline } from '@huggingface/transformers';
env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;

async function run() {
  try {
    const generator = await pipeline('text-generation', 'onnx-community/LFM2.5-350M-ONNX', {
      device: 'webgpu',
      dtype: 'q4'
    });
    console.log("SUCCESS!");
  } catch(e) {
    console.error("ERROR:", e);
  }
}
run();
