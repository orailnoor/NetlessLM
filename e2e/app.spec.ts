import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: { requestAdapter: async () => ({}) } });
  });
  await page.goto('/?mockEngine=1&mockMedia=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

async function finishOnboarding(page: Page): Promise<void> {
  const onboarding = page.locator('#onboarding-dialog');
  await onboarding.getByRole('button', { name: 'Continue' }).click();
  await onboarding.getByRole('button', { name: 'Continue' }).click();
  await onboarding.getByRole('button', { name: 'Choose text model' }).click();
  await expect(page.getByRole('heading', { name: 'Choose text model' })).toBeVisible();
  await page.locator('.model-entry').filter({ hasText: 'LFM 2.5 350M' }).getByRole('button', { name: 'Download' }).click();
  await expect(page.getByLabel('Message Aether')).toBeVisible({ timeout: 10_000 });
}

async function switchToMode(page: Page, mode: 'vision' | 'audio'): Promise<void> {
  if (await page.getByLabel('Open navigation').isVisible()) await page.getByLabel('Open navigation').click();
  await page.locator(`[data-mode="${mode}"]`).click();
}

async function reopenFirstRecent(page: Page): Promise<void> {
  if (await page.getByLabel('Open navigation').isVisible()) await page.getByLabel('Open navigation').click();
  await page.locator('#recent-list .recent-open').first().click();
}

function speechFixture(): Buffer {
  const sampleRate = 16_000;
  const samples = sampleRate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) buffer.writeInt16LE(Math.round(Math.sin(index / 12) * 4_000), 44 + index * 2);
  return buffer;
}

async function docxFixture(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function pdfFixture(text: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText(text, { x: 40, y: 700, font, size: 14 });
  return Buffer.from(await pdf.save());
}

async function extractedAttachmentText(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('aether.local.history');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<string[]>((resolve, reject) => {
      const request = database.transaction('attachments').objectStore('attachments').getAll();
      request.onsuccess = () => resolve(request.result.map((entry) => entry.extractedText ?? ''));
      request.onerror = () => reject(request.error);
    });
  });
}

test('landing downloads no model runtime and has exactly three modes without search', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.reload();
  await expect(page.locator('[data-mode]')).toHaveCount(3);
  await expect(page.getByRole('button', { name: /search/i })).toHaveCount(0);
  await expect(page.locator('[data-onboarding-step]')).toHaveCount(3);
  expect(requested.filter((url) => /huggingface\.co|text-worker|media-worker|audio-model|transformers\.web|\.onnx(?:\?|$)|\.wasm(?:\?|$)/i.test(url))).toEqual([]);
});

test('onboarding leads to explicit LFM text model download and local chat', async ({ page }) => {
  await finishOnboarding(page);
  const header = await page.locator('.workspace-header').boundingBox();
  const modelPill = await page.locator('#model-pill').boundingBox();
  expect(header).not.toBeNull();
  expect(modelPill).not.toBeNull();
  expect(Math.abs((modelPill!.x + modelPill!.width / 2) - (header!.x + header!.width / 2))).toBeLessThanOrEqual(2);
  await expect(page.getByLabel('Attach document')).toBeVisible();
  await expect(page.getByLabel('Start recording')).toBeHidden();
  await expect(page.locator('.mode-chip, .attachment-menu')).toHaveCount(0);
  await page.getByLabel('Message Aether').fill('Give me one local idea');
  await page.getByLabel('Send message').click();
  await expect(page.getByText(/private local response/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#recent-list .recent-item')).toHaveCount(1);
});

test('text input stays locked until the user manually loads the model', async ({ page }) => {
  const onboarding = page.locator('#onboarding-dialog');
  await onboarding.getByRole('button', { name: 'Continue' }).click();
  await onboarding.getByRole('button', { name: 'Continue' }).click();
  await onboarding.getByRole('button', { name: 'Choose text model' }).click();
  await page.getByLabel('Close model picker').click();
  await expect(page.getByLabel('Message Aether')).toBeDisabled();
  await expect(page.locator('#composer-preparation')).toContainText(/Load LFM 2.5 .* to continue/i);
  await page.locator('#composer-preparation').getByRole('button', { name: 'Load model' }).click();
  await expect(page.locator('#composer-preparation-percent')).toContainText(/\d+%/);
  await expect(page.getByLabel('Message Aether')).toBeEnabled({ timeout: 10_000 });
});

test('Thinking model exposes a toggle and saves collapsible reasoning separately', async ({ page }) => {
  await finishOnboarding(page);
  await expect(page.getByLabel('Enable thinking')).toBeHidden();
  await page.getByLabel('Choose local model').click();
  await page.locator('.model-entry').filter({ hasText: 'LFM 2.5 1.2B Thinking' }).getByRole('button', { name: 'Download' }).click();
  await expect(page.getByLabel('Enable thinking')).toBeVisible({ timeout: 10_000 });
  await page.getByLabel('Enable thinking').click();
  await expect(page.getByLabel('Disable thinking')).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Message Aether').fill('What is 21 times 2?');
  await page.getByLabel('Send message').click();
  await expect(page.locator('.thinking-block[open]')).toBeVisible();
  await expect(page.getByText(/private local response/i)).toBeVisible({ timeout: 10_000 });
  const thinking = page.locator('.thinking-block').last();
  await expect(thinking).not.toHaveAttribute('open');
  await expect(thinking.locator('.thinking-content')).toContainText(/identify the request/i);
  await thinking.locator('summary').click();
  await expect(thinking).toHaveAttribute('open', '');
  await page.reload();
  await reopenFirstRecent(page);
  await expect(page.locator('.thinking-block')).toHaveCount(1);
  await expect(page.locator('.thinking-block')).not.toHaveAttribute('open');
});

test('returning user skips onboarding and unsupported WebGPU is explained', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('aether.preferences.v2', JSON.stringify({
    version: 2, onboardingComplete: true, activeMode: 'text', compactSidebar: false,
    selectedModelByMode: { text: 'onnx-community/LFM2.5-350M-ONNX', vision: 'LiquidAI/LFM2.5-VL-450M-ONNX', audio: 'LiquidAI/LFM2.5-Audio-1.5B-ONNX' }
  })));
  await page.goto('/?mockEngine=1&mockMedia=1&forceNoWebGPU=1');
  await expect(page.locator('#onboarding-dialog')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'WebGPU is required' })).toBeVisible();
});

