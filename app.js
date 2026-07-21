// App.js - Local Browser AI Orchestrator

// Check WebGPU Support
const isWebGPUSupported = async () => {
    if (!navigator.gpu) return false;
    try {
        const adapter = await navigator.gpu.requestAdapter();
        return !!adapter;
    } catch (e) {
        return false;
    }
};

// UI Elements
const overlay = document.getElementById('init-overlay');
const startBtn = document.getElementById('start-btn');
const initStatusText = document.getElementById('init-status');
const deviceWebGPU = document.getElementById('device-webgpu');
const deviceWASM = document.getElementById('device-wasm');
const webgpuStatusText = document.getElementById('webgpu-status-text');

const sidebar = document.getElementById('sidebar');
const sidebarOpenBtn = document.getElementById('sidebar-open-btn');
const sidebarCloseBtn = document.getElementById('sidebar-close-btn');

const chatMessages = document.getElementById('chat-messages');
const promptInput = document.getElementById('prompt-input');
const sendBtn = document.getElementById('send-btn');
const micBtn = document.getElementById('mic-btn');
const clearBtn = document.getElementById('clear-btn');
const voiceSelect = document.getElementById('voice-select');
const ttsSpeechToggle = document.getElementById('tts-speech-toggle');

const imageInput = document.getElementById('image-input');
const imagePreviewContainer = document.getElementById('image-preview-container');
const imagePreview = document.getElementById('image-preview');
const removeImageBtn = document.getElementById('remove-image-btn');
const imageAnalyzingOverlay = document.getElementById('image-analyzing');
const uploadedInfo = document.getElementById('uploaded-info');

const micRecordingStatus = document.getElementById('mic-recording-status');
const recordingText = document.getElementById('recording-text');

// State variables
let chatWorker = null;
let audioWorker = null;
let chatReady = false;
let audioReady = false;
let deviceBackend = 'webgpu';

const MODELS = [
    {
        id: 'LiquidAI/LFM2.5-1.2B-Thinking-ONNX',
        name: 'Liquid LFM-2.5 1.2B (Thinking)',
        publisher: 'Liquid AI',
        size: '1.2B',
        downloadSize: '720 MB',
        quant: 'INT4',
        type: 'text',
        desc: 'Advanced reasoning model utilizing Liquid Neural Networks. Generates detailed chain-of-thought steps.',
        compatibility: 'fits',
        compatibilityLabel: 'Fits RAM',
        isDefault: true
    },
    {
        id: 'google/gemma-4-E2B-it-qat-mobile-transformers',
        name: 'Gemma 4 E2B WebGPU',
        publisher: 'Google',
        size: '2B',
        downloadSize: '1.4 GB',
        quant: 'QAT INT4/INT2',
        type: 'text',
        desc: 'Custom-optimized ultra-fast WebGPU model running at up to 250+ tok/s using agent-optimized kernels.',
        compatibility: 'fits',
        compatibilityLabel: 'Fits RAM',
        isDefault: false
    },
    {
        id: 'LiquidAI/LFM2.5-230M-GGUF',
        name: 'Liquid LFM-2.5 230M WebGPU',
        publisher: 'Liquid AI',
        size: '230M',
        downloadSize: '210 MB',
        quant: 'Q4_0 GGUF',
        type: 'text',
        desc: 'Custom-optimized ultra-fast WebGPU model running at up to 300+ tok/s using agent-optimized kernels.',
        compatibility: 'fits',
        compatibilityLabel: 'Fits RAM',
        isDefault: false
    },
    {
        id: 'onnx-community/Qwen2.5-0.5B-Instruct',
        name: 'Qwen 2.5 0.5B Instruct',
        publisher: 'Alibaba',
        size: '0.5B',
        downloadSize: '350 MB',
        quant: 'INT4',
        type: 'text',
        desc: 'Ultra-lightweight and extremely fast model. Great for quick tasks and devices with limited RAM.',
        compatibility: 'fits',
        compatibilityLabel: 'Fits RAM',
        isDefault: false
    },
    {
        id: 'onnx-community/Llama-3.2-1B-Instruct',
        name: 'Llama 3.2 1B Instruct',
        publisher: 'Meta',
        size: '1B',
        downloadSize: '620 MB',
        quant: 'INT4',
        type: 'text',
        desc: 'Meta\'s standard lightweight assistant. Balanced performance and accuracy for general tasks.',
        compatibility: 'fits',
        compatibilityLabel: 'Fits RAM',
        isDefault: false
    },
    {
        id: 'onnx-community/gemma-2-2b-it',
        name: 'Gemma 2 2B Instruct',
        publisher: 'Google',
        size: '2B',
        downloadSize: '1.4 GB',
        quant: 'INT4',
        type: 'text',
        desc: 'Powerful Google assistant model. Highly capable but requires more memory and WebGPU accelerator.',
        compatibility: 'heavy',
        compatibilityLabel: 'Heavy Model',
        isDefault: false
    },
    {
        id: 'onnx-community/whisper-tiny.en',
        name: 'Whisper Tiny (Speech-to-Text)',
        publisher: 'OpenAI',
        size: '39M',
        downloadSize: '75 MB',
        quant: 'FP32',
        type: 'multimodal',
        desc: 'High-speed english speech-to-text recognition model. Runs locally to transcribe microphone recordings.',
        compatibility: 'fits',
        compatibilityLabel: 'Fits RAM',
        isDefault: false
    },
    {
        id: 'onnx-community/Kokoro-82M-v1.0-ONNX',
        name: 'Kokoro 82M (Text-to-Speech)',
        publisher: 'gso726',
        size: '82M',
        downloadSize: '90 MB',
        quant: 'INT8',
        type: 'multimodal',
        desc: 'State-of-the-art text-to-speech vocalizer. Generates highly natural audio synthesis offline.',
        compatibility: 'fits',
        compatibilityLabel: 'Fits RAM',
        isDefault: false
    },
    {
        id: 'Xenova/vit-gpt2-image-captioning',
        name: 'ViT-GPT2 (Image Captioning)',
        publisher: 'Hugging Face',
        size: '240M',
        downloadSize: '480 MB',
        quant: 'FP32',
        type: 'multimodal',
        desc: 'Vision model that interprets images and translates them into descriptive textual captions.',
        compatibility: 'fits',
        compatibilityLabel: 'Fits RAM',
        isDefault: false
    }
];

