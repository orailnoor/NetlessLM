import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?mockEngine=1&mockMedia=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

async function finishOnboarding(page: import('@playwright/test').Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Download & start' }).click();
  await expect(page.getByLabel('Message your local AI')).toBeEnabled({ timeout: 10_000 });
}

test('landing page loads no model or inference runtime', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.reload();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(requested.filter((url) => /huggingface\.co|text-worker|media-worker|audio-model|transformers\.web|\.onnx(?:\?|$)|\.wasm(?:\?|$)/i.test(url))).toEqual([]);
});

test('first visit has exactly three concise slides and starts one model', async ({ page }) => {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-onboarding-step]')).toHaveCount(3);
  await expect(dialog.getByText('Private AI in your browser')).toBeVisible();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByText('Download once, use offline')).toBeVisible();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByText('Ready for this device')).toBeVisible();
  await dialog.getByRole('button', { name: 'Download & start' }).click();
  await expect(page.getByLabel('Message your local AI')).toBeEnabled({ timeout: 10_000 });

  await page.getByLabel('Message your local AI').fill('Give me one local idea');
  await page.getByLabel('Send message').click();
  await expect(page.getByText(/private local response/i)).toBeVisible({ timeout: 10_000 });
});

test('returning users skip onboarding', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('aether.preferences.v1', JSON.stringify({
    version: 1,
    onboardingComplete: true,
    selectedModelId: 'onnx-community/Qwen2.5-0.5B-Instruct',
    backend: 'wasm',
    speakResponses: false,
    compactSidebar: false
  })));
  await page.reload();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText(/Your model is ready to download|is stored locally/)).toBeVisible();
});

test('onboarding controls fit and are keyboard reachable', async ({ page }) => {
  await expect(page.getByRole('dialog')).toBeVisible();
  const box = await page.getByRole('dialog').boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-onboarding-step="1"] button:focus')).toBeVisible();
});

test('low storage blocks setup with a useful explanation', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: async () => ({ usage: 90, quota: 100 }),
        persisted: async () => false,
        persist: async () => false
      }
    });
  });
  await page.reload();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByText(/Free at least/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Download & start' })).toBeDisabled();
});

test('generation can be stopped and no media worker loads by default', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await finishOnboarding(page);
  expect(requested.some((url) => /media-worker|whisper|supertonic|image-caption/i.test(url))).toBe(false);
  await page.getByLabel('Message your local AI').fill('Write a response that I will stop');
  await page.getByLabel('Send message').click();
  await page.getByRole('button', { name: 'Stop generation' }).click();
  await expect(page.getByText('Stopped')).toBeVisible();
});

test('models and settings do not show the chat hero or composer', async ({ page }) => {
  await finishOnboarding(page);
  await page.locator('[data-view="models"]').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator('#chat-view')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Local models' })).toBeVisible();
  await expect(page.getByLabel('Message your local AI')).toBeHidden();

  await page.locator('[data-view="settings"]').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator('#chat-view')).toBeHidden();
  await expect(page.locator('#settings-view').getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByLabel('Message your local AI')).toBeHidden();
});

test('an attached image is analyzed locally and supports follow-up questions', async ({ page }) => {
  await finishOnboarding(page);
  await page.locator('#image-input').setInputFiles({
    name: 'tiny.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64')
  });
  await expect(page.getByText('tiny.png')).toBeVisible();
  await page.getByLabel('Message your local AI').fill('Explain this image');
  await page.getByLabel('Send message').click();
  await expect(page.getByText(/LFM2\.5 vision model directly analyzed the image/i)).toBeVisible({ timeout: 10_000 });

  await page.getByLabel('Message your local AI').fill('What about the same image?');
  await page.getByLabel('Send message').click();
  await expect(page.getByText(/directly analyzed the image for: What about the same image/i)).toBeVisible({ timeout: 10_000 });
});