test('low storage blocks a requested model download with a toast', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: async () => ({ usage: 90, quota: 100 }), persisted: async () => false, persist: async () => false } }));
  await page.reload();
  const onboarding = page.locator('#onboarding-dialog');
  await onboarding.getByRole('button', { name: 'Continue' }).click();
  await onboarding.getByRole('button', { name: 'Continue' }).click();
  await onboarding.getByRole('button', { name: 'Choose text model' }).click();
  await page.locator('.model-entry').first().getByRole('button', { name: 'Download' }).click();
  await expect(page.locator('.toast.error')).toContainText(/not enough storage/i);
});

test('vision selects an image first, then loads its model before enabling send', async ({ page }) => {
  await finishOnboarding(page);
  await switchToMode(page, 'vision');
  await expect(page.getByLabel('Attach image')).toBeHidden();
  await expect(page.getByLabel('Start recording')).toBeHidden();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Select image' }).click();
  await (await chooser).setFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64') });
  await expect(page.getByLabel('Attach image')).toBeVisible();
  await expect(page.locator('#composer-preparation')).toBeVisible();
  await expect(page.locator('#composer-preparation')).toContainText(/Load LFM 2.5 VL 450M to continue/i);
  await expect(page.getByLabel('Send message')).toBeDisabled();
  await page.getByLabel('Message Aether').fill('Explain this image');
  await page.locator('#composer-preparation').getByRole('button', { name: 'Load model' }).click();
  await expect(page.getByLabel('Send message')).toBeEnabled({ timeout: 10_000 });
  await page.getByLabel('Send message').click();
  await expect(page.getByText(/vision model directly analyzed/i)).toBeVisible({ timeout: 10_000 });
  await page.getByLabel('Message Aether').fill('What about the same image?');
  await page.getByLabel('Send message').click();
  await expect(page.getByText(/same image/i).last()).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await reopenFirstRecent(page);
  await expect(page.getByText('Explain this image')).toBeVisible();
  await expect(page.locator('.message-media')).toHaveCount(1);
});

