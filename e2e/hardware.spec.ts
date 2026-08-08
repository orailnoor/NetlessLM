import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

for (const modelId of ['onnx-community/LFM2.5-350M-ONNX', 'LiquidAI/LFM2.5-1.2B-Instruct-ONNX']) {
  test(`real text model ${modelId} generates locally`, async ({ page }) => {
    test.skip(process.env.AETHER_REAL_HARDWARE !== '1', 'Opt-in real WebGPU model test.');
    test.setTimeout(20 * 60_000);
    await page.goto('/');
    const result = await page.evaluate(async (id) => {
      const modelsUrl = '/src/models.ts';
      const clientUrl = '/src/engine-client.ts';
      const { MODEL_CATALOG } = await import(/* @vite-ignore */ modelsUrl) as typeof import('../src/models');
      const { WorkerTextEngine } = await import(/* @vite-ignore */ clientUrl) as typeof import('../src/engine-client');
      const model = MODEL_CATALOG.find((candidate) => candidate.id === id)!;
      const engine = new WorkerTextEngine();
      await engine.initialize(model, 'webgpu');
      const generated = await engine.generate([{ role: 'user', content: 'Reply with exactly: local model ready' }], 32, () => {});
      await engine.dispose();
      return generated.text;
    }, modelId);
    expect(result.toLowerCase()).toContain('local');
  });
}

for (const modelId of ['LiquidAI/LFM2.5-VL-450M-ONNX']) {
  test(`real vision model ${modelId} analyzes an image`, async ({ page }) => {
    test.skip(process.env.AETHER_REAL_HARDWARE !== '1', 'Opt-in real WebGPU model test.');
    const imagePath = process.env.AETHER_TEST_IMAGE;
    test.skip(!imagePath, 'Set AETHER_TEST_IMAGE to a local image.');
    test.setTimeout(20 * 60_000);
    const encoded = readFileSync(imagePath!).toString('base64');
    const mimeType = imagePath!.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    await page.goto('/');
    const result = await page.evaluate(async ({ id, data, mime }) => {
      const modelsUrl = '/src/models.ts';
      const clientUrl = '/src/media-client.ts';
      const { MODEL_CATALOG } = await import(/* @vite-ignore */ modelsUrl) as typeof import('../src/models');
      const { MediaClient } = await import(/* @vite-ignore */ clientUrl) as typeof import('../src/media-client');
      const model = MODEL_CATALOG.find((candidate) => candidate.id === id)!;
      const media = new MediaClient();
      await media.initialize(model, 'webgpu');
      const answer = await media.analyzeImage(`data:${mime};base64,${data}`, [{ role: 'user', content: 'Describe this image in one sentence.' }], model, 'webgpu');
      await media.dispose();
      return answer;
    }, { id: modelId, data: encoded, mime: mimeType });
    expect(result.length).toBeGreaterThan(12);
  });
}

test('real LFM2.5 Audio transcribes, speaks, and answers audio', async ({ page }) => {
  test.skip(process.env.AETHER_REAL_HARDWARE !== '1', 'Opt-in real WebGPU model test.');
  const audioPath = process.env.AETHER_TEST_AUDIO;
  test.skip(!audioPath, 'Set AETHER_TEST_AUDIO to a short speech WAV.');
  test.setTimeout(20 * 60_000);
  const encodedAudio = readFileSync(audioPath!).toString('base64');
  await page.goto('/');
  const result = await page.evaluate(async (encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const context = new AudioContext();
    const decoded = await context.decodeAudioData(bytes.buffer);
    const samples = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const data = decoded.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) samples[index] = (samples[index] ?? 0) + (data[index] ?? 0) / decoded.numberOfChannels;
    }
    const modelsUrl = '/src/models.ts';
    const clientUrl = '/src/media-client.ts';
    const { MODEL_CATALOG } = await import(/* @vite-ignore */ modelsUrl) as typeof import('../src/models');
    const { MediaClient } = await import(/* @vite-ignore */ clientUrl) as typeof import('../src/media-client');
    const model = MODEL_CATALOG.find((candidate) => candidate.mode === 'audio')!;
    const media = new MediaClient();
    await media.initialize(model, 'webgpu');
    const transcript = await media.transcribe(samples.slice(), decoded.sampleRate, 'webgpu');
    const speech = await media.speak('Hello from Aether.', 'webgpu');
    const conversation = await media.converseAudio(samples, decoded.sampleRate, 'Reply briefly.', 'webgpu');
    await media.dispose(); await context.close();
    return { transcript, speechSamples: speech.samples.length, conversationText: conversation.text, conversationSamples: conversation.samples.length };
  }, encodedAudio);
  expect(result.transcript.length).toBeGreaterThan(5);
  expect(result.speechSamples).toBeGreaterThan(2_400);
  expect(result.conversationText.length + result.conversationSamples).toBeGreaterThan(10);
});
