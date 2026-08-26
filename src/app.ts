import { detectCapabilities, readStorageSnapshot, type CapabilityReport } from './capabilities';
import { trimConversation } from './context';
import { extractDocument, extensionOf, selectRelevantChunks, validateAttachment } from './documents';
import { createTextEngine, type GenerationResult, type TextEngine } from './engine-client';
import {
  clearHistory,
  createConversation,
  createMessage,
  deleteConversation,
  deriveConversationTitle,
  getConversation,
  getConversationAttachments,
  historyUsage,
  listConversations,
  saveAttachment,
  saveConversation
} from './history';
import { renderMarkdown } from './markdown';
import { createMediaClient, type MediaEngine } from './media-client';
import { getModel, MODEL_CATALOG, modelsForMode, recommendedModel } from './models';
import { loadPreferences, savePreferences } from './preferences';
import {
  formatBytes,
  hasStorageCapacity,
  isModelCached,
  removeModelFromCache,
  requestPersistentStorage
} from './storage';
import type {
  AppMode,
  AppPreferencesV2,
  AttachmentRecordV1,
  ChatMessage,
  ConversationRecordV1,
  EngineProgress,
  ModelDescriptor,
  PersistedMessageV1,
  ThemeMode
} from './types';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing interface element: ${id}`);
  return found as T;
}

const sidebar = element<HTMLElement>('sidebar');
const sidebarScrim = element<HTMLDivElement>('sidebar-scrim');
const chatView = element<HTMLElement>('chat-view');
const settingsView = element<HTMLElement>('settings-view');
const chatMessages = element<HTMLDivElement>('chat-messages');
const emptyState = element<HTMLElement>('empty-state');
const emptyIcon = element<HTMLDivElement>('empty-icon');
const emptyTitle = element<HTMLHeadingElement>('empty-title');
const emptyDescription = element<HTMLParagraphElement>('empty-description');
const emptyPrimary = element<HTMLButtonElement>('empty-primary');
const emptySecondary = element<HTMLButtonElement>('empty-secondary');
const composerDock = element<HTMLDivElement>('composer-dock');
const promptInput = element<HTMLTextAreaElement>('prompt-input');
const sendButton = element<HTMLButtonElement>('send-button');
const stopButton = element<HTMLButtonElement>('stop-button');
const attachButton = element<HTMLButtonElement>('attach-button');
const thinkingToggle = element<HTMLButtonElement>('thinking-toggle');
const attachmentTray = element<HTMLDivElement>('attachment-tray');
const composerPreparation = document.getElementById('composer-preparation') as HTMLDivElement;
const composerPreparationLabel = document.getElementById('composer-preparation-label') as HTMLSpanElement;
const composerPreparationPercent = document.getElementById('composer-preparation-percent') as HTMLElement;
const composerPreparationFill = document.getElementById('composer-preparation-fill') as HTMLDivElement;
const composerPreparationRetry = document.getElementById('composer-preparation-retry') as HTMLButtonElement;
const fileInput = element<HTMLInputElement>('file-input');
const modelPill = element<HTMLButtonElement>('model-pill');
const activeModelName = element<HTMLSpanElement>('active-model-name');
const recentList = element<HTMLDivElement>('recent-list');
const recentEmpty = element<HTMLParagraphElement>('recent-empty');
const historyCount = element<HTMLSpanElement>('history-count');
const modelModalBackdrop = element<HTMLDivElement>('model-modal-backdrop');
const modelModal = element<HTMLElement>('model-modal');
const modelModalTitle = element<HTMLHeadingElement>('model-modal-title');
const modelModalIntro = element<HTMLParagraphElement>('model-modal-intro');
const modelList = element<HTMLDivElement>('model-list');
const downloadPanel = element<HTMLElement>('download-panel');
const downloadTitle = element<HTMLHeadingElement>('download-title');
const downloadStage = element<HTMLParagraphElement>('download-stage');
const downloadModelName = element<HTMLElement>('download-model-name');
const downloadModelMeta = element<HTMLElement>('download-model-meta');
const downloadProgress = element<HTMLDivElement>('download-progress');
const downloadProgressText = element<HTMLParagraphElement>('download-progress-text');
const cancelDownload = element<HTMLButtonElement>('cancel-download');
const onboardingBackdrop = element<HTMLDivElement>('onboarding-backdrop');
const onboardingDialog = element<HTMLElement>('onboarding-dialog');
const confirmBackdrop = element<HTMLDivElement>('confirm-backdrop');
const confirmCopy = element<HTMLParagraphElement>('confirm-copy');
const toastRegion = element<HTMLDivElement>('toast-region');

const ACCEPT_BY_KIND: Record<'image' | 'document', string> = {
  image: 'image/png,image/jpeg,image/webp',
  document: '.pdf,.docx,.txt,.md,.csv,.json,.html,.htm,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};
const SYSTEM_PROMPT = 'You are NetlessLM, a helpful private assistant running locally in the browser. Answer clearly, accurately, and complete your thoughts.';
type PreparedAction = 'image' | 'document';

let capabilities: CapabilityReport;
let preferences: AppPreferencesV2;
let activeMode: AppMode = 'text';
let currentConversation: ConversationRecordV1 | null = null;
let attachments = new Map<string, AttachmentRecordV1>();
let pendingAttachmentIds: string[] = [];
let textEngine: TextEngine = createTextEngine();
let mediaEngine: MediaEngine = createMediaClient();
const loadedModelByMode: Partial<Record<AppMode, string>> = {};
let generating = false;
let downloading = false;
let requestedAttachmentKind: PreparedAction | null = null;
let downloadButtonMode: 'cancel' | 'continue' = 'cancel';
let loadingModelMode: AppMode | null = null;
let lastDownloadProgress: EngineProgress | null = null;
let onboardingStep = 1;
let confirmation: ((accepted: boolean) => void) | null = null;
const objectUrls = new Set<string>();
const sessionReadyModels = new Set<string>();
const processingAttachmentIds = new Set<string>();
const inlineModelPromises: Partial<Record<AppMode, Promise<boolean>>> = {};
let failedInlineMode: AppMode | null = null;
let promptedModelMode: AppMode | null = null;
let inlinePreparationVersion = 0;

async function modelIsCached(model: ModelDescriptor): Promise<boolean> {
  return sessionReadyModels.has(model.id) || await isModelCached(model).catch(() => false);
}

function selectedModel(mode = activeMode): ModelDescriptor {
  const selected = getModel(preferences.selectedModelByMode[mode]);
  return selected?.mode === mode ? selected : recommendedModel(mode);
}

const THEME_ICONS: Record<ThemeMode, string> = {
  dark: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
  light: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
  system: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>'
};

function applyTheme(theme: ThemeMode): void {
  preferences.theme = theme;
  savePreferences(preferences);
  document.documentElement.setAttribute('data-theme', theme);
  const themeToggle = document.getElementById('theme-toggle-button');
  if (themeToggle) {
    themeToggle.innerHTML = THEME_ICONS[theme] ?? THEME_ICONS.dark;
  }
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    const isLight = theme === 'light' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
    metaThemeColor.setAttribute('content', isLight ? '#f4f5f8' : '#080909');
  }
  document.querySelectorAll('#theme-button-group .theme-option').forEach((button) => {
    const btn = button as HTMLButtonElement;
    btn.classList.toggle('active', btn.dataset.themeValue === theme);
  });
}

function toggleTheme(): void {
  const nextTheme: Record<ThemeMode, ThemeMode> = {
    dark: 'light',
    light: 'system',
    system: 'dark'
  };
  applyTheme(nextTheme[preferences.theme] ?? 'dark');
}

function showToast(message: string, tone: 'default' | 'success' | 'error' = 'default', duration = 4500): void {
  const toast = document.createElement('div');
  toast.className = `toast ${tone === 'default' ? '' : tone}`;
  toast.textContent = message;
  toastRegion.append(toast);
  setTimeout(() => toast.remove(), duration);
}

function revokeObjectUrls(): void {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
}

function objectUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image.'));
    reader.readAsDataURL(blob);
  });
}

function setBusy(busy: boolean): void {
  generating = busy;
  attachButton.disabled = busy;
  sendButton.classList.toggle('hidden', busy);
  stopButton.classList.toggle('hidden', !busy);
  updateSendState();
}

function updateSendState(): void {
  const hasImage = Boolean(primaryImage());
  const requiredModes = new Set<AppMode>();
  for (const id of pendingAttachmentIds) {
    const kind = attachments.get(id)?.kind;
    if (kind === 'image') requiredModes.add('vision');
    else if (kind === 'document') requiredModes.add('text');
  }
  if (!requiredModes.size && (activeMode === 'text' || promptInput.value.trim())) requiredModes.add(activeMode);
  
  const dot = document.getElementById('model-status-dot');
  if (dot) {
    const isReady = sessionReadyModels.has(selectedModel().id);
    dot.className = `model-status-dot ${isReady ? 'loaded' : 'unloaded'}`;
  }
  promptInput.disabled = generating;
  sendButton.disabled = generating || processingAttachmentIds.size > 0 || (
    activeMode === 'vision'
      ? !hasImage || (!promptInput.value.trim() && currentConversation?.messages.length !== 0)
      : !promptInput.value.trim() && pendingAttachmentIds.length === 0
  );
}

function showManualModelPrompt(mode: AppMode, failed = false): void {}

function syncComposerModelPrompt(): void {
  updateSendState();
}

function resizePrompt(): void {
  promptInput.style.height = 'auto';
  promptInput.style.height = `${Math.min(150, promptInput.scrollHeight)}px`;
  updateSendState();
}

function closeSidebar(): void {
  sidebar.classList.remove('open');
  sidebarScrim.classList.remove('active');
}

function showChatView(): void {
  chatView.hidden = false;
  chatView.classList.add('active');
  settingsView.hidden = true;
  element<HTMLButtonElement>('settings-button').classList.remove('active');
}

function showSettings(): void {
  chatView.hidden = true;
  chatView.classList.remove('active');
  settingsView.hidden = false;
  element<HTMLButtonElement>('settings-button').classList.add('active');
  closeSidebar();
  void updateSettings();
}

function updateModeNavigation(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
    const active = button.dataset.mode === activeMode;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  const attachmentLabels: Record<AppMode, string> = { text: 'Attach document', vision: 'Attach image' };
  attachButton.setAttribute('aria-label', attachmentLabels[activeMode]);
  const model = selectedModel();
  activeModelName.textContent = model.name;
  const supportsThinking = activeMode === 'text' && model.supportsThinking === true;
  thinkingToggle.classList.toggle('hidden', !supportsThinking);
  thinkingToggle.setAttribute('aria-pressed', 'true');
  thinkingToggle.setAttribute('aria-label', 'Thinking enabled');
  updateSendState();
}

async function switchMode(mode: AppMode): Promise<void> {
  if (generating || downloading) return;
  activeMode = mode;
  preferences.activeMode = mode;
  savePreferences(preferences);
  currentConversation = null;
  attachments.clear();
  pendingAttachmentIds = [];
  revokeObjectUrls();
  chatMessages.replaceChildren();
  showChatView();
  updateModeNavigation();
  await renderRecents();
  await renderEmptyState();
  closeSidebar();
}

async function renderEmptyState(): Promise<void> {
  chatMessages.classList.toggle('hidden', !currentConversation?.messages.length);
  if (currentConversation?.messages.length || attachments.size) {
    emptyState.classList.add('hidden');
    composerDock.classList.remove('hidden');
    syncComposerModelPrompt();
    return;
  }
  emptyState.classList.remove('hidden');
  composerDock.classList.toggle('hidden', activeMode !== 'text');
  emptySecondary.classList.add('hidden');
  if (!capabilities.webgpu) {
    emptyIcon.textContent = '!';
    emptyTitle.textContent = 'WebGPU is required';
    emptyDescription.textContent = 'NetlessLM’s curated LFM2.5 models need a WebGPU-capable desktop Chrome or Edge browser in a secure context.';
    emptyPrimary.textContent = 'Check again';
    emptyPrimary.dataset.action = 'recheck';
    return;
  }
  if (activeMode === 'vision') {
    emptyIcon.classList.remove('hidden');
    emptyIcon.textContent = '◉';
    emptyTitle.textContent = 'Choose an image';
    emptyDescription.classList.remove('hidden');
    emptyDescription.textContent = 'Select an image first, then choose when to load its local model.';
    emptyPrimary.textContent = 'Select image';
    emptyPrimary.dataset.action = 'image';
    emptyPrimary.classList.remove('hidden');
  } else {
    const hour = new Date().getHours();
    let greeting = 'Good evening';
    if (hour < 12) greeting = 'Good morning';
    else if (hour < 18) greeting = 'Good afternoon';
    emptyIcon.classList.add('hidden');
    emptyTitle.textContent = `${greeting}, How can I help?`;
    emptyDescription.classList.add('hidden');
    emptyPrimary.classList.add('hidden');
  }
  syncComposerModelPrompt();
}

async function ensureConversation(): Promise<ConversationRecordV1> {
  if (currentConversation) return currentConversation;
  currentConversation = createConversation(activeMode, selectedModel().id);
  return currentConversation;
}

async function persistCurrent(fallbackName?: string): Promise<void> {
  if (!currentConversation) return;
  currentConversation.selectedModelId = selectedModel().id;
  currentConversation.updatedAt = Date.now();
  currentConversation.title = deriveConversationTitle(currentConversation, fallbackName);
  await saveConversation(currentConversation);
  await renderRecents();
}

async function renderRecents(): Promise<void> {
  const conversations = await listConversations(activeMode).catch(() => []);
  recentList.replaceChildren();
  recentEmpty.classList.toggle('hidden', conversations.length > 0);
  historyCount.textContent = conversations.length ? String(conversations.length) : '';
  for (const conversation of conversations) {
    const row = document.createElement('div');
    row.className = `recent-item ${currentConversation?.id === conversation.id ? 'active' : ''}`;
    const open = document.createElement('button');
    open.className = 'recent-open';
    open.innerHTML = `<span>◯</span><span></span>`;
    open.lastElementChild!.textContent = conversation.title;
    open.addEventListener('click', () => void openConversation(conversation.id));
    const remove = document.createElement('button');
    remove.className = 'recent-delete';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Delete ${conversation.title}`);
    remove.addEventListener('click', async () => {
      if (!await confirmAction(`Delete “${conversation.title}” and all of its local attachments?`)) return;
      await deleteConversation(conversation.id);
      if (currentConversation?.id === conversation.id) await startNewConversation();
      else await renderRecents();
      showToast('Conversation deleted.', 'success');
    });
    row.append(open, remove);
    recentList.append(row);
  }
}

