import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('real LFM2.5 vision model initializes and analyzes an image', async ({ page }) => {
  test.skip(process.env.AETHER_REAL_HARDWARE !== '1', 'Opt-in model download and hardware smoke test.');
  test.setTimeout(20 * 60_000);

  const imagePath = process.env.AETHER_TEST_IMAGE;
  if (!imagePath) throw new Error('Set AETHER_TEST_IMAGE to a local PNG, JPEG, or WebP file.');

  await page.goto('/?mockEngine=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Download & start' }).click();
  await expect(page.getByLabel('Message your local AI')).toBeEnabled({ timeout: 10_000 });

  await page.locator('#image-input').setInputFiles(imagePath);
  await page.getByLabel('Message your local AI').fill('Describe this image in one sentence.');
  await page.getByLabel('Send message').click();
  await expect(page.locator('.assistant .response-content').last()).toContainText(
    /android|ubuntu|desktop|phone/i,
    { timeout: 20 * 60_000 }
  );
  await expect(page.getByText('Visual reasoning could not start.')).toHaveCount(0);
});

test('real LFM2.5 audio model transcribes and generates speech', async ({ page }) => {
  test.skip(process.env.AETHER_REAL_HARDWARE !== '1', 'Set AETHER_REAL_HARDWARE=1 to download and run the real model.');
  const audioPath = process.env.AETHER_TEST_AUDIO;
  test.skip(!audioPath, 'Set AETHER_TEST_AUDIO to a short speech recording.');
  test.setTimeout(20 * 60_000);

  const encodedAudio = readFileSync(audioPath!).toString('base64');
  await page.goto('/?skipOnboarding=1');
  const result = await page.evaluate(async (encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const context = new AudioContext();
    const decoded = await context.decodeAudioData(bytes.buffer);
    const samples = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const data = decoded.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) {
        samples[index] = (samples[index] ?? 0) + (data[index] ?? 0) / decoded.numberOfChannels;
      }
    }
    const moduleUrl = '/src/media-client.ts';
    const { MediaClient } = await import(/* @vite-ignore */ moduleUrl) as typeof import('../src/media-client');
    const media = new MediaClient();
    const transcript = await media.transcribe(samples, decoded.sampleRate, 'webgpu');
    const speech = await media.speak('Hello from Aether.', 'webgpu');
    await media.dispose();
    await context.close();
    return { transcript, sampleCount: speech.samples.length, sampleRate: speech.sampleRate };
  }, encodedAudio);

  expect(result.transcript.toLowerCase()).toMatch(/hello.*(local|audio)/);
  expect(result.sampleCount).toBeGreaterThan(2_400);
  expect(result.sampleRate).toBe(24_000);
});