let selectedModelId = 'LiquidAI/LFM2.5-1.2B-Thinking-ONNX';
let currentLoadedModel = null;
let cachedModels = new Set();
let downloadingModels = {};
let activeView = 'chat'; // 'chat' or 'hub'
let activeFilter = 'all';

let SYSTEM_PROMPT = {
    role: 'system',
    content: 'You are Aether, a premium offline browser-native AI assistant powered by Liquid AI LFM 2.5. Answer queries concisely and elegantly.'
};

let messages = [SYSTEM_PROMPT];
let audioContext = null;
let mediaStream = null;
let audioProcessor = null;
let audioInputList = [];
let isRecording = false;
let currentImageDataUrl = null;
let activeImageCaption = null;
let isModelInitializing = false;

// Audio playback instance for TTS
let currentAudioSourceNode = null;
let currentAssistantMessageElement = null;

// Navigation elements
const navChatBtn = document.getElementById('nav-chat-btn');
const navHubBtn = document.getElementById('nav-hub-btn');
const navSettingsBtn = document.getElementById('nav-settings-btn');
const chatView = document.getElementById('chat-view');
const hubView = document.getElementById('hub-view');
const modelSelectorTrigger = document.getElementById('model-selector-trigger');
const modelSelectorDropdown = document.getElementById('model-selector-dropdown');
const hubSearchInput = document.getElementById('hub-search-input');
const filterTabs = document.querySelectorAll('.filter-tab');

// Mobile sidebar responsiveness toggle
if (sidebarOpenBtn && sidebarCloseBtn && sidebar) {
    sidebarOpenBtn.addEventListener('click', () => {
        sidebar.classList.add('mobile-open');
    });
    sidebarCloseBtn.addEventListener('click', () => {
        sidebar.classList.remove('mobile-open');
    });
}

// Settings Toggle (Jan AI Style)
if (navSettingsBtn && sidebar) {
    navSettingsBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        navSettingsBtn.classList.toggle('active');
    });
}

// View switching
function switchToView(view) {
    activeView = view;
    if (view === 'chat') {
        chatView.classList.add('active');
        hubView.classList.remove('active');
        hubView.style.display = 'none';
        chatView.style.display = 'flex';
        navChatBtn.classList.add('active');
        navHubBtn.classList.remove('active');
    } else if (view === 'hub') {
        chatView.classList.remove('active');
        hubView.classList.add('active');
        chatView.style.display = 'none';
        hubView.style.display = 'block';
        navChatBtn.classList.remove('active');
        navHubBtn.classList.add('active');
        renderModelHub();
    }
}

if (navChatBtn && navHubBtn) {
    navChatBtn.addEventListener('click', () => switchToView('chat'));
    navHubBtn.addEventListener('click', () => switchToView('hub'));
}

// Dropdown Toggle
if (modelSelectorTrigger && modelSelectorDropdown) {
    modelSelectorTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        modelSelectorDropdown.classList.toggle('hidden');
        modelSelectorTrigger.classList.toggle('active');
    });
    
    document.addEventListener('click', () => {
        modelSelectorDropdown.classList.add('hidden');
        modelSelectorTrigger.classList.remove('active');
    });
}

// Search Model Hub
if (hubSearchInput) {
    hubSearchInput.addEventListener('input', renderModelHub);
}

// Filters Model Hub
filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        filterTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeFilter = tab.dataset.filter;
        renderModelHub();
    });
});