async function openConversation(id: string): Promise<void> {
  const conversation = await getConversation(id);
  if (!conversation) return showToast('This local conversation could not be found.', 'error');
  activeMode = conversation.mode;
  preferences.activeMode = activeMode;
  if (getModel(conversation.selectedModelId)?.mode === activeMode) preferences.selectedModelByMode[activeMode] = conversation.selectedModelId;
  savePreferences(preferences);
  currentConversation = conversation;
  const storedAttachments = await getConversationAttachments(id);
  attachments = new Map(storedAttachments.map((attachment) => [attachment.id, attachment]));
  pendingAttachmentIds = [];
  showChatView();
  updateModeNavigation();
  await renderConversation();
  await renderRecents();
  closeSidebar();
}

async function startNewConversation(mode = activeMode): Promise<void> {
  activeMode = mode;
  currentConversation = null;
  attachments.clear();
  pendingAttachmentIds = [];
  revokeObjectUrls();
  chatMessages.replaceChildren();
  promptInput.value = '';
  resizePrompt();
  updateModeNavigation();
  await renderRecents();
  await renderEmptyState();
  showChatView();
}

async function renderConversation(): Promise<void> {
  revokeObjectUrls();
  chatMessages.replaceChildren();
  if (!currentConversation) return renderEmptyState();
  chatMessages.classList.remove('hidden');
  for (const message of currentConversation.messages) await appendMessageElement(message);
  emptyState.classList.add('hidden');
  composerDock.classList.remove('hidden');
  renderAttachmentTray();
  chatMessages.scrollTop = chatMessages.scrollHeight;
  syncComposerModelPrompt();
}

