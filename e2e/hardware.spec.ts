import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

for (const modelId of ['onnx-community/LFM2.5-350M-ONNX', 'LiquidAI/LFM2.5-1.2B-Instruct-ONNX', 'LiquidAI/LFM2.5-1.2B-Thinking-ONNX']) {
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
      const generated = await engine.generate(
        [{ role: 'user', content: 'Reply with exactly: local model ready' }],
        model.supportsThinking ? 1_024 : 32,
        model.supportsThinking === true,
        () => {}
      );
      await engine.dispose();
      return { text: generated.text, reasoning: generated.reasoning, supportsThinking: model.supportsThinking === true };
    }, modelId);
    expect(result.text.toLowerCase()).toContain('local');
    if (result.supportsThinking) expect(result.reasoning.length).toBeGreaterThan(0);
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