// Cache API detector
async function checkModelCached(modelId) {
    try {
        const tfCache = await caches.open('transformers-cache');
        const tfKeys = await tfCache.keys();
        if (tfKeys.some(request => request.url.includes(modelId))) {
            return true;
        }
        const bonsaiCache = await caches.open('bonsai-pipeline-v1');
        const bonsaiKeys = await bonsaiCache.keys();
        if (bonsaiKeys.some(request => request.url.includes(modelId))) {
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

async function updateCachedModelsState() {
    for (const m of MODELS) {
        const isCached = await checkModelCached(m.id);
        if (isCached) {
            cachedModels.add(m.id);
        } else {
            cachedModels.delete(m.id);
        }
    }
}

async function updateDiagnosticsUI() {
    // 1. Chat LLM Card
    const chatCard = document.getElementById('status-chat');
    if (chatCard) {
        const isCached = cachedModels.has(selectedModelId);
        const indicator = chatCard.querySelector('.status-indicator');
        const dot = chatCard.querySelector('.dot-chat');
        const details = chatCard.querySelector('.progress-details');
        const bar = chatCard.querySelector('.progress-bar');
        
        if (isCached) {
            indicator.textContent = 'Ready';
            indicator.className = 'status-indicator ready';
            if (dot) dot.className = 'status-dot dot-chat online';
            if (details) details.textContent = 'Cached in browser storage';
            if (bar) {
                bar.style.width = '100%';
                bar.classList.remove('indeterminate');
            }
        } else {
            indicator.textContent = 'Inactive';
            indicator.className = 'status-indicator waiting';
            if (dot) dot.className = 'status-dot dot-chat';
            if (details) details.textContent = '0% downloaded';
            if (bar) bar.style.width = '0%';
        }
    }
    
    // 2. STT Whisper Card
    const asrCard = document.getElementById('status-asr');
    if (asrCard) {
        const isCached = cachedModels.has('onnx-community/whisper-tiny.en');
        const indicator = asrCard.querySelector('.status-indicator');
        const dot = asrCard.querySelector('.dot-asr');
        const details = asrCard.querySelector('.progress-details');
        const bar = asrCard.querySelector('.progress-bar');
        
        if (isCached) {
            indicator.textContent = 'Ready';
            indicator.className = 'status-indicator ready';
            if (dot) dot.className = 'status-dot dot-asr online';
            if (details) details.textContent = 'Cached in browser storage';
            if (bar) {
                bar.style.width = '100%';
                bar.classList.remove('indeterminate');
            }
        } else {
            indicator.textContent = 'Inactive';
            indicator.className = 'status-indicator waiting';
            if (dot) dot.className = 'status-dot dot-asr';
            if (details) details.textContent = '0% downloaded';
            if (bar) bar.style.width = '0%';
        }
    }
    
    // 3. TTS Kokoro Card
    const ttsCard = document.getElementById('status-tts');
    if (ttsCard) {
        const isCached = cachedModels.has('onnx-community/Kokoro-82M-v1.0-ONNX');
        const indicator = ttsCard.querySelector('.status-indicator');
        const dot = ttsCard.querySelector('.dot-tts');
        const details = ttsCard.querySelector('.progress-details');
        const bar = ttsCard.querySelector('.progress-bar');
        
        if (isCached) {
            indicator.textContent = 'Ready';
            indicator.className = 'status-indicator ready';
            if (dot) dot.className = 'status-dot dot-tts online';
            if (details) details.textContent = 'Cached in browser storage';
            if (bar) {
                bar.style.width = '100%';
                bar.classList.remove('indeterminate');
            }
        } else {
            indicator.textContent = 'Inactive';
            indicator.className = 'status-indicator waiting';
            if (dot) dot.className = 'status-dot dot-tts';
            if (details) details.textContent = '0% downloaded';
            if (bar) bar.style.width = '0%';
        }
    }
    
    // 4. Vision ViT-GPT2 Card
    const visionCard = document.getElementById('status-vision');
    if (visionCard) {
        const isCached = cachedModels.has('Xenova/vit-gpt2-image-captioning');
        const indicator = visionCard.querySelector('.status-indicator');
        const dot = visionCard.querySelector('.dot-vision');
        const details = visionCard.querySelector('.progress-details');
        const bar = visionCard.querySelector('.progress-bar');
        
        if (isCached) {
            indicator.textContent = 'Ready';
            indicator.className = 'status-indicator ready';
            if (dot) dot.className = 'status-dot dot-vision online';
            if (details) details.textContent = 'Cached in browser storage';
            if (bar) {
                bar.style.width = '100%';
                bar.classList.remove('indeterminate');
            }
        } else {
            indicator.textContent = 'Lazy-loaded';
            indicator.className = 'status-indicator lazy';
            if (dot) dot.className = 'status-dot dot-vision';
            if (details) details.textContent = 'Loads on image upload';
            if (bar) bar.style.width = '0%';
        }
    }
}

// Loading Overlay
function showLoadingOverlay(message) {
    if (overlay && initStatusText) {
        overlay.style.display = 'flex';
        overlay.style.opacity = 1;
        initStatusText.textContent = message;
        if (startBtn) startBtn.style.display = 'none';
    }
}

function hideLoadingOverlay() {
    if (overlay) {
        overlay.style.opacity = 0;
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 500);
    }
}

// Initialize layout & detect hardware
async function checkHardware() {
    const supported = await isWebGPUSupported();
    if (supported) {
        webgpuStatusText.textContent = "WebGPU hardware accelerator active.";
        webgpuStatusText.className = "status-helper webgpu-active";
        deviceWebGPU.checked = true;
        deviceBackend = 'webgpu';
    } else {
        webgpuStatusText.textContent = "WebGPU unsupported. Falling back to CPU/WASM.";
        webgpuStatusText.className = "status-helper webgpu-inactive";
        deviceWASM.checked = true;
        deviceBackend = 'wasm';
        deviceWebGPU.disabled = true;
    }
    
    // Scan Cache API on startup
    await updateCachedModelsState();
    renderModelDropdown();
    updateDiagnosticsUI();
    
    // Enable click on start button
    startBtn.disabled = false;
    startBtn.textContent = "Start Local Engine";
}

checkHardware();

// Start button click - initializes worker
startBtn.addEventListener('click', () => {
    startBtn.disabled = true;
    startBtn.textContent = "Initializing...";
    
    deviceBackend = document.querySelector('input[name="device"]:checked').value;
    
    initializeWorker();
});

function initializeWorker() {
    isModelInitializing = true;
    initStatusText.textContent = "Allocating background worker threads (Text & Audio isolation)...";
    
    // Create new Workers as module (isolated WASM memory heaps)
    chatWorker = new Worker(new URL('./worker.js', import.meta.url), {
        type: 'module'
    });
    
    audioWorker = new Worker(new URL('./audio-worker.js', import.meta.url), {
        type: 'module'
    });
    
    // Listen to messages from both workers
    chatWorker.onmessage = handleWorkerMessage;
    audioWorker.onmessage = handleWorkerMessage;

    // Send init requests to both workers
    chatWorker.postMessage({
        type: 'init',
        data: { device: deviceBackend, modelId: selectedModelId }
    });
    
    audioWorker.postMessage({
        type: 'init',
        data: { device: deviceBackend }
    });
    
    // Set UI cards style state
    document.querySelectorAll('.model-status-card').forEach(card => {
        card.classList.add('active');
        const indicator = card.querySelector('.status-indicator');
        if (indicator.textContent !== 'Lazy-loaded') {
            indicator.textContent = 'Queued';
            indicator.className = 'status-indicator waiting';
        }
    });
}

// Dropdown rendering
function renderModelDropdown() {
    if (!modelSelectorDropdown) return;
    modelSelectorDropdown.innerHTML = '';
    
    MODELS.forEach(m => {
        const isCached = cachedModels.has(m.id);
        const isSelected = selectedModelId === m.id;
        const btn = document.createElement('button');
        btn.className = `dropdown-item ${isSelected ? 'active' : ''}`;
        btn.dataset.modelId = m.id;
        
        btn.innerHTML = `
            <div class="dropdown-item-title">
                <span>${m.name}</span>
                <span class="dropdown-badge ${isCached ? 'ready' : 'not-ready'}">${isCached ? 'Ready' : 'Not Ready'}</span>
            </div>
            <div class="dropdown-item-meta">${m.publisher} • Size: ${m.size}</div>
        `;
        
        btn.addEventListener('click', () => {
            selectModel(m.id);
            modelSelectorDropdown.classList.add('hidden');
            modelSelectorTrigger.classList.remove('active');
        });
        modelSelectorDropdown.appendChild(btn);
    });
}

// Select dynamic model
function selectModel(modelId) {
    selectedModelId = modelId;
    const model = MODELS.find(m => m.id === modelId);
    
    // Gemma 4 and LFM 2.5 230M require WebGPU and do not support WASM CPU fallback
    const needsWebGPU = modelId === 'google/gemma-4-E2B-it-qat-mobile-transformers' || modelId === 'LiquidAI/LFM2.5-230M-GGUF';
    if (needsWebGPU && deviceBackend !== 'webgpu') {
        const webgpuRadio = document.getElementById('device-webgpu');
        const wasmRadio = document.getElementById('device-wasm');
        if (webgpuRadio && !webgpuRadio.disabled) {
            deviceBackend = 'webgpu';
            webgpuRadio.checked = true;
            if (wasmRadio) wasmRadio.checked = false;
        }
    }

    if (document.getElementById('selected-model-name')) {
        document.getElementById('selected-model-name').textContent = model ? model.name : modelId;
    }
    
    renderModelDropdown();
    renderModelHub();
    updateDiagnosticsUI();
    
    const diagName = document.getElementById('diagnostic-chat-name');
    if (diagName && model) {
        diagName.textContent = `LLM (${model.name})`;
    }
    
    // Set prompt context
    SYSTEM_PROMPT = {
        role: 'system',
        content: `You are Aether, a premium offline browser-native AI assistant powered by ${model ? model.publisher : 'Local'} ${model ? model.name : 'AI'}. Answer queries concisely and elegantly.`
    };
    messages = [SYSTEM_PROMPT];
    activeImageCaption = null;
    
    // Clear chat log and show system message
    chatMessages.innerHTML = '';
    stopAudioPlayback();
    currentAssistantMessageElement = null;
    
    const switchDiv = document.createElement('div');
    switchDiv.className = 'message system';
    switchDiv.innerHTML = `
        <div class="msg-content">
            <div class="system-intro-card">
                <div class="system-intro-logo">⚡</div>
                <h3>Active Model: ${model ? model.name : modelId}</h3>
                <p>Parameters: <strong>${model ? model.size : 'N/A'}</strong> | Publisher: <strong>${model ? model.publisher : 'N/A'}</strong></p>
                <p>This model runs <strong>100% locally</strong> on your hardware device. Caching status: <strong>${cachedModels.has(modelId) ? 'Downloaded & Ready' : 'Pending Download'}</strong></p>
            </div>
        </div>
    `;
    chatMessages.appendChild(switchDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Proactively load if already cached
    if (cachedModels.has(modelId) && chatWorker && chatReady && currentLoadedModel !== modelId) {
        chatReady = false;
        showLoadingOverlay(`Instantiating ${model ? model.name : 'Model'} locally...`);
        chatWorker.postMessage({
            type: 'init',
            data: { device: deviceBackend, modelId: modelId }
        });
    }
}

// Model hub rendering
function renderModelHub() {
    const hubGrid = document.getElementById('hub-grid');
    if (!hubGrid) return;
    hubGrid.innerHTML = '';
    
    const filter = activeFilter || 'all';
    const searchVal = hubSearchInput?.value.toLowerCase() || '';
    
    MODELS.forEach(m => {
        if (filter !== 'all') {
            if (filter === 'text' && m.type !== 'text') return;
            if (filter === 'multimodal' && m.type === 'text') return;
        }
        
        if (searchVal) {
            const matchName = m.name.toLowerCase().includes(searchVal);
            const matchPub = m.publisher.toLowerCase().includes(searchVal);
            const matchDesc = m.desc.toLowerCase().includes(searchVal);
            if (!matchName && !matchPub && !matchDesc) return;
        }
        
        const isCached = cachedModels.has(m.id);
        const isSelected = selectedModelId === m.id;
        const dlState = downloadingModels[m.id];
        
        const card = document.createElement('div');
        card.className = `model-card ${isSelected ? 'active-model' : ''}`;
        card.dataset.modelId = m.id;
        
        let actionHtml = '';
        if (dlState && dlState.status === 'downloading') {
            actionHtml = `
                <div class="card-progress-container">
                    <div class="card-progress-header">
                        <span>Downloading...</span>
                        <span>${dlState.progress}%</span>
                    </div>
                    <div class="card-progress-bar-bg">
                        <div class="card-progress-bar" style="width: ${dlState.progress}%"></div>
                    </div>
                </div>
            `;
        } else if (isCached) {
            if (isSelected) {
                actionHtml = `
                    <button class="model-action-btn active-use" disabled>
                        ⚡ Active Model
                    </button>
                `;
            } else {
                actionHtml = `
                    <button class="model-action-btn use" data-action="use" data-model-id="${m.id}">
                        Use Model
                    </button>
                `;
            }
        } else {
            actionHtml = `
                <button class="model-action-btn download" data-action="download" data-model-id="${m.id}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    Download (${m.downloadSize})
                </button>
            `;
        }
        
        card.innerHTML = `
            <div class="card-header">
                <div class="model-title-block">
                    <span class="model-title">${m.name}</span>
                    <span class="model-publisher">by ${m.publisher}</span>
                </div>
                <span class="model-compat-badge ${m.compatibility}">${m.compatibilityLabel}</span>
            </div>
            <p class="model-desc">${m.desc}</p>
            <div class="model-meta-list">
                <span class="model-meta-pill highlight">${m.quant}</span>
                <span class="model-meta-pill">Size: ${m.size}</span>
                <span class="model-meta-pill">${m.type === 'text' ? 'Text LLM' : 'System'}</span>
            </div>
            <div class="card-action-row" style="margin-top: auto; width: 100%;">
                ${actionHtml}
            </div>
        `;
        
        const useBtn = card.querySelector('button[data-action="use"]');
        if (useBtn) {
            useBtn.addEventListener('click', () => {
                selectModel(m.id);
                switchToView('chat');
            });
        }
        
        const dlBtn = card.querySelector('button[data-action="download"]');
        if (dlBtn) {
            dlBtn.addEventListener('click', () => {
                startModelDownload(m.id);
            });
        }
        
        hubGrid.appendChild(card);
    });
}

// Download dynamic model
function startModelDownload(modelId) {
    if (!chatWorker) {
        deviceBackend = document.querySelector('input[name="device"]:checked').value;
        initializeWorker();
    }
    
    downloadingModels[modelId] = {
        loaded: 0,
        total: 0,
        progress: 0,
        status: 'downloading'
    };
    
    renderModelHub();
    
    if (modelId === 'Xenova/vit-gpt2-image-captioning') {
        chatWorker.postMessage({
            type: 'vision',
            data: { device: deviceBackend, image: null }
        });
    } else if (modelId === 'onnx-community/whisper-tiny.en' || modelId === 'onnx-community/Kokoro-82M-v1.0-ONNX') {
        // Already initialized on boot. If the worker is running, it's either in progress or done.
        // No action needed if already running, else initializeWorker() just ran above.
    } else {
        chatWorker.postMessage({
            type: 'init',
            data: { device: deviceBackend, modelId: modelId }
        });
    }
    
    if (selectedModelId === modelId) {
        const statusCard = document.getElementById('status-chat');
        if (statusCard) {
            statusCard.querySelector('.status-indicator').textContent = 'Loading';
            statusCard.querySelector('.status-indicator').className = 'status-indicator downloading';
            const dot = statusCard.querySelector('.dot-chat');
            if (dot) dot.className = 'status-dot dot-chat loading';
        }
    }
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0 || !bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function parseMarkdown(text) {
    if (!text) return "";
    let html = escapeHtml(text);
    
    // Convert code blocks
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    
    // Convert inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Convert bold (**text**)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // Convert italic (*text* or _text_)
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
    
    // Convert lists
    const lines = html.split('\n');
    let inList = false;
    const parsedLines = lines.map(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
            let itemContent = trimmed.substring(2);
            let result = '';
            if (!inList) {
                inList = true;
                result += '<ul class="markdown-list">';
            }
            result += `<li>${itemContent}</li>`;
            return result;
        } else {
            let result = '';
            if (inList) {
                inList = false;
                result += '</ul>';
            }
            return result + line;
        }
    });
    if (inList) {
        parsedLines.push('</ul>');
    }
    
    return parsedLines.join('<br>');
}

function parseReasoningText(text) {
    let reasoning = "";
    let content = text;
    
    const isThinkingModel = selectedModelId.toLowerCase().includes('thinking');
    
    if (text.includes("<think>")) {
        const parts = text.split("<think>");
        const afterThink = parts[1] || "";
        
        if (afterThink.includes("</think>")) {
            const thinkParts = afterThink.split("</think>");
            reasoning = thinkParts[0];
            content = thinkParts[1] || "";
        } else {
            reasoning = afterThink;
            content = "";
        }
    } else if (text.includes("</think>")) {
        // Handle case where <think> tag was pre-filled in the prompt template and thus absent from generation stream
        const parts = text.split("</think>");
        reasoning = parts[0];
        content = parts[1] || "";
    } else if (isThinkingModel) {
        // If it's a thinking model and neither tag has appeared yet, all generated output is reasoning
        reasoning = text;
        content = "";
    }
    
    return {
        reasoning: reasoning.trim(),
        content: content.trim()
    };
}

function handleWorkerMessage(event) {
    const { type, model, file, progress, message, text, audio, samplingRate, caption, loaded, total } = event.data;
    
    // Map system model alias to HF ID for Hub syncing
    const SYSTEM_MODEL_MAPPING = {
        'asr': 'onnx-community/whisper-tiny.en',
        'tts': 'onnx-community/Kokoro-82M-v1.0-ONNX',
        'vision': 'Xenova/vit-gpt2-image-captioning'
    };
    const mappedModelId = SYSTEM_MODEL_MAPPING[model] || model;
    
    switch (type) {
        case 'status':
            initStatusText.textContent = message;
            break;
            
        case 'initiate': {
            // Update Hub progress tracking
            downloadingModels[mappedModelId] = {
                loaded: 0,
                total: 0,
                progress: 0,
                status: 'downloading'
            };
            renderModelHub();

            if (model === 'asr' || model === 'tts' || model === 'vision') {
                const initCard = document.getElementById(`status-${model}`);
                if (initCard) {
                    const indicator = initCard.querySelector('.status-indicator');
                    indicator.textContent = 'Loading';
                    indicator.className = 'status-indicator downloading';
                    
                    const dot = initCard.querySelector(`.dot-${model}`);
                    if (dot) {
                        dot.className = `status-dot dot-${model} loading`;
                    }
                    
                    const fileName = file.split('/').pop();
                    const details = initCard.querySelector('.progress-details');
                    if (details) {
                        details.textContent = `Fetching ${fileName}...`;
                    }
                    
                    initStatusText.textContent = `Downloading ${model} file: ${fileName}...`;
                }
            } else {
                if (model === selectedModelId) {
                    const chatDiagCard = document.getElementById('status-chat');
                    if (chatDiagCard) {
                        chatDiagCard.querySelector('.status-indicator').textContent = 'Loading';
                        chatDiagCard.querySelector('.status-indicator').className = 'status-indicator downloading';
                        const dot = chatDiagCard.querySelector('.dot-chat');
                        if (dot) dot.className = 'status-dot dot-chat loading';
                        
                        const fileName = file.split('/').pop();
                        const details = chatDiagCard.querySelector('.progress-details');
                        if (details) details.textContent = `Fetching ${fileName}...`;
                    }
                }
            }
            break;
        }

        case 'progress': {
            let progressText = "";
            let progressPercent = 0;
            
            if (total) {
                progressPercent = Math.round((loaded / total) * 100);
                progressText = `${formatBytes(loaded, 0)} / ${formatBytes(total, 0)} (${progressPercent}%)`;
            } else {
                progressText = `${formatBytes(loaded, 0)} downloaded`;
                progressPercent = 100;
            }
            
            // Update downloading progress tracking
            if (downloadingModels[mappedModelId]) {
                downloadingModels[mappedModelId].loaded = loaded;
                downloadingModels[mappedModelId].total = total;
                downloadingModels[mappedModelId].progress = progressPercent;
            }

            // Update DOM card directly
            const card = document.querySelector(`.model-card[data-model-id="${mappedModelId}"]`);
            if (card) {
                const progressRow = card.querySelector('.card-action-row');
                if (progressRow) {
                    progressRow.innerHTML = `
                        <div class="card-progress-container">
                            <div class="card-progress-header">
                                <span>Downloading...</span>
                                <span>${progressPercent}%</span>
                            </div>
                            <div class="card-progress-bar-bg">
                                <div class="card-progress-bar" style="width: ${progressPercent}%"></div>
                            </div>
                        </div>
                    `;
                }
            }
            
            if (model === 'asr' || model === 'tts' || model === 'vision') {
                const modelCard = document.getElementById(`status-${model}`);
                if (modelCard) {
                    const indicator = modelCard.querySelector('.status-indicator');
                    indicator.textContent = 'Loading';
                    indicator.className = 'status-indicator downloading';
                    
                    const dot = modelCard.querySelector(`.dot-${model}`);
                    if (dot) {
                        dot.className = `status-dot dot-${model} loading`;
                    }

                    const details = modelCard.querySelector('.progress-details');
                    const bar = modelCard.querySelector('.progress-bar');
                    if (details) details.textContent = progressText;
                    if (bar) {
                        bar.style.width = `${progressPercent}%`;
                        if (total) bar.classList.remove('indeterminate');
                        else bar.classList.add('indeterminate');
                    }
                    const fileName = file.split('/').pop();
                    initStatusText.textContent = `Downloading ${model}: ${fileName} (${progressText})`;
                }
            } else {
                if (model === selectedModelId) {
                    const chatDiagCard = document.getElementById('status-chat');
                    if (chatDiagCard) {
                        const details = chatDiagCard.querySelector('.progress-details');
                        const bar = chatDiagCard.querySelector('.progress-bar');
                        if (details) details.textContent = progressText;
                        if (bar) {
                            bar.style.width = `${progressPercent}%`;
                            if (total) bar.classList.remove('indeterminate');
                            else bar.classList.add('indeterminate');
                        }
                    }
                }
            }
            break;
        }
            
        case 'done': {
            if (model === 'asr' || model === 'tts' || model === 'vision') {
                const doneCard = document.getElementById(`status-${model}`);
                if (doneCard) {
                    const details = doneCard.querySelector('.progress-details');
                    if (details) details.textContent = `File loaded! Instantiating model...`;
                }
            } else {
                if (model === selectedModelId) {
                    const chatDiagCard = document.getElementById('status-chat');
                    if (chatDiagCard) {
                        const details = chatDiagCard.querySelector('.progress-details');
                        if (details) details.textContent = `File loaded! Instantiating model...`;
                    }
                }
            }
            break;
        }
            
        case 'ready': {
            cachedModels.add(mappedModelId);
            delete downloadingModels[mappedModelId];
            
            renderModelHub();
            renderModelDropdown();

            if (model === 'asr' || model === 'tts' || model === 'vision') {
                const card = document.getElementById(`status-${model}`);
                if (card) {
                    const indicator = card.querySelector('.status-indicator');
                    indicator.textContent = 'Ready';
                    indicator.className = 'status-indicator ready';
                    
                    const dot = card.querySelector(`.dot-${model}`);
                    if (dot) dot.className = `status-dot dot-${model} online`;

                    const details = card.querySelector('.progress-details');
                    if (details) details.textContent = `Cached in browser storage`;
                    
                    const bar = card.querySelector('.progress-bar');
                    bar.style.width = `100%`;
                    bar.classList.remove('indeterminate');
                }
            } else {
                if (model === selectedModelId) {
                    const chatDiagCard = document.getElementById('status-chat');
                    if (chatDiagCard) {
                        const indicator = chatDiagCard.querySelector('.status-indicator');
                        indicator.textContent = 'Ready';
                        indicator.className = 'status-indicator ready';
                        const dot = chatDiagCard.querySelector('.dot-chat');
                        if (dot) dot.className = 'status-dot dot-chat online';
                        
                        const details = chatDiagCard.querySelector('.progress-details');
                        if (details) details.textContent = `Cached in browser storage`;
                        
                        const bar = chatDiagCard.querySelector('.progress-bar');
                        bar.style.width = `100%`;
                        bar.classList.remove('indeterminate');
                    }
                }
            }
            break;
        }
            
        case 'init_complete':
            if (event.data.worker === 'chat') {
                chatReady = true;
                currentLoadedModel = event.data.modelId;
            }
            if (event.data.worker === 'audio') audioReady = true;
            
            if (isModelInitializing) {
                if (chatReady && audioReady) {
                    isModelInitializing = false;
                    hideLoadingOverlay();
                    promptInput.disabled = false;
                    sendBtn.disabled = false;
                    micBtn.disabled = false;
                    promptInput.focus();
                }
            } else {
                if (chatReady) {
                    hideLoadingOverlay();
                    promptInput.disabled = false;
                    sendBtn.disabled = false;
                    micBtn.disabled = false;
                    promptInput.focus();
                }
            }
            break;
            
        case 'chat_start':
            removeTemporaryMessages();
            // Create a new assistant bubble with an initial spinning thinking state to avoid empty bubbles during prompt loading
            const msgDiv = document.createElement('div');
            msgDiv.className = 'message assistant';
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'msg-content';
            
            const textNode = document.createElement('div');
            textNode.className = 'streaming-text';
            textNode.innerHTML = `
                <div class="reasoning-box" open>
                    <summary>
                        <div class="reasoning-icon spinner"></div>
                        <span>Thinking Process</span>
                    </summary>
                    <div class="reasoning-content"><span class="cursor-blink">|</span></div>
                </div>
            `;
            contentDiv.appendChild(textNode);
            
            msgDiv.appendChild(contentDiv);
            chatMessages.appendChild(msgDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            
            currentAssistantMessageElement = textNode;
            break;
            
        case 'chat_stream':
            // Update the assistant bubble text as tokens stream in
            if (currentAssistantMessageElement) {
                const parsed = parseReasoningText(text);
                let html = "";
                
                if (parsed.reasoning) {
                    const isOpen = !parsed.content; // Expanded while thinking, collapses once response content starts
                    const reasoningCursor = isOpen ? `<span class="cursor-blink">|</span>` : '';
                    html += `
                        <details class="reasoning-box" ${isOpen ? 'open' : ''}>
                            <summary>
                                ${isOpen ? `
                                    <div class="reasoning-icon spinner"></div>
                                ` : `
                                    <svg class="reasoning-icon check" viewBox="0 0 20 20" fill="currentColor">
                                        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                                    </svg>
                                `}
                                <span>Thinking Process</span>
                            </summary>
                            <div class="reasoning-content">${escapeHtml(parsed.reasoning)}${reasoningCursor}</div>
                        </details>
                    `;
                }
                
                if (parsed.content) {
                    html += `<div class="response-content">${parseMarkdown(parsed.content)}<span class="cursor-blink">|</span></div>`;
                } else if (!parsed.reasoning) {
                    // Show a fallback cursor outside if there's no content or reasoning
                    html += `<span class="cursor-blink">|</span>`;
                }
                
                if (event.data.tps) {
                    html += `<div class="generation-stats">⚡ ${event.data.tps} tps • ${event.data.tokens} tokens • ${event.data.time}s</div>`;
                }
                
                currentAssistantMessageElement.innerHTML = html;
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
            break;
            
        case 'chat_result':
            removeTemporaryMessages();
            
            // Re-enable input controls after prompt generation completes
            promptInput.disabled = false;
            sendBtn.disabled = false;
            micBtn.disabled = false;
            promptInput.focus();
 
            // Finalize the assistant message layout
            if (currentAssistantMessageElement) {
                const parsed = parseReasoningText(text);
                let html = "";
                const finalTps = event.data.tps || 0;
                const finalTokens = event.data.tokens || 0;
                const finalTime = event.data.time || 0;
                
                if (parsed.reasoning) {
                    html += `
                        <details class="reasoning-box">
                            <summary>
                                <svg class="reasoning-icon check" viewBox="0 0 20 20" fill="currentColor">
                                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                                </svg>
                                <span>Thought for ${finalTime > 0 ? finalTime + 's' : 'a few seconds'}</span>
                            </summary>
                              <div class="reasoning-content">${escapeHtml(parsed.reasoning)}</div>
                        </details>
                    `;
                }
                
                if (parsed.content) {
                    html += `<div class="response-content">${parseMarkdown(parsed.content)}</div>`;
                } else {
                    html += `<div class="response-content">Thinking process complete. No response content generated.</div>`;
                }
                
                if (finalTps > 0) {
                    html += `<div class="generation-stats final">⚡ Speed: ${finalTps} tps • Total: ${finalTokens} tokens • Time: ${finalTime}s</div>`;
                }
                
                currentAssistantMessageElement.innerHTML = html;
                currentAssistantMessageElement = null;
            } else {
                appendMessage('assistant', text);
            }
            
            messages.push({ role: 'assistant', content: text });
            
            // Trigger TTS if enabled
            if (ttsSpeechToggle.checked) {
                const parsed = parseReasoningText(text);
                const speakableText = parsed.content || "Thinking complete.";
                speakText(speakableText);
            }
            break;
            
        case 'asr_start':
            recordingText.textContent = "Processing speech acoustics...";
            break;
            
        case 'asr_result':
            micRecordingStatus.classList.add('hidden');
            if (text.trim()) {
                promptInput.value = (promptInput.value + " " + text).trim();
                adjustTextareaHeight();
            } else {
                addSystemMessage("Speech not recognized. Please try speaking closer to the mic.");
            }
            break;
            
        case 'tts_start':
            break;
            
        case 'tts_result':
            playAudioBuffer(audio, samplingRate);
            break;
            
        case 'vision_start':
            imageAnalyzingOverlay.classList.remove('hidden');
            break;
            
        case 'vision_result':
            imageAnalyzingOverlay.classList.add('hidden');
            
            const imgCaption = caption || "No description available.";
            
            const visionCard = document.getElementById('status-vision');
            const ind = visionCard.querySelector('.status-indicator');
            ind.textContent = 'Ready';
            ind.className = 'status-indicator ready';
            
            const vDot = visionCard.querySelector('.dot-vision');
            if (vDot) {
                vDot.className = 'status-dot dot-vision online';
            }
            
            const vDetails = visionCard.querySelector('.progress-details');
            if (vDetails) {
                vDetails.textContent = 'Vision layers active';
            }
            
            visionCard.querySelector('.progress-bar').style.width = '100%';

            executeMultimodalChat(imgCaption);
            break;
            
        case 'error':
            removeTemporaryMessages();
            appendMessage('assistant', `⚠️ local engine error: ${message}`);
            
            // Re-enable inputs on error to keep app usable
            promptInput.disabled = false;
            sendBtn.disabled = false;
            micBtn.disabled = false;
            promptInput.focus();
            break;
    }
}

// Speak text using Kokoro-TTS
function speakText(text) {
    if (!audioWorker) return;
    
    // Stop currently playing voice if any
    stopAudioPlayback();
    
    audioWorker.postMessage({
        type: 'tts',
        data: {
            text: text,
            voice: voiceSelect.value,
            device: deviceBackend
        }
    });
}

// Play Float32 Audio returned by Kokoro
function playAudioBuffer(samples, sampleRate) {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        // Stop previous audio
        stopAudioPlayback();
        
        // Create an audio buffer
        const buffer = audioContext.createBuffer(1, samples.length, sampleRate);
        buffer.copyToChannel(samples, 0);
        
        // Play source
        currentAudioSourceNode = audioContext.createBufferSource();
        currentAudioSourceNode.buffer = buffer;
        currentAudioSourceNode.connect(audioContext.destination);
        currentAudioSourceNode.start();
    } catch (e) {
        console.error("Failed to play TTS audio:", e);
    }
}

function stopAudioPlayback() {
    if (currentAudioSourceNode) {
        try {
            currentAudioSourceNode.stop();
        } catch (e) {}
        currentAudioSourceNode = null;
    }
}

// Chat UI Controls
function appendMessage(role, text, imageUrl = null) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'msg-content';
    
    if (imageUrl) {
        const img = document.createElement('img');
        img.src = imageUrl;
        contentDiv.appendChild(img);
    }
    
    if (role === 'assistant') {
        const textNode = document.createElement('div');
        textNode.className = 'response-content';
        textNode.innerHTML = parseMarkdown(text);
        contentDiv.appendChild(textNode);
    } else {
        const textNode = document.createElement('p');
        textNode.textContent = text;
        contentDiv.appendChild(textNode);
    }
    
    msgDiv.appendChild(contentDiv);
    chatMessages.appendChild(msgDiv);
    
    // Auto Scroll
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addSystemMessage(text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message system temp-msg';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'msg-content';
    
    // Create animated loader dots for the thinking state
    const textNode = document.createElement('span');
    textNode.textContent = text;
    contentDiv.appendChild(textNode);
    
    if (text.includes("formulating") || text.includes("thinking") || text.includes("captioning")) {
        const typingIndicator = document.createElement('div');
        typingIndicator.className = 'mini-typing-indicator';
        typingIndicator.innerHTML = '<span></span><span></span><span></span>';
        contentDiv.appendChild(typingIndicator);
    }
    
    msgDiv.appendChild(contentDiv);
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeTemporaryMessages() {
    document.querySelectorAll('.temp-msg').forEach(el => el.remove());
}

// Textarea Auto-growth
promptInput.addEventListener('input', adjustTextareaHeight);
function adjustTextareaHeight() {
    promptInput.style.height = 'auto';
    promptInput.style.height = `${promptInput.scrollHeight}px`;
}

// Clear chat
clearBtn.addEventListener('click', () => {
    messages = [SYSTEM_PROMPT];
    activeImageCaption = null;
    chatMessages.innerHTML = '';
    stopAudioPlayback();
    currentAssistantMessageElement = null;
    
    // Re-add intro card with dynamic active model
    const model = MODELS.find(m => m.id === selectedModelId);
    const introDiv = document.createElement('div');
    introDiv.className = 'message system';
    introDiv.innerHTML = `
        <div class="msg-content">
            <div class="system-intro-card">
                <div class="system-intro-logo">⚡</div>
                <h3>Welcome to Aether Local AI</h3>
                <p>All processing runs <strong>100% locally</strong> inside your web browser. E2E privacy is preserved. No remote API requests are made.</p>
                <div class="system-capabilities">
                    <span class="cap-pill">💧 ${model ? model.name : 'Local LLM'}</span>
                    <span class="cap-pill">🎙️ Whisper Dictation</span>
                    <span class="cap-pill">🔊 Kokoro Vocalizer</span>
                    <span class="cap-pill">🖼️ ViT Vision</span>
                </div>
            </div>
        </div>
    `;
    chatMessages.appendChild(introDiv);
});

// Image Upload Controls
imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
        currentImageDataUrl = event.target.result;
        imagePreview.src = currentImageDataUrl;
        imagePreviewContainer.classList.remove('hidden');
        uploadedInfo.textContent = `Attached: ${file.name}`;
    };
    reader.readAsDataURL(file);
});

removeImageBtn.addEventListener('click', clearImageAttachment);
function clearImageAttachment() {
    imageInput.value = '';
    currentImageDataUrl = null;
    imagePreview.src = '';
    imagePreviewContainer.classList.add('hidden');
    uploadedInfo.textContent = '';
}

// Message Sending Orchestration
sendBtn.addEventListener('click', sendMessage);
promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

async function sendMessage() {
    const prompt = promptInput.value.trim();
    if (!prompt && !currentImageDataUrl) return;
    
    // Disable inputs during local inference to prevent concurrent queue overlap
    promptInput.disabled = true;
    sendBtn.disabled = true;
    micBtn.disabled = true;
    
    // Close sidebar on mobile once a message is sent to focus on chat
    if (sidebar.classList.contains('mobile-open')) {
        sidebar.classList.remove('mobile-open');
    }
    
    // Stop TTS speaking instantly if user starts entering new prompt
    stopAudioPlayback();
    
    // Reset textarea height
    promptInput.value = '';
    adjustTextareaHeight();
    
    // 1. Show user message in UI
    appendMessage('user', prompt, currentImageDataUrl);
    
    const attachedImage = currentImageDataUrl;
    
    if (attachedImage) {
        clearImageAttachment();
        addSystemMessage("Running local image captioning model...");
        
        chatWorker.postMessage({
            type: 'vision',
            data: {
                image: attachedImage,
                device: deviceBackend
            }
        });
        
        window.__pendingPrompt = prompt;
    } else {
        let finalPrompt = prompt;
        if (activeImageCaption) {
            finalPrompt = `[Context - Image under discussion: "${activeImageCaption}"]. User prompt: ${prompt}`;
        }
        messages.push({ role: 'user', content: finalPrompt });
        triggerChatInference();
    }
}

function executeMultimodalChat(caption) {
    removeTemporaryMessages();
    
    activeImageCaption = caption;
    
    const prompt = window.__pendingPrompt || "";
    window.__pendingPrompt = null;
    
    const contextualPrompt = `[User uploaded an image. Caption/Description: "${caption}"]. User prompt: ${prompt}`;
    
    messages.push({ role: 'user', content: contextualPrompt });
    triggerChatInference();
}

function triggerChatInference() {
    if (!chatWorker) return;
    
    chatWorker.postMessage({
        type: 'chat',
        data: {
            messages: messages,
            device: deviceBackend,
            modelId: selectedModelId
        }
    });
}

// Speech Recording Logic (for ASR)
micBtn.addEventListener('click', toggleRecording);

async function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        await startRecording();
    }
}