async function appendMessageElement(message: PersistedMessageV1): Promise<HTMLElement> {
  const row = document.createElement('article');
  row.className = `message-row ${message.role}`;
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  for (const attachmentId of message.attachmentIds) {
    const attachment = attachments.get(attachmentId);
    if (!attachment) continue;
    if (attachment.kind === 'image') {
      const image = document.createElement('img');
      image.className = 'message-media';
      image.src = objectUrl(attachment.blob);
      image.alt = attachment.name;
      bubble.append(image);
    } else {
      const file = document.createElement('div');
      file.className = 'message-file';
      file.textContent = `▤ ${attachment.name}`;
      bubble.append(file);
    }
  }
  const content = document.createElement('div');
  content.className = 'message-content';
  content.innerHTML = message.role === 'assistant' ? renderMarkdown(message.text) : '';
  if (message.role === 'user') content.textContent = message.text;
  if (message.role === 'assistant' && message.metadata?.reasoning) {
    bubble.append(createThinkingBlock(message.metadata.reasoning, false, false));
  }
  bubble.append(content);
  if (message.role === 'assistant') {
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    const copy = document.createElement('button');
    copy.textContent = 'Copy';
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(message.text);
      showToast('Copied.', 'success');
    });
    const meta = document.createElement('span');
    meta.textContent = message.metadata?.stopped ? 'Stopped' : message.metadata?.tokenCount
      ? `${message.metadata.tokenCount} tokens · ${((message.metadata.elapsedMs ?? 0) / 1000).toFixed(1)}s`
      : selectedModel().name;
    actions.append(copy, meta);
    bubble.append(actions);
  }
  row.append(bubble);
  chatMessages.append(row);
  return row;
}