test('text mode extracts a local text document and saves it with history', async ({ page }) => {
  await finishOnboarding(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByLabel('Attach document').click();
  await (await chooser).setFiles({ name: 'invoice.txt', mimeType: 'text/plain', buffer: Buffer.from('Invoice total is 42 dollars.') });
  await expect(page.locator('#attachment-tray').getByText('invoice.txt')).toBeVisible();
  await page.getByLabel('Message Aether').fill('What is the invoice total?');
  await page.getByLabel('Send message').click();
  await expect(page.getByText(/private local response/i)).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await reopenFirstRecent(page);
  await expect(page.getByText('invoice.txt')).toBeVisible();
});

test('document generation recovers once from an invalid WebGPU buffer', async ({ page }) => {
  await finishOnboarding(page);
  await page.goto('/?mockEngine=1&mockMedia=1&mockGpuFailure=1');
  const chooser = page.waitForEvent('filechooser');
  await page.getByLabel('Attach document').click();
  await (await chooser).setFiles({ name: 'report.txt', mimeType: 'text/plain', buffer: Buffer.from('The report status is healthy.') });
  await page.locator('#composer-preparation').getByRole('button', { name: 'Load model' }).click();
  await expect(page.getByLabel('Message Aether')).toBeEnabled({ timeout: 10_000 });
  await page.getByLabel('Message Aether').fill('What is the report status?');
  await expect(page.getByLabel('Send message')).toBeEnabled({ timeout: 10_000 });
  await page.getByLabel('Send message').click();
  await expect(page.getByText(/private local response/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.toast').filter({ hasText: 'Invalid Buffer' })).toHaveCount(0);
  await expect(page.locator('.toast.error')).toHaveCount(0);
});

test('file picker opens first, then cold model preparation shows inline progress', async ({ page }) => {
  await finishOnboarding(page);
  await page.evaluate(async () => {
    const model = 'onnx-community/LFM2.5-350M-ONNX';
    const revision = '2c07371c2e84776cad597f3d813b7d306d292aea';
    const cache = await caches.open('transformers-cache');
    for (const file of ['config.json', 'tokenizer.json', 'onnx/model_q4.onnx']) {
      await cache.put(`https://huggingface.co/${model}/resolve/${revision}/${file}`, new Response('cached'));
    }
  });
  await page.reload();
  const chooser = page.waitForEvent('filechooser');
  await page.getByLabel('Attach document').click();
  await (await chooser).setFiles({ name: 'ready.txt', mimeType: 'text/plain', buffer: Buffer.from('Prepared locally.') });
  await expect(page.locator('#attachment-tray').getByText('ready.txt')).toBeVisible();
  await expect(page.locator('#composer-preparation')).toBeVisible();
  await expect(page.locator('#composer-preparation')).toContainText(/Load LFM 2.5 350M to continue/i);
  await expect(page.getByLabel('Send message')).toBeDisabled();
  await page.locator('#composer-preparation').getByRole('button', { name: 'Load model' }).click();
  await expect(page.locator('#composer-preparation-percent')).toContainText(/\d+%/);
  await expect(page.getByLabel('Send message')).toBeEnabled({ timeout: 10_000 });
  await expect(page.locator('#model-modal-backdrop')).toBeHidden();
});

test('PDF and DOCX text are extracted locally by lazy document runtimes', async ({ page }) => {
  await finishOnboarding(page);
  for (const file of [
    { name: 'local.pdf', mimeType: 'application/pdf', buffer: await pdfFixture('PDF secret is violet.') },
    { name: 'local.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await docxFixture('DOCX secret is amber.') }
  ]) {
    const chooser = page.waitForEvent('filechooser');
    await page.getByLabel('Attach document').click();
    await (await chooser).setFiles(file);
  }
  await expect.poll(async () => (await extractedAttachmentText(page)).join(' ')).toContain('PDF secret is violet');
  await expect.poll(async () => (await extractedAttachmentText(page)).join(' ')).toContain('DOCX secret is amber');
});

test('audio mode uploads audio, saves transcript, and restores playable response', async ({ page }) => {
  await finishOnboarding(page);
  await switchToMode(page, 'audio');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose audio file' }).click();
  await (await chooser).setFiles({ name: 'voice.wav', mimeType: 'audio/wav', buffer: speechFixture() });
  await expect(page.locator('#composer-preparation')).toBeVisible();
  await expect(page.locator('#composer-preparation')).toContainText(/Load LFM 2.5 Audio 1.5B to continue/i);
  await expect(page.getByLabel('Send message')).toBeDisabled();
  await page.getByLabel('Message Aether').fill('Reply briefly');
  await page.locator('#composer-preparation').getByRole('button', { name: 'Load model' }).click();
  await expect(page.getByLabel('Send message')).toBeEnabled({ timeout: 10_000 });
  await page.getByLabel('Send message').click();
  await expect(page.locator('.message-row.user .message-content')).toContainText('Mock local transcription', { timeout: 10_000 });
  await expect(page.locator('.message-audio')).toHaveCount(2);
  await page.reload();
  await reopenFirstRecent(page);
  await expect(page.locator('.message-row.user .message-content')).toContainText('Mock local transcription');
  await expect(page.locator('.message-audio')).toHaveCount(2);
});

test('settings hides chat and can clear all saved history', async ({ page }) => {
  await finishOnboarding(page);
  await page.getByLabel('Message Aether').fill('Save this chat');
  await page.getByLabel('Send message').click();
  if (await page.getByLabel('Open navigation').isVisible()) await page.getByLabel('Open navigation').click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByLabel('Message Aether')).toBeHidden();
  await page.getByRole('button', { name: 'Clear all history' }).click();
  await page.locator('#confirm-accept').click();
  await expect(page.locator('#recent-list .recent-item')).toHaveCount(0);
});

test('onboarding and workspace fit a 390 by 844 viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await page.locator('#onboarding-dialog').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  await finishOnboarding(page);
  await expect(page.getByLabel('Message Aether')).toBeVisible();
});