async function startRecording() {
    try {
        stopAudioPlayback(); // Stop any voice playing
        
        audioInputList = [];
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        const source = audioContext.createMediaStreamSource(mediaStream);
        
        // Create script processor to record audio samples
        audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);
        
        audioProcessor.onaudioprocess = (e) => {
            if (!isRecording) return;
            const inputData = e.inputBuffer.getChannelData(0);
            audioInputList.push(new Float32Array(inputData));
        };
        
        source.connect(audioProcessor);
        audioProcessor.connect(audioContext.destination);
        
        isRecording = true;
        micBtn.classList.add('recording');
        micRecordingStatus.classList.remove('hidden');
        recordingText.textContent = "Listening... Speak now.";
    } catch (e) {
        console.error("Mic permissions or initialization failed:", e);
        addSystemMessage("Failed to access microphone. Please check permissions.");
    }
}

function stopRecording() {
    if (!isRecording) return;
    
    isRecording = false;
    micBtn.classList.remove('recording');
    
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
    }
    
    if (audioProcessor) {
        audioProcessor.disconnect();
    }
    
    const totalLength = audioInputList.reduce((acc, val) => acc + val.length, 0);
    const audioBuffer = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of audioInputList) {
        audioBuffer.set(chunk, offset);
        offset += chunk.length;
    }
    
    const originalRate = audioContext.sampleRate;
    const downsampledBuffer = downsampleBuffer(audioBuffer, originalRate, 16000);
    
    audioWorker.postMessage({
        type: 'asr',
        data: {
            audio: downsampledBuffer,
            device: deviceBackend
        }
    });
}

// Linear Decimation Downsampler
function downsampleBuffer(buffer, inputSampleRate, outputSampleRate = 16000) {
    if (inputSampleRate === outputSampleRate) {
        return buffer;
    }
    const sampleRateRatio = inputSampleRate / outputSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
        let accum = 0, count = 0;
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
            accum += buffer[i];
            count++;
        }
        result[offsetResult] = count > 0 ? accum / count : 0;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
    }
    return result;
}