function renderAttachmentTray(): void {
  attachmentTray.replaceChildren();
  for (const id of pendingAttachmentIds) {
    const attachment = attachments.get(id);
    if (!attachment) continue;
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';
    const label = document.createElement('span');
    label.textContent = attachment.name;
    const remove = document.createElement('button');
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${attachment.name}`);
    remove.addEventListener('click', () => {
      pendingAttachmentIds = pendingAttachmentIds.filter((candidate) => candidate !== id);
      attachments.delete(id);
      renderAttachmentTray();
      updateSendState();
    });
    chip.append(label, remove);
    attachmentTray.append(chip);
  }
}

function primaryImage(): AttachmentRecordV1 | undefined {
  return [...attachments.values()].filter((attachment) => attachment.kind === 'image').at(-1);
}

async function renderModels(): Promise<void> {
  modelList.replaceChildren();
  const mode = activeMode;
  const models = modelsForMode(mode);
  const states = await Promise.all(models.map(async (model) => ({ model, cached: await modelIsCached(model) })));
  for (const { model, cached } of states) {
    const card = document.createElement('article');
    card.className = `model-entry ${selectedModel().id === model.id ? 'selected' : ''}`;
    const copy = document.createElement('div');
    copy.innerHTML = `<h3></h3><p></p><div class="model-meta"></div>`;
    copy.querySelector('h3')!.textContent = model.name;
    copy.querySelector('p')!.textContent = model.description;
    const meta = copy.querySelector('.model-meta')!;
    for (const value of [formatBytes(model.downloadBytes), model.license, 'WebGPU', cached ? 'Downloaded' : 'Not downloaded']) {
      const badge = document.createElement('span'); badge.textContent = value; meta.append(badge);
    }
    const actions = document.createElement('div');
    actions.className = 'model-entry-actions';
    const choose = document.createElement('button');
    const isLoaded = sessionReadyModels.has(model.id);
    choose.textContent = isLoaded ? 'Active' : (cached ? (selectedModel().id === model.id ? 'Use model' : 'Select') : 'Download');
    if (isLoaded) choose.disabled = true;
    choose.addEventListener('click', () => void selectAndLoadModel(model));
    actions.append(choose);
    
    if (isLoaded) {
      const unload = document.createElement('button');
      unload.className = 'unload-model';
      unload.textContent = 'Unload';
      unload.addEventListener('click', async () => {
        sessionReadyModels.delete(model.id);
        if (loadedModelByMode[mode] === model.id) loadedModelByMode[mode] = undefined;
        if (mode === 'text') {
          await textEngine.dispose().catch(()=>undefined);
          textEngine = createTextEngine();
        } else {
          await mediaEngine.dispose().catch(()=>undefined);
        }
        showToast(`${model.name} unloaded from memory.`, 'success');
        updateSendState();
        await renderModels();
      });
      actions.append(unload);
    }
    if (cached) {
      const remove = document.createElement('button');
      remove.className = 'remove-model';
      remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        if (!await confirmAction(`Remove the downloaded files for ${model.name}?`)) return;
        await removeModelFromCache(model);
        sessionReadyModels.delete(model.id);
        if (loadedModelByMode[mode] === model.id) loadedModelByMode[mode] = undefined;
        showToast(`${model.name} removed.`, 'success');
        await renderModels();
        await renderEmptyState();
      });
      actions.append(remove);
    }
    card.append(copy, actions);
    modelList.append(card);
  }
}

async function openModelPicker(): Promise<void> {
  if (!capabilities.webgpu) return renderEmptyState();
  modelModalTitle.textContent = `Choose ${activeMode} model`;
  modelModalIntro.textContent = `Only curated, pinned LFM2.5 ${activeMode} models are shown.`;
  downloadPanel.classList.add('hidden');
  modelList.classList.remove('hidden');
  await renderModels();
  modelModalBackdrop.classList.remove('hidden');
  modelModal.querySelector<HTMLElement>('button')?.focus();
}

function closeModelPicker(): void {
  if (downloading) return;
  if (downloadButtonMode === 'continue') {
    requestedAttachmentKind = null;
    downloadButtonMode = 'cancel';
  }
  modelModalBackdrop.classList.add('hidden');
}

function updateDownloadProgress(progress: EngineProgress): void {
  lastDownloadProgress = progress;
  downloadStage.textContent = progress.status === 'warming' ? 'Preparing the local runtime…' : `Downloading ${progress.file ?? 'model files'}…`;
  downloadProgress.style.width = `${progress.percent}%`;
  downloadProgressText.textContent = `${formatBytes(progress.loaded)} of ${formatBytes(progress.total)} · ${progress.percent}%`;
}

function completedDownloadProgress(): EngineProgress | null {
  return lastDownloadProgress;
}

function updateInlineProgress(model: ModelDescriptor, progress: EngineProgress): void {
  sendButton.textContent = `${progress.percent}%`;
  sendButton.style.fontSize = '0.75rem';
  promptInput.placeholder = 'Message';
  updateSendState();
}

async function prepareModelInline(mode: AppMode): Promise<boolean> {
  const model = selectedModel(mode);
  if (loadedModelByMode[mode] === model.id) {
    sessionReadyModels.add(model.id);
    updateSendState();
    return true;
  }
  const existing = inlineModelPromises[mode];
  if (existing) return existing;
  const version = ++inlinePreparationVersion;
  const task = (async () => {
    try {
      const cached = await modelIsCached(model);
      const snapshot = await readStorageSnapshot();
      if (!cached && !navigator.onLine) throw new Error('Connect to the internet to download this model.');
      if (!cached && !hasStorageCapacity(snapshot, model)) {
        throw new Error(`${model.name} needs about ${formatBytes(model.downloadBytes * 1.25)} free.`);
      }
      if (!cached) await requestPersistentStorage();
            updateInlineProgress(model, { status: 'downloading', loaded: 0, total: model.downloadBytes, percent: 0, file: 'Starting…' });
      const onProgress = (progress: EngineProgress) => {
        if (version === inlinePreparationVersion) updateInlineProgress(model, progress);
      };
      if (mode === 'text') {
        if (loadedModelByMode.vision) {
          sessionReadyModels.delete(loadedModelByMode.vision);
          await mediaEngine.dispose().catch(()=>undefined);
          loadedModelByMode.vision = undefined;
        }
        if (loadedModelByMode.text && loadedModelByMode.text !== model.id) {
          sessionReadyModels.delete(loadedModelByMode.text);
          await textEngine.dispose();
          textEngine = createTextEngine();
        }
        await textEngine.initialize(model, 'webgpu', onProgress);
      } else {
        if (loadedModelByMode.text) {
          sessionReadyModels.delete(loadedModelByMode.text);
          await textEngine.dispose().catch(()=>undefined);
          textEngine = createTextEngine();
          loadedModelByMode.text = undefined;
        }
        if (loadedModelByMode.vision) sessionReadyModels.delete(loadedModelByMode.vision);
        await mediaEngine.initialize(model, 'webgpu', onProgress);
        loadedModelByMode.vision = mode === 'vision' ? model.id : undefined;
      }
      loadedModelByMode[mode] = model.id;
      sessionReadyModels.add(model.id);
      failedInlineMode = null;
      promptedModelMode = null;
        sendButton.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
        sendButton.style.fontSize = '';
      return true;
    } catch (error) {
      failedInlineMode = mode;
      const message = error instanceof Error ? error.message : String(error);
      sendButton.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
      sendButton.style.fontSize = '';
      showToast(`Model setup failed: ${message}`, 'error', 8000);
      return false;
    } finally {
      delete inlineModelPromises[mode];
      updateSendState();
      
    }
  })();
  inlineModelPromises[mode] = task;
  updateSendState();
  return task;
}

async function selectAndLoadModel(model: ModelDescriptor): Promise<void> {
  if (downloading) return;
  const snapshot = await readStorageSnapshot();
  const cached = await modelIsCached(model);
  if (!cached && !navigator.onLine) return showToast('Connect to the internet to download this model.', 'error');
  if (!cached && !hasStorageCapacity(snapshot, model)) {
    return showToast(`Not enough storage. ${model.name} needs about ${formatBytes(model.downloadBytes * 1.25)} free.`, 'error', 7000);
  }
  downloading = true;
  loadingModelMode = model.mode;
  lastDownloadProgress = null;
  downloadButtonMode = 'cancel';
  cancelDownload.textContent = 'Cancel';
  cancelDownload.classList.remove('primary-action');
  cancelDownload.classList.add('secondary-action');
  preferences.selectedModelByMode[model.mode] = model.id;
  savePreferences(preferences);
  updateModeNavigation();
  modelList.classList.add('hidden');
  downloadPanel.classList.remove('hidden');
  modelModalTitle.textContent = `Prepare ${model.mode} model`;
  modelModalBackdrop.classList.remove('hidden');
  downloadTitle.textContent = cached ? 'Prepare selected model' : 'Download selected model';
  downloadModelName.textContent = model.name;
  downloadModelMeta.textContent = `${formatBytes(model.downloadBytes)} · ${model.license}`;
  downloadProgress.style.width = '0%';
  downloadProgressText.textContent = cached ? 'Reading from browser cache…' : `0 B of ${formatBytes(model.downloadBytes)} · 0%`;
  downloadStage.textContent = cached ? 'Preparing…' : 'Starting download…';
  try {
    if (!cached) await requestPersistentStorage();
        if (model.mode === 'text') {
      if (loadedModelByMode.vision) {
        sessionReadyModels.delete(loadedModelByMode.vision);
        await mediaEngine.dispose().catch(()=>undefined);
        loadedModelByMode.vision = undefined;
      }
      if (loadedModelByMode.text && loadedModelByMode.text !== model.id) {
        sessionReadyModels.delete(loadedModelByMode.text);
        await textEngine.dispose();
        textEngine = createTextEngine();
      }
      await textEngine.initialize(model, 'webgpu', updateDownloadProgress);
    } else {
      if (loadedModelByMode.text) {
        sessionReadyModels.delete(loadedModelByMode.text);
        await textEngine.dispose().catch(()=>undefined);
        textEngine = createTextEngine();
        loadedModelByMode.text = undefined;
      }
      if (loadedModelByMode.vision) sessionReadyModels.delete(loadedModelByMode.vision);
      await mediaEngine.initialize(model, 'webgpu', updateDownloadProgress);
      loadedModelByMode.vision = model.mode === 'vision' ? model.id : undefined;
    }
    loadedModelByMode[model.mode] = model.id;
    sessionReadyModels.add(model.id);
    if (failedInlineMode === model.mode) failedInlineMode = null;
    if (promptedModelMode === model.mode) promptedModelMode = null;
    const completedProgress = completedDownloadProgress();
    const finalLoaded = completedProgress?.loaded || model.downloadBytes;
    const finalTotal = completedProgress?.total || finalLoaded;
    downloadProgress.style.width = '100%';
    downloadProgressText.textContent = `${formatBytes(finalTotal)} of ${formatBytes(finalTotal)} · 100%`;
    downloadStage.textContent = 'Ready on this device.';
    showToast(`${model.name} is ready.`, 'success');
    downloading = false;
    loadingModelMode = null;
    await renderEmptyState();
    syncComposerModelPrompt();
    if (requestedAttachmentKind) {
      const labels: Record<PreparedAction, string> = { image: 'Choose image', document: 'Choose document' };
      downloadButtonMode = 'continue';
      downloadTitle.textContent = 'Model ready';
      downloadStage.textContent = 'Continue when you are ready.';
      cancelDownload.textContent = labels[requestedAttachmentKind];
      cancelDownload.classList.remove('secondary-action');
      cancelDownload.classList.add('primary-action');
    } else {
      modelModalBackdrop.classList.add('hidden');
    }
  } catch (error) {
    downloading = false;
    loadingModelMode = null;
    const message = error instanceof Error ? error.message : String(error);
    downloadStage.textContent = 'Download could not finish.';
    showToast(`Model setup failed: ${message}`, 'error', 8000);
    modelList.classList.remove('hidden');
    downloadPanel.classList.add('hidden');
    await renderModels();
  }
}

async function ensureModel(mode: AppMode): Promise<boolean> {
  const model = selectedModel(mode);
  const ready = sessionReadyModels.has(model.id);
  if (!ready) {
    const cached = await modelIsCached(model);
    if (!cached) {
      void selectAndLoadModel(model);
      return false;
    }
    const originalDisabled = promptInput.disabled;
    promptInput.disabled = true;
    const success = await prepareModelInline(mode);
    promptInput.disabled = originalDisabled;
    sendButton.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
    sendButton.style.fontSize = '';
    return success;
  }
  return true;
}

async function beginAttachment(kind: 'image' | 'document'): Promise<void> {
  openFilePicker(kind);
}

function openFilePicker(kind: 'image' | 'document'): void {
  fileInput.accept = ACCEPT_BY_KIND[kind];
  fileInput.dataset.kind = kind;
  fileInput.value = '';
  fileInput.click();
}

async function handleFile(file: File, kind: 'image' | 'document'): Promise<void> {
  const error = validateAttachment(file, attachments.size);
  if (error) return showToast(error, 'error');
  const conversation = await ensureConversation();
  const attachment: AttachmentRecordV1 = {
    id: crypto.randomUUID(), version: 1, conversationId: conversation.id, kind,
    name: file.name, mimeType: file.type || `application/${extensionOf(file.name)}`, size: file.size,
    blob: file, createdAt: Date.now()
  };
  await saveAttachment(attachment);
  attachments.set(attachment.id, attachment);
  pendingAttachmentIds.push(attachment.id);
  processingAttachmentIds.add(attachment.id);
  await persistCurrent(file.name);
  emptyState.classList.add('hidden');
  composerDock.classList.remove('hidden');
  renderAttachmentTray();
  syncComposerModelPrompt();
  if (activeMode !== 'text' || sessionReadyModels.has(selectedModel('text').id)) promptInput.focus();
  void finishAttachmentPreparation(attachment, file);
}

async function finishAttachmentPreparation(attachment: AttachmentRecordV1, file: File): Promise<void> {
  try {
    if (attachment.kind === 'document') {
      showToast(`Reading ${file.name} locally…`);
      const extracted = await extractDocument(file);
      attachment.extractedText = extracted.text;
      attachment.chunks = extracted.chunks;
      attachment.pageCount = extracted.pageCount;
      await saveAttachment(attachment);
    }
  } catch (extractError) {
    showToast(extractError instanceof Error ? extractError.message : String(extractError), 'error', 7000);
  } finally {
    processingAttachmentIds.delete(attachment.id);
    updateSendState();
  }
}

function documentContext(query: string, contextTokens: number): string {
  const documents = [...attachments.values()].filter((attachment) => attachment.kind === 'document' && attachment.chunks?.length);
  if (!documents.length) return '';
  const budget = Math.floor(contextTokens * 4 * 0.5);
  const each = Math.max(1_200, Math.floor(budget / documents.length));
  return documents.map((document) => {
    const selected = selectRelevantChunks(document.chunks ?? [], query, each);
    return `Document: ${document.name}\n${selected.map((chunk) => chunk.text).join('\n\n')}`;
  }).join('\n\n---\n\n');
}

function isRecoverableGpuError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /MapAsync|Invalid Buffer|OrtRun|BufferManager|device lost|GPUBuffer/i.test(message);
}

async function releaseMediaRuntime(): Promise<void> {
  if (!loadedModelByMode.vision) return;
  await mediaEngine.dispose().catch(() => undefined);
  loadedModelByMode.vision = undefined;
}

async function generateTextWithRecovery(
  messages: ChatMessage[],
  model: ModelDescriptor,
  enableThinking: boolean,
  onToken: (text: string, tokenCount: number, elapsedMs: number, reasoning: string, thinkingComplete: boolean) => void,
  onRecover: () => void
): Promise<GenerationResult> {
  const maxNewTokens = 2_048;
  try {
    return await textEngine.generate(messages, maxNewTokens, enableThinking, onToken);
  } catch (error) {
    if (!isRecoverableGpuError(error)) throw error;
    onRecover();
    await textEngine.dispose().catch(() => undefined);
    textEngine = createTextEngine();
    loadedModelByMode.text = undefined;
    sessionReadyModels.delete(model.id);
    if (!await prepareModelInline('text')) throw new Error('The local GPU session could not be restored. Close other GPU-heavy tabs and retry.', { cause: error });
    return textEngine.generate(messages, maxNewTokens, enableThinking, onToken);
  }
}

function runtimeMessages(extraSystem = ''): ChatMessage[] {
  const persisted = currentConversation?.messages.map(({ role, text }) => ({ role, content: text } as ChatMessage)) ?? [];
  return [{ role: 'system', content: `${SYSTEM_PROMPT}${extraSystem ? `\n\n${extraSystem}` : ''}` }, ...persisted];
}

async function sendCurrentMessage(): Promise<void> {
  if (generating || downloading || sendButton.disabled) return;
  const prompt = promptInput.value.trim();
  if (activeMode === 'vision') return sendVisionMessage(prompt);

  return sendTextMessage(prompt);
}

async function saveUserMessage(text: string, attachmentIds = pendingAttachmentIds): Promise<PersistedMessageV1> {
  const conversation = await ensureConversation();
  const message = createMessage('user', text, selectedModel().id, [...attachmentIds]);
  conversation.messages.push(message);
  pendingAttachmentIds = [];
  promptInput.value = '';
  resizePrompt();
  await persistCurrent(attachmentIds[0] ? attachments.get(attachmentIds[0])?.name : undefined);
  await renderConversation();
  return message;
}

async function saveAssistantMessage(
  text: string,
  attachmentIds: string[] = [],
  metadata?: PersistedMessageV1['metadata'],
  modelId = selectedModel().id
): Promise<void> {
  if (!currentConversation) return;
  const message = createMessage('assistant', text, modelId, attachmentIds);
  message.metadata = metadata;
  currentConversation.messages.push(message);
  await persistCurrent();
  await renderConversation();
}

function createThinkingBlock(reasoning: string, open: boolean, active: boolean): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'thinking-block';
  details.open = open;
  const summary = document.createElement('summary');
  summary.textContent = active ? 'Thinking…' : 'Thinking process';
  const body = document.createElement('div');
  body.className = 'thinking-content';
  body.textContent = reasoning;
  details.append(summary, body);
  return details;
}

function createStreamingAssistant(label: string, showThinking = false): {
  row: HTMLElement;
  content: HTMLElement;
  meta: HTMLElement;
  thinking?: HTMLDetailsElement;
  thinkingContent?: HTMLElement;
} {
  const row = document.createElement('article'); row.className = 'message-row assistant';
  const bubble = document.createElement('div'); bubble.className = 'message-bubble';
  const thinking = showThinking ? createThinkingBlock('Starting local reasoning…', true, true) : undefined;
  const content = document.createElement('div'); content.className = 'message-content'; content.textContent = label;
  const actions = document.createElement('div'); actions.className = 'message-actions';
  const meta = document.createElement('span'); actions.append(meta);
  if (thinking) bubble.append(thinking);
  bubble.append(content, actions); row.append(bubble); chatMessages.append(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return { row, content, meta, thinking, thinkingContent: thinking?.querySelector('.thinking-content') ?? undefined };
}

async function sendTextMessage(prompt: string): Promise<void> {
  if (!prompt && !pendingAttachmentIds.length) return;
  let finalPrompt = prompt || 'Summarize the attached content.';
  const image = pendingAttachmentIds.map((id) => attachments.get(id)).find((attachment) => attachment?.kind === 'image') ?? primaryImage();
  if (image) {
    if (!await ensureModel('vision')) return;
  } else if (!await ensureModel('text')) return;
  await saveUserMessage(finalPrompt);
  if (image) return generateVision(image, finalPrompt, 'vision');
  const model = selectedModel('text');
  const useThinking = model.supportsThinking === true;
  await releaseMediaRuntime();
  const safeContextTokens = Math.min(model.contextTokens, 2_048);
  const context = documentContext(finalPrompt, safeContextTokens);
  const trimmed = trimConversation(runtimeMessages(context ? `Use these local document excerpts when relevant:\n\n${context}` : ''), safeContextTokens);
  if (trimmed.trimmed) showToast('Older turns were left out to fit the model context.');
  const streaming = createStreamingAssistant('Thinking locally…', useThinking);
  setBusy(true);
  try {
    let lastPaint = 0;
    const result = await generateTextWithRecovery(
      trimmed.messages,
      model,
      useThinking,
      (text, tokens, elapsed, reasoning, thinkingComplete) => {
        const now = performance.now();
        if (now - lastPaint < 100) return;
        lastPaint = now;
        if (streaming.thinking && streaming.thinkingContent) {
          streaming.thinkingContent.textContent = reasoning || 'Starting local reasoning…';
          streaming.thinking.open = !thinkingComplete;
          streaming.thinking.querySelector('summary')!.textContent = thinkingComplete ? 'Thinking process' : 'Thinking…';
        }
        streaming.content.textContent = text || (thinkingComplete ? 'Writing the final answer…' : 'Thinking locally…');
        streaming.meta.textContent = `${tokens} tokens · ${(elapsed / 1000).toFixed(1)}s`;
      },
      () => {
        lastPaint = 0;
        streaming.content.textContent = 'Recovering the local model and continuing…';
        streaming.meta.textContent = '';
      }
    );
    if (streaming.thinking) streaming.thinking.open = false;
    streaming.row.remove();
    if (!result.cancelled && result.text.trim()) await saveAssistantMessage(result.text.trim(), [], {
      tokenCount: result.tokenCount,
      elapsedMs: result.elapsedMs,
      reasoning: result.reasoning.trim() || undefined
    });
  } catch (generationError) {
    streaming.row.remove();
    console.error('Local text generation failed', generationError);
    const message = isRecoverableGpuError(generationError)
      ? 'The local GPU could not finish this response. Close GPU-heavy tabs or choose the smaller text model, then retry.'
      : generationError instanceof Error ? generationError.message : String(generationError);
    showToast(`Text generation failed: ${message}`, 'error', 8000);
  } finally { setBusy(false); }
}

async function sendVisionMessage(prompt: string): Promise<void> {
  const image = primaryImage();
  if (!image) return beginAttachment('image');
  if (!prompt && currentConversation?.messages.length) return;
  if (!await ensureModel('vision')) return;
  const question = prompt || 'Describe this image in useful detail.';
  const ids = pendingAttachmentIds.length ? [...pendingAttachmentIds] : [];
  await saveUserMessage(question, ids);
  await generateVision(image, question, 'vision');
}

async function generateVision(image: AttachmentRecordV1, _question: string, modelMode: AppMode): Promise<void> {
  const model = selectedModel('vision');
  const streaming = createStreamingAssistant('Analyzing the image locally…');
  setBusy(true);
  try {
    const dataUrl = await blobToDataUrl(image.blob);
    const history = runtimeMessages();
    const answer = await mediaEngine.analyzeImage(dataUrl, history, model, 'webgpu', (progress) => {
      streaming.content.textContent = progress.status === 'warming' ? 'Preparing visual reasoning…' : 'Downloading vision model…';
      streaming.meta.textContent = `${formatBytes(progress.loaded)} of ${formatBytes(progress.total)} · ${progress.percent}%`;
    });
    streaming.row.remove();
    if (!answer.trim()) throw new Error('The vision model returned an empty response.');
    await saveAssistantMessage(answer.trim(), [], undefined, model.id);
  } catch (visionError) {
    streaming.row.remove();
    showToast(`Vision failed: ${visionError instanceof Error ? visionError.message : String(visionError)}`, 'error', 8000);
  } finally {
    setBusy(false);
    if (modelMode === 'text') updateModeNavigation();
  }
}



async function updateSettings(): Promise<void> {
  const [storage, usage, cachedStates] = await Promise.all([
    readStorageSnapshot(), historyUsage().catch(() => ({ conversations: 0, attachments: 0, attachmentBytes: 0 })),
    Promise.all(MODEL_CATALOG.map(async (model) => ({ model, cached: await modelIsCached(model) })))
  ]);
  element('storage-used').textContent = formatBytes(storage.usage);
  element('storage-available').textContent = formatBytes(storage.available);
  element('storage-persisted').textContent = storage.persisted ? 'Yes' : 'No';
  element('history-usage').textContent = `${usage.conversations} chats · ${formatBytes(usage.attachmentBytes)}`;
  const list = element<HTMLDivElement>('downloaded-model-list'); list.replaceChildren();
  for (const { model } of cachedStates.filter((state) => state.cached)) {
    const row = document.createElement('div'); row.className = 'downloaded-entry';
    const copy = document.createElement('div'); copy.innerHTML = `<strong></strong><span></span>`; copy.querySelector('strong')!.textContent = model.name; copy.querySelector('span')!.textContent = `${model.mode} · ${formatBytes(model.downloadBytes)}`;
    const remove = document.createElement('button'); remove.textContent = 'Remove'; remove.addEventListener('click', async () => {
      await removeModelFromCache(model);
      sessionReadyModels.delete(model.id);
      if (textEngine?.modelId === model.id) {
        textEngine.dispose();
        textEngine = undefined;
      }
      if (mediaEngine?.modelId === model.id) {
        mediaEngine.dispose();
        mediaEngine = undefined;
      }
      syncComposerModelPrompt();
      showToast(`${model.name} removed.`, 'success');
      await updateSettings();
    });
    row.append(copy, remove); list.append(row);
  }
  if (!list.children.length) list.textContent = 'No downloaded models detected.';
}

function confirmAction(copy: string): Promise<boolean> {
  confirmCopy.textContent = copy;
  confirmBackdrop.classList.remove('hidden');
  return new Promise((resolve) => { confirmation = resolve; });
}

function resolveConfirmation(value: boolean): void {
  confirmBackdrop.classList.add('hidden');
  confirmation?.(value);
  confirmation = null;
}

function showOnboarding(): void {
  onboardingStep = 1;
  updateOnboarding();
  onboardingBackdrop.classList.remove('hidden');
  element('app-shell').setAttribute('inert', '');
  onboardingDialog.focus();
}

function hideOnboarding(): void {
  onboardingBackdrop.classList.add('hidden');
  element('app-shell').removeAttribute('inert');
}

function updateOnboarding(): void {
  document.querySelectorAll<HTMLElement>('[data-onboarding-step]').forEach((slide) => slide.classList.toggle('active', Number(slide.dataset.onboardingStep) === onboardingStep));
  document.querySelectorAll<HTMLElement>('[data-step-dot]').forEach((dot) => dot.classList.toggle('active', Number(dot.dataset.stepDot) === onboardingStep));
}

function bindEvents(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => button.addEventListener('click', () => void switchMode(button.dataset.mode as AppMode)));
  element('new-chat-button').addEventListener('click', () => void startNewConversation());
  element('header-new-chat').addEventListener('click', () => void startNewConversation());
  element('settings-button').addEventListener('click', showSettings);
  element('menu-button').addEventListener('click', () => { sidebar.classList.add('open'); sidebarScrim.classList.add('active'); });
  element('sidebar-close').addEventListener('click', closeSidebar); sidebarScrim.addEventListener('click', closeSidebar);
  modelPill.addEventListener('click', () => void openModelPicker());
  element('close-model-modal').addEventListener('click', closeModelPicker);
  modelModalBackdrop.addEventListener('click', (event) => { if (event.target === modelModalBackdrop) closeModelPicker(); });
  cancelDownload.addEventListener('click', () => {
    if (downloadButtonMode === 'continue') {
      const action = requestedAttachmentKind;
      requestedAttachmentKind = null;
      downloadButtonMode = 'cancel';
      modelModalBackdrop.classList.add('hidden');
      if (action) openFilePicker(action);
      return;
    }
    if (loadingModelMode === 'text') textEngine.cancel(); else mediaEngine.cancel();
    downloading = false;
    loadingModelMode = null;
    requestedAttachmentKind = null;
    modelModalBackdrop.classList.add('hidden');
    showToast('Model setup cancelled.');
  });
  emptyPrimary.addEventListener('click', () => void handleEmptyAction(emptyPrimary.dataset.action));
  emptySecondary.addEventListener('click', () => void handleEmptyAction(emptySecondary.dataset.action));
  attachButton.addEventListener('click', () => void beginAttachment(activeMode === 'text' ? 'document' : 'image'));
  fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; if (file) void handleFile(file, fileInput.dataset.kind as 'image' | 'document'); });
  promptInput.addEventListener('input', () => {
    resizePrompt();
  });
  promptInput.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendCurrentMessage(); } });
  sendButton.addEventListener('click', () => void sendCurrentMessage());
  stopButton.addEventListener('click', () => { textEngine.cancel(); setBusy(false); showToast('Generation stopped.'); });

  composerPreparationRetry.addEventListener('click', () => {
    const mode = promptedModelMode ?? failedInlineMode;
    failedInlineMode = null;
    composerPreparationRetry.classList.add('hidden');
    if (mode) void prepareModelInline(mode);
  });
  element('clear-history-button').addEventListener('click', async () => { if (!await confirmAction('Delete every saved conversation and attachment from this browser? Downloaded models will remain.')) return; await clearHistory(); await startNewConversation(); await updateSettings(); showToast('Local history cleared.', 'success'); });
  element('uninstall-app-button').addEventListener('click', async () => {
    if (!await confirmAction('Uninstall NetlessLM? This will delete all downloaded models, chat history, and settings from your browser. This action cannot be undone.')) return;
    showToast('Uninstalling...', 'default', 10000);
    for (const model of MODEL_CATALOG) {
      await removeModelFromCache(model).catch(() => {});
    }
    await clearHistory();
    localStorage.clear();
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
    }
    window.location.reload();
  });
  element('replay-onboarding').addEventListener('click', showOnboarding);
  element('confirm-cancel').addEventListener('click', () => resolveConfirmation(false)); element('confirm-accept').addEventListener('click', () => resolveConfirmation(true));
  document.querySelectorAll<HTMLButtonElement>('[data-onboarding-next]').forEach((button) => button.addEventListener('click', () => { onboardingStep = Math.min(3, onboardingStep + 1); updateOnboarding(); }));
  document.querySelectorAll<HTMLButtonElement>('[data-onboarding-back]').forEach((button) => button.addEventListener('click', () => { onboardingStep = Math.max(1, onboardingStep - 1); updateOnboarding(); }));
  element('finish-onboarding').addEventListener('click', async () => { preferences.onboardingComplete = true; savePreferences(preferences); hideOnboarding(); await openModelPicker(); });
  element('theme-toggle-button').addEventListener('click', toggleTheme);
  document.querySelectorAll<HTMLButtonElement>('#theme-button-group .theme-option').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.themeValue as ThemeMode;
      if (mode) applyTheme(mode);
    });
  });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (preferences.theme === 'system') applyTheme('system');
  });
  window.addEventListener('online', () => showToast('Back online.', 'success')); window.addEventListener('offline', () => showToast('Offline. Cached models remain available.', 'error'));
  window.addEventListener('beforeunload', revokeObjectUrls);
}

async function handleEmptyAction(action?: string): Promise<void> {
  if (action === 'model') return openModelPicker();
  if (action === 'image') return beginAttachment('image');

  if (action === 'focus') {
    composerDock.classList.remove('hidden');
    syncComposerModelPrompt();
    if (!promptInput.disabled) promptInput.focus();
    return;
  }
  if (action === 'recheck') { capabilities = await detectCapabilities(); await renderEmptyState(); }
}

async function initialize(): Promise<void> {
  bindEvents();
  capabilities = await detectCapabilities();
  preferences = loadPreferences();
  applyTheme(preferences.theme);
  activeMode = preferences.activeMode;
  updateModeNavigation();
  await Promise.all([renderRecents(), renderEmptyState()]);
  if (!preferences.onboardingComplete) showOnboarding();
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    const { registerSW } = await import('virtual:pwa-register'); registerSW({ immediate: true });
  }
}

void initialize().catch((error) => {
  showToast(`NetlessLM could not start: ${error instanceof Error ? error.message : String(error)}`, 'error', 10_000);
});
