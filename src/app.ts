import { registerSW } from 'virtual:pwa-register';
import { detectCapabilities, readStorageSnapshot, type CapabilityReport } from './capabilities';
import { trimConversation } from './context';
import { createTextEngine, type TextEngine } from './engine-client';
import { renderMarkdown } from './markdown';
import { createMediaClient, type MediaEngine } from './media-client';
import { getModel, MODEL_CATALOG, modelSupportsBackend, recommendedModel, TEXT_MODELS } from './models';
import { loadPreferences, savePreferences } from './preferences';
import { RuntimeStateMachine } from './state-machine';
import {
  formatBytes,
  hasStorageCapacity,
  isModelCached,
  removeCachedModelId,
  removeModelFromCache,
  removeStaleModelCache,
  requestPersistentStorage
} from './storage';
import type { AppPreferencesV1, ChatMessage, EngineProgress, ModelDescriptor } from './types';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing required element #${id}`);
  return found as T;
}

const appShell = element<HTMLDivElement>('app-shell');
const sidebar = element<HTMLElement>('sidebar');
const sidebarScrim = element<HTMLDivElement>('sidebar-scrim');
const chatMessages = element<HTMLDivElement>('chat-messages');
const welcomeCard = element<HTMLDivElement>('welcome-card');
const setupCard = element<HTMLElement>('setup-card');
const setupIcon = element<HTMLDivElement>('setup-icon');
const setupEyebrow = element<HTMLSpanElement>('setup-eyebrow');
const setupTitle = element<HTMLHeadingElement>('setup-title');
const setupDescription = element<HTMLParagraphElement>('setup-description');
const setupProgressTrack = element<HTMLDivElement>('setup-progress-track');
const setupProgress = element<HTMLDivElement>('setup-progress');
const setupMeta = element<HTMLDivElement>('setup-meta');
const setupPrimary = element<HTMLButtonElement>('setup-primary');
const setupCancel = element<HTMLButtonElement>('setup-cancel');
const promptInput = element<HTMLTextAreaElement>('prompt-input');
const sendButton = element<HTMLButtonElement>('send-button');
const stopButton = element<HTMLButtonElement>('stop-button');
const micButton = element<HTMLButtonElement>('mic-button');
const imageInput = element<HTMLInputElement>('image-input');
const attachmentPreview = element<HTMLDivElement>('attachment-preview');
const attachmentImage = element<HTMLImageElement>('attachment-image');
const attachmentName = element<HTMLElement>('attachment-name');
const onboardingBackdrop = element<HTMLDivElement>('onboarding-backdrop');
const onboardingDialog = element<HTMLDivElement>('onboarding-dialog');
const onboardingBackend = element<HTMLElement>('onboarding-backend');
const onboardingModel = element<HTMLElement>('onboarding-model');
const onboardingDownload = element<HTMLElement>('onboarding-download');
const onboardingStorage = element<HTMLElement>('onboarding-storage');
const onboardingStart = element<HTMLButtonElement>('onboarding-start');
const preflightMessage = element<HTMLParagraphElement>('preflight-message');
const onboardingModelPicker = element<HTMLLabelElement>('onboarding-model-picker');
const onboardingModelSelect = element<HTMLSelectElement>('onboarding-model-select');
const activeModelName = element<HTMLElement>('active-model-name');
const modelPill = element<HTMLButtonElement>('model-pill');
const connectionPill = element<HTMLSpanElement>('connection-pill');
const modelGrid = element<HTMLDivElement>('model-grid');
const speakToggle = element<HTMLInputElement>('speak-toggle');
const toastRegion = element<HTMLDivElement>('toast-region');

const machine = new RuntimeStateMachine();
let capabilities: CapabilityReport;
let preferences: AppPreferencesV1;
let selectedModel: ModelDescriptor;
let engine: TextEngine = createTextEngine();
let mediaClient: MediaEngine | null = null;
let mediaBusy = false;
let activeImageContext: { dataUrl: string; name: string } | null = null;
let lastVisionTurn: { image: { dataUrl: string; name: string }; prompt: string } | null = null;
let messages: ChatMessage[] = [
  {
    role: 'system',
    content: 'You are Aether, a concise and helpful private assistant running locally in the user’s browser. Do not expose hidden reasoning. Give the answer directly.'
  }
];
let onboardingStep = 1;
let loadedModelId = '';
let pendingImage: { dataUrl: string; name: string } | null = null;
let lastAssistantElement: HTMLElement | null = null;
let recorder: MediaRecorder | null = null;
let recordingStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;

function showToast(message: string, tone: 'default' | 'success' | 'error' = 'default', duration = 3600): void {
  const toast = document.createElement('div');
  toast.className = `toast ${tone === 'default' ? '' : tone}`;
  toast.textContent = message;
  toastRegion.append(toast);
  setTimeout(() => toast.remove(), duration);
}

function setInteractive(ready: boolean): void {
  promptInput.disabled = !ready;
  micButton.disabled = !ready || capabilities.backend !== 'webgpu';
  sendButton.disabled = !ready || (!promptInput.value.trim() && !pendingImage);
}

function setRuntimeState(next: Parameters<RuntimeStateMachine['transition']>[0]): void {
  if (!machine.canTransition(next)) return;
  machine.transition(next);
  document.body.dataset.runtimeState = next;
  const generating = next === 'generating';
  stopButton.classList.toggle('hidden', !generating);
  sendButton.classList.toggle('hidden', generating);
  setInteractive(next === 'ready');
  modelPill.classList.toggle('ready', next === 'ready' || next === 'generating');
}

function closeSidebar(): void {
  sidebar.classList.remove('open');
  sidebarScrim.classList.remove('active');
}

function switchView(view: 'chat' | 'models' | 'settings'): void {
  document.querySelectorAll<HTMLElement>('[data-view-panel]').forEach((panel) => {
    const active = panel.dataset.viewPanel === view;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  element<HTMLElement>('view-title').textContent = view[0]?.toUpperCase() + view.slice(1);
  if (view === 'models') void renderModels();
  if (view === 'settings') void updateStorageUI();
  closeSidebar();
}

function updateConnection(): void {
  const online = navigator.onLine;
  connectionPill.classList.toggle('offline', !online);
  connectionPill.lastChild!.textContent = online ? 'Online' : 'Offline';
}

function updateSelectedModelUI(): void {
  activeModelName.textContent = selectedModel.name;
  onboardingModel.textContent = selectedModel.name;
  onboardingDownload.textContent = formatBytes(selectedModel.downloadBytes);
  preferences.selectedModelId = selectedModel.id;
  preferences.backend = capabilities.backend;
  savePreferences(preferences);
}

function selectModel(model: ModelDescriptor): void {
  if (!modelSupportsBackend(model, capabilities.backend)) {
    showToast(`${model.name} requires WebGPU on this device.`, 'error');
    return;
  }
  selectedModel = model;
  updateSelectedModelUI();
  void renderModels();
  void refreshSetupCard();
}

async function refreshSetupCard(): Promise<void> {
  const cached = await isModelCached(selectedModel);
  if (machine.state === 'ready' || machine.state === 'generating') {
    setupCard.classList.add('hidden');
    return;
  }
  setupCard.classList.remove('hidden');
  setupIcon.textContent = cached ? '✓' : '↓';
  setupEyebrow.textContent = cached ? 'CACHED MODEL' : 'LOCAL MODEL';
  setupTitle.textContent = cached ? `${selectedModel.name} is stored locally` : 'Your model is ready to download';
  setupDescription.textContent = cached
    ? 'Load the cached model into memory to begin a private session.'
    : `Download ${selectedModel.name} once. Prompts stay on this device.`;
  setupMeta.textContent = `${capabilities.backend === 'webgpu' ? 'WebGPU acceleration' : 'WASM · slower CPU mode'} · ${formatBytes(selectedModel.downloadBytes)} · ${selectedModel.license}`;
  setupPrimary.textContent = cached ? 'Load model' : 'Download & start';
  setupPrimary.disabled = false;
  setupProgressTrack.hidden = true;
  setupCancel.classList.add('hidden');
}

function updateSetupProgress(progress: EngineProgress): void {
  setRuntimeState(progress.status === 'warming' ? 'warming' : 'downloading');
  setupCard.classList.remove('hidden');
  setupProgressTrack.hidden = false;
  setupProgress.style.width = `${progress.percent}%`;
  setupEyebrow.textContent = progress.status === 'warming' ? 'PREPARING MODEL' : 'DOWNLOADING MODEL';
  setupTitle.textContent = progress.status === 'warming' ? 'Warming up the local engine' : `Downloading ${selectedModel.name}`;
  setupDescription.textContent = progress.file ? `Preparing ${progress.file.split('/').at(-1)}` : 'Preparing model files…';
  setupMeta.textContent = progress.total > 0
    ? `${formatBytes(progress.loaded)} of ${formatBytes(progress.total)} · ${progress.percent}%`
    : `${progress.percent}% complete`;
  setupPrimary.disabled = true;
  setupCancel.classList.remove('hidden');
}

function showSetupError(error: unknown): void {
  setRuntimeState('error');
  const message = error instanceof Error ? error.message : String(error);
  setupCard.classList.remove('hidden');
  setupIcon.textContent = '!';
  setupEyebrow.textContent = 'SETUP NEEDS ATTENTION';
  setupTitle.textContent = 'The local model could not start';
  setupDescription.textContent = message;
  setupMeta.textContent = navigator.onLine ? 'Retry or choose a smaller model.' : 'Reconnect to download a model that is not already cached.';
  setupProgressTrack.hidden = true;
  setupPrimary.disabled = false;
  setupPrimary.textContent = 'Retry setup';
  setupCancel.classList.add('hidden');
  showToast(message, 'error', 6000);
}

async function prepareModel(userInitiated: boolean): Promise<void> {
  try {
    setRuntimeState('preflight');
    setupCard.classList.remove('hidden');
    setupPrimary.disabled = true;
    const cached = await isModelCached(selectedModel);
    const storage = await readStorageSnapshot();
    if (!cached && !navigator.onLine) throw new Error('This model is not cached yet. Reconnect once to download it.');
    if (!cached && !hasStorageCapacity(storage, selectedModel)) {
      throw new Error(`Not enough browser storage. Free at least ${formatBytes(selectedModel.downloadBytes * 1.25)} and try again.`);
    }
    if (userInitiated) void requestPersistentStorage();
    await engine.initialize(selectedModel, capabilities.backend, updateSetupProgress);
    loadedModelId = selectedModel.id;
    setRuntimeState('ready');
    setupCard.classList.add('hidden');
    welcomeCard.classList.remove('hidden');
    preferences.onboardingComplete = true;
    savePreferences(preferences);
    updateSelectedModelUI();
    await Promise.all([renderModels(), updateStorageUI()]);
    promptInput.focus();
    showToast(`${selectedModel.name} is ready.`, 'success');
  } catch (error) {
    if (error instanceof Error && (error as Error & { code?: string }).code === 'CANCELLED') {
      setRuntimeState('preflight');
      await refreshSetupCard();
      showToast('Model setup cancelled.');
      return;
    }
    showSetupError(error);
  }
}

function appendUserMessage(text: string, image?: string): void {
  welcomeCard.classList.add('hidden');
  const row = document.createElement('article');
  row.className = 'message user';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  if (image) {
    const preview = document.createElement('img');
    preview.src = image;
    preview.alt = 'Attached image';
    preview.style.cssText = 'display:block;max-width:240px;max-height:180px;object-fit:cover;border-radius:10px;margin-bottom:8px';
    bubble.append(preview);
  }
  const paragraph = document.createElement('p');
  paragraph.textContent = text || 'Describe this image.';
  paragraph.style.margin = '0';
  bubble.append(paragraph);
  row.append(bubble);
  chatMessages.append(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

interface AssistantMessageView {
  row: HTMLElement;
  content: HTMLElement;
  meta: HTMLElement;
}

function createAssistantMessage(): AssistantMessageView {
  const row = document.createElement('article');
  row.className = 'message assistant';
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = '✦';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  const content = document.createElement('div');
  content.className = 'response-content';
  content.innerHTML = '<span class="typing-dots" aria-label="Generating"><i></i><i></i><i></i></span>';
  const actions = document.createElement('div');
  actions.className = 'message-actions';
  const meta = document.createElement('span');
  meta.className = 'generation-meta';
  actions.append(meta);
  bubble.append(content, actions);
  row.append(avatar, bubble);
  chatMessages.append(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  lastAssistantElement = row;
  return { row, content, meta };
}

function decorateAnswer(row: HTMLElement, text: string): void {
  const actions = row.querySelector<HTMLElement>('.message-actions');
  if (!actions || actions.querySelector('button')) return;
  const copy = document.createElement('button');
  copy.textContent = 'Copy';
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(text);
    showToast('Response copied.', 'success');
  });
  const regenerate = document.createElement('button');
  regenerate.textContent = 'Regenerate';
  regenerate.addEventListener('click', () => void regenerateLast());
  actions.prepend(copy, regenerate);
  row.querySelectorAll<HTMLAnchorElement>('a').forEach((link) => {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  });
}

async function runGeneration(inputMessages: ChatMessage[]): Promise<void> {
  const assistant = createAssistantMessage();
  setRuntimeState('generating');
  try {
    const result = await engine.generate(inputMessages, 512, (text, tokens, elapsedMs) => {
      if (text) assistant.content.innerHTML = renderMarkdown(text);
      assistant.meta.textContent = `${tokens} tokens · ${(elapsedMs / 1000).toFixed(1)}s`;
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });
    const answer = result.text.trim() || (result.cancelled ? 'Generation stopped.' : 'No response was generated.');
    assistant.content.innerHTML = renderMarkdown(answer);
    const tps = result.elapsedMs > 0 ? result.tokenCount / (result.elapsedMs / 1000) : 0;
    assistant.meta.textContent = result.cancelled
      ? 'Stopped'
      : `${result.tokenCount} tokens · ${tps.toFixed(1)} tok/s · ${(result.elapsedMs / 1000).toFixed(1)}s`;
    decorateAnswer(assistant.row, answer);
    if (!result.cancelled) messages.push({ role: 'assistant', content: answer });
    setRuntimeState('ready');
    if (preferences.speakResponses && !result.cancelled) void speakAnswer(answer);
  } catch (error) {
    assistant.content.innerHTML = renderMarkdown(`**Local engine error:** ${error instanceof Error ? error.message : String(error)}`);
    assistant.meta.textContent = 'Retry available';
    decorateAnswer(assistant.row, '');
    setRuntimeState('error');
    showSetupError(error);
  }
}

async function sendMessage(): Promise<void> {
  if (machine.state !== 'ready' || mediaBusy) return;
  const prompt = promptInput.value.trim();
  if (!prompt && !pendingImage) return;
  const image = pendingImage;
  appendUserMessage(prompt, image?.dataUrl);
  promptInput.value = '';
  resizePrompt();
  clearAttachment();

  if (image) {
    await processImageMessage(image, prompt || 'Describe this image.');
    return;
  }

  if (activeImageContext) {
    await processImageMessage(activeImageContext, prompt);
    return;
  }

  lastVisionTurn = null;
  messages.push({ role: 'user', content: prompt });
  const trimmed = trimConversation(messages, selectedModel.contextTokens);
  if (trimmed.trimmed) showToast('Older turns were left out to fit this model’s context.');
  await runGeneration(trimmed.messages);
}

async function processImageMessage(
  image: { dataUrl: string; name: string },
  prompt: string,
  recordUser = true
): Promise<void> {
  const status = createAssistantMessage();
  mediaBusy = true;
  setInteractive(false);
  status.content.textContent = 'Preparing LFM2.5 visual reasoning…';
  status.meta.textContent = 'First use downloads the local vision model';

  try {
    const answer = await getMediaClient().analyzeImage(image.dataUrl, prompt, capabilities.backend, (progress) => {
      status.content.textContent = progress.status === 'warming'
        ? 'Starting LFM2.5 visual reasoning…'
        : 'Downloading LFM2.5 vision…';
      status.meta.textContent = progress.total > 0
        ? `${formatBytes(progress.loaded)} of ${formatBytes(progress.total)} · ${progress.percent}%`
        : `${progress.percent}%`;
    });
    if (!answer.trim()) throw new Error('LFM2.5 vision returned an empty response.');
    status.content.innerHTML = renderMarkdown(answer);
    status.meta.textContent = 'LFM2.5 VL 450M · local WebGPU';
    decorateAnswer(status.row, answer);
    if (recordUser) messages.push({ role: 'user', content: prompt });
    messages.push({ role: 'assistant', content: answer });
    activeImageContext = image;
    lastVisionTurn = { image, prompt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    status.content.innerHTML = renderMarkdown(`**Visual reasoning could not start.**\n\n${message}`);
    status.meta.textContent = 'The image stayed on this device';
    const actions = status.row.querySelector<HTMLElement>('.message-actions');
    const retry = document.createElement('button');
    retry.textContent = 'Retry image';
    retry.addEventListener('click', () => {
      if (mediaBusy) return;
      status.row.remove();
      void processImageMessage(image, prompt, recordUser);
    });
    actions?.prepend(retry);
    showToast(`Visual reasoning failed: ${message}`, 'error', 7000);
  } finally {
    mediaBusy = false;
    if (machine.state === 'ready') setInteractive(true);
  }
}

async function regenerateLast(): Promise<void> {
  if (machine.state !== 'ready') return;
  if (lastVisionTurn) {
    if (messages.at(-1)?.role === 'assistant') messages.pop();
    lastAssistantElement?.remove();
    await processImageMessage(lastVisionTurn.image, lastVisionTurn.prompt, false);
    return;
  }
  if (messages.at(-1)?.role === 'assistant') messages.pop();
  lastAssistantElement?.remove();
  const trimmed = trimConversation(messages, selectedModel.contextTokens);
  await runGeneration(trimmed.messages);
}

function resizePrompt(): void {
  promptInput.style.height = 'auto';
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 180)}px`;
  sendButton.disabled = machine.state !== 'ready' || (!promptInput.value.trim() && !pendingImage);
}

function clearAttachment(): void {
  pendingImage = null;
  imageInput.value = '';
  attachmentImage.removeAttribute('src');
  attachmentPreview.classList.add('hidden');
  resizePrompt();
}

function getMediaClient(): MediaEngine {
  mediaClient ??= createMediaClient();
  return mediaClient;
}

async function speakAnswer(text: string): Promise<void> {
  try {
    showToast('Preparing local speech…');
    const output = await getMediaClient().speak(text.slice(0, 1800), capabilities.backend);
    audioContext ??= new AudioContext();
    await audioContext.resume();
    const buffer = audioContext.createBuffer(1, output.samples.length, output.sampleRate);
    buffer.copyToChannel(new Float32Array(output.samples), 0);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start();
  } catch (error) {
    showToast(`Speech output failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

function downsample(input: Float32Array, fromRate: number, toRate = 16_000): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const output = new Float32Array(Math.round(input.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.round(index * ratio);
    const end = Math.min(input.length, Math.round((index + 1) * ratio));
    let sum = 0;
    for (let source = start; source < end; source += 1) sum += input[source] ?? 0;
    output[index] = sum / Math.max(1, end - start);
  }
  return output;
}

async function toggleRecording(): Promise<void> {
  if (recorder?.state === 'recording') {
    recorder.stop();
    return;
  }
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks: Blob[] = [];
    recorder = new MediaRecorder(recordingStream);
    recorder.addEventListener('dataavailable', (event) => chunks.push(event.data));
    recorder.addEventListener('stop', async () => {
      recordingStream?.getTracks().forEach((track) => track.stop());
      recordingStream = null;
      micButton.classList.remove('recording');
      micButton.textContent = '⌁';
      try {
        audioContext ??= new AudioContext();
        const data = await new Blob(chunks).arrayBuffer();
        const decoded = await audioContext.decodeAudioData(data);
        const samples = downsample(decoded.getChannelData(0), decoded.sampleRate, 24_000);
        showToast('Transcribing locally…');
        const text = await getMediaClient().transcribe(samples, 24_000, capabilities.backend);
        promptInput.value = `${promptInput.value} ${text}`.trim();
        resizePrompt();
        promptInput.focus();
      } catch (error) {
        showToast(`Voice input failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
    });
    recorder.start();
    micButton.classList.add('recording');
    micButton.textContent = '■';
    showToast('Listening… Select the microphone again to stop.');
  } catch {
    showToast('Microphone access was not granted.', 'error');
  }
}

async function renderModels(): Promise<void> {
  const statuses = await Promise.all(TEXT_MODELS.map((model) => isModelCached(model)));
  modelGrid.replaceChildren();
  TEXT_MODELS.forEach((model, index) => {
    const supported = modelSupportsBackend(model, capabilities.backend);
    const cached = statuses[index] ?? false;
    const active = selectedModel.id === model.id;
    const card = document.createElement('article');
    card.className = `model-card ${active ? 'active' : ''}`;
    card.innerHTML = `
      <div class="model-card-header">
        <div><h3>${model.name}</h3><div class="model-publisher">${model.publisher}</div></div>
        <span>${model.tier === 'quality' ? 'Optional' : model.tier}</span>
      </div>
      <p class="model-description">${model.description}</p>
      <div class="model-facts"><span>${formatBytes(model.downloadBytes)}</span><span>${model.dtype[capabilities.backend] ?? 'Unsupported'}</span><span>${model.license}</span></div>
      <div class="model-status">${!supported ? 'WebGPU is required' : cached ? 'Downloaded in this browser' : 'Not downloaded'}</div>
      <div class="button-row"></div>`;
    const actions = card.querySelector<HTMLDivElement>('.button-row')!;
    const use = document.createElement('button');
    use.className = `button ${active ? 'secondary' : 'primary'}`;
    use.textContent = active && loadedModelId === model.id ? 'Active' : cached ? 'Use model' : 'Download & use';
    use.disabled = !supported || (active && loadedModelId === model.id);
    use.addEventListener('click', async () => {
      if (loadedModelId && loadedModelId !== model.id) {
        await engine.dispose();
        engine = createTextEngine();
        loadedModelId = '';
      }
      selectModel(model);
      switchView('chat');
      await prepareModel(true);
    });
    actions.append(use);
    if (cached) {
      const remove = document.createElement('button');
      remove.className = 'button ghost';
      remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        if (loadedModelId === model.id) {
          await engine.dispose();
          engine = createTextEngine();
          loadedModelId = '';
          setRuntimeState('preflight');
        }
        await removeModelFromCache(model);
        await Promise.all([renderModels(), refreshSetupCard(), updateStorageUI()]);
        showToast(`${model.name} was removed from browser storage.`);
      });
      actions.append(remove);
    }
    modelGrid.append(card);
  });
}

async function updateStorageUI(): Promise<void> {
  const storage = await readStorageSnapshot();
  element<HTMLElement>('storage-used').textContent = formatBytes(storage.usage);
  element<HTMLElement>('storage-available').textContent = storage.quota ? formatBytes(storage.available) : 'Browser managed';
  element<HTMLElement>('storage-persisted').textContent = storage.persisted ? 'Enabled' : 'Best effort';
  element<HTMLElement>('storage-model').textContent = await isModelCached(selectedModel) ? 'Downloaded' : 'Not cached';
}

function populateModelSelect(): void {
  onboardingModelSelect.replaceChildren();
  TEXT_MODELS.filter((model) => modelSupportsBackend(model, capabilities.backend)).forEach((model) => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = `${model.name} · ${formatBytes(model.downloadBytes)}`;
    option.selected = model.id === selectedModel.id;
    onboardingModelSelect.append(option);
  });
}

async function updateOnboardingReadiness(): Promise<void> {
  const storage = await readStorageSnapshot();
  capabilities.storage = storage;
  onboardingBackend.textContent = capabilities.backend === 'webgpu' ? 'WebGPU · accelerated' : 'WASM · CPU fallback';
  onboardingStorage.textContent = storage.quota ? formatBytes(storage.available) : 'Browser managed';
  updateSelectedModelUI();
  populateModelSelect();
  const capacity = hasStorageCapacity(storage, selectedModel);
  const secure = globalThis.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  preflightMessage.textContent = !secure
    ? 'A secure HTTPS connection is required for browser acceleration and storage.'
    : !navigator.onLine
      ? 'Connect once to download the selected model.'
      : !capacity
        ? `Free at least ${formatBytes(selectedModel.downloadBytes * 1.25)} of browser storage.`
        : capabilities.backend === 'wasm'
          ? 'WebGPU was not available. CPU mode works, but generation will be slower.'
          : '';
  onboardingStart.disabled = !secure || !navigator.onLine || !capacity;
}

function setOnboardingStep(step: number): void {
  onboardingStep = Math.max(1, Math.min(3, step));
  document.querySelectorAll<HTMLElement>('[data-onboarding-step]').forEach((slide) => {
    const active = Number(slide.dataset.onboardingStep) === onboardingStep;
    slide.hidden = !active;
    slide.classList.toggle('active', active);
  });
  document.querySelectorAll<HTMLElement>('[data-step-dot]').forEach((dot) => {
    const value = Number(dot.dataset.stepDot);
    dot.classList.toggle('active', value === onboardingStep);
    dot.classList.toggle('done', value < onboardingStep);
  });
  if (onboardingStep === 3) void updateOnboardingReadiness();
  const firstFocusable = onboardingDialog.querySelector<HTMLElement>('[data-onboarding-step]:not([hidden]) button, [data-onboarding-step]:not([hidden]) select');
  firstFocusable?.focus();
}

function showOnboarding(): void {
  if (machine.canTransition('onboarding')) setRuntimeState('onboarding');
  appShell.inert = true;
  appShell.setAttribute('aria-hidden', 'true');
  onboardingBackdrop.classList.remove('hidden');
  setOnboardingStep(1);
  onboardingDialog.focus();
}

function hideOnboarding(): void {
  onboardingBackdrop.classList.add('hidden');
  appShell.inert = false;
  appShell.removeAttribute('aria-hidden');
}

function trapOnboardingFocus(event: KeyboardEvent): void {
  if (onboardingBackdrop.classList.contains('hidden') || event.key !== 'Tab') return;
  const focusable = [...onboardingDialog.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((item) => !item.closest<HTMLElement>('[hidden]'));
  if (!focusable.length) return;
  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function bindEvents(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.view as 'chat' | 'models' | 'settings'));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-view-target]').forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.viewTarget as 'chat' | 'models' | 'settings'));
  });
  element<HTMLButtonElement>('menu-button').addEventListener('click', () => {
    sidebar.classList.add('open');
    sidebarScrim.classList.add('active');
  });
  element<HTMLButtonElement>('sidebar-close').addEventListener('click', closeSidebar);
  sidebarScrim.addEventListener('click', closeSidebar);
  setupPrimary.addEventListener('click', () => void prepareModel(true));
  setupCancel.addEventListener('click', () => engine.cancel());
  sendButton.addEventListener('click', () => void sendMessage());
  stopButton.addEventListener('click', () => engine.cancel());
  promptInput.addEventListener('input', resizePrompt);
  promptInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void sendMessage();
    }
  });
  document.querySelectorAll<HTMLButtonElement>('.starter-prompt').forEach((button) => {
    button.addEventListener('click', () => {
      promptInput.value = button.dataset.prompt ?? '';
      resizePrompt();
      void sendMessage();
    });
  });
  element<HTMLButtonElement>('remove-attachment').addEventListener('click', clearAttachment);
  imageInput.addEventListener('change', async () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
      showToast('Choose a PNG, JPEG, or WebP image under 8 MB.', 'error');
      clearAttachment();
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(String(reader.result)));
      reader.addEventListener('error', () => reject(reader.error));
      reader.readAsDataURL(file);
    });
    pendingImage = { dataUrl, name: file.name };
    attachmentImage.src = dataUrl;
    attachmentName.textContent = file.name;
    attachmentPreview.classList.remove('hidden');
    resizePrompt();
  });
  micButton.addEventListener('click', () => void toggleRecording());

  document.querySelectorAll<HTMLButtonElement>('[data-onboarding-next]').forEach((button) => {
    button.addEventListener('click', () => setOnboardingStep(onboardingStep + 1));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-onboarding-back]').forEach((button) => {
    button.addEventListener('click', () => setOnboardingStep(onboardingStep - 1));
  });
  element<HTMLButtonElement>('change-onboarding-model').addEventListener('click', () => {
    onboardingModelPicker.classList.toggle('hidden');
    if (!onboardingModelPicker.classList.contains('hidden')) onboardingModelSelect.focus();
  });
  onboardingModelSelect.addEventListener('change', () => {
    const model = getModel(onboardingModelSelect.value);
    if (model) selectModel(model);
    void updateOnboardingReadiness();
  });
  onboardingStart.addEventListener('click', async () => {
    preferences.onboardingComplete = true;
    savePreferences(preferences);
    hideOnboarding();
    await prepareModel(true);
  });
  onboardingDialog.addEventListener('keydown', trapOnboardingFocus);

  element<HTMLButtonElement>('replay-onboarding').addEventListener('click', showOnboarding);
  speakToggle.addEventListener('change', () => {
    preferences.speakResponses = speakToggle.checked;
    savePreferences(preferences);
    if (speakToggle.checked) showToast('The local voice model will download after the next answer.');
  });
  element<HTMLButtonElement>('remove-model-button').addEventListener('click', async () => {
    if (loadedModelId === selectedModel.id) {
      await engine.dispose();
      engine = createTextEngine();
      loadedModelId = '';
      setRuntimeState('preflight');
    }
    await removeModelFromCache(selectedModel);
    await Promise.all([updateStorageUI(), renderModels(), refreshSetupCard()]);
    showToast(`${selectedModel.name} was removed from browser storage.`);
  });
  element<HTMLButtonElement>('clear-chat-button').addEventListener('click', () => {
    if (machine.state === 'generating') engine.cancel();
    messages = [messages[0]!];
    activeImageContext = null;
    lastVisionTurn = null;
    chatMessages.querySelectorAll('.message').forEach((message) => message.remove());
    lastAssistantElement = null;
    welcomeCard.classList.remove('hidden');
    showToast('Chat cleared. Nothing was saved.', 'success');
  });
  window.addEventListener('online', () => { updateConnection(); void refreshSetupCard(); });
  window.addEventListener('offline', updateConnection);
  window.addEventListener('error', (event) => {
    showToast(`Unexpected error: ${event.message || 'An unknown browser error occurred.'}`, 'error', 7000);
  });
  window.addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason ?? 'Unknown failure');
    showToast(`Unexpected error: ${reason}`, 'error', 7000);
  });
}

async function initializeApp(): Promise<void> {
  bindEvents();
  updateConnection();
  capabilities = await detectCapabilities();
  preferences = loadPreferences(capabilities.backend);
  const savedModel = getModel(preferences.selectedModelId);
  selectedModel = savedModel && modelSupportsBackend(savedModel, capabilities.backend)
    ? savedModel
    : recommendedModel(capabilities.backend);
  speakToggle.checked = preferences.speakResponses;
  updateSelectedModelUI();
  speakToggle.disabled = capabilities.backend !== 'webgpu';
  speakToggle.title = capabilities.backend === 'webgpu' ? '' : 'LFM2.5 Audio requires WebGPU.';
  const visionModel = MODEL_CATALOG.find((model) => model.task === 'vision-language');
  if (visionModel) {
    try {
      const removed = await removeStaleModelCache(visionModel);
      if (removed > 0) showToast('Removed an incompatible cached image model.', 'success');
    } catch (error) {
      showToast(`Could not clean old image-model files: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }
  try {
    const removedLegacyVision = await removeCachedModelId('Xenova/vit-gpt2-image-captioning');
    if (removedLegacyVision > 0) showToast('Removed the previous caption-only image model.', 'success');
  } catch (error) {
    showToast(`Could not clean the previous image model: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
  await Promise.all([renderModels(), updateStorageUI()]);

  if (!preferences.onboardingComplete) {
    showOnboarding();
  } else {
    setRuntimeState('preflight');
    const cached = await isModelCached(selectedModel);
    if (cached) await prepareModel(false);
    else await refreshSetupCard();
  }

  registerSW({
    immediate: false,
    onOfflineReady: () => showToast('Aether’s app shell is ready offline.', 'success'),
    onNeedRefresh: () => showToast('A new Aether version is available. Refresh when convenient.')
  });
}

void initializeApp().catch((error) => {
  console.error(error);
  showToast(`Aether could not start: ${error instanceof Error ? error.message : String(error)}`, 'error', 8000);
});
