# 🪐 Aether — In-Browser Private Local AI

[![Live Demo](https://img.shields.io/badge/Live_Demo-https%3A%2F%2Flocal--browser--ai--app.web.app-7c4dff?style=for-the-badge&logo=firebase)](https://local-browser-ai-app.web.app)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.19.0-339933?style=for-the-badge&logo=nodedotjs)](https://nodejs.org)
[![WebGPU](https://img.shields.io/badge/WebGPU-Accelerated-007ACC?style=for-the-badge&logo=w3c)](https://www.w3.org/TR/webgpu/)
[![PWA](https://img.shields.io/badge/PWA-Offline_Ready-5A0FC8?style=for-the-badge&logo=pwa)](https://local-browser-ai-app.web.app)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

> **Private, browser-native AI workspace** that runs Large Language Models (LLMs), Computer Vision, and Audio AI entirely on your local machine using **WebGPU** and **WebAssembly (WASM)**.  
> **No API keys. No cloud inference servers. No account required. 100% free & private.**

👉 **[Launch Aether in Your Browser](https://local-browser-ai-app.web.app)**

---

## ✨ Features

- 🔒 **100% Private & Local**: Your prompts, documents, images, and audio recordings never leave your device.
- ⚡ **WebGPU Hardware Acceleration**: Blazing-fast local LLM token generation using your computer or smartphone's GPU.
- 💬 **Multimodal AI Modes**:
  - **Text**: Intelligent chat with reasoning `<think>` capabilities and deep local document Q&A.
  - **Vision**: Local image analysis and visual understanding.
  - **Audio**: Speech transcription and voice interaction.
- 📄 **In-Browser RAG (Retrieval-Augmented Generation)**: Attach PDF, DOCX, TXT, Markdown, CSV, JSON, and HTML files. Text extraction, chunking, and lexical search happen completely in your browser.
- 📱 **Progressive Web App (PWA)**: Installable on Windows, macOS, Linux, Android, and iOS. Works in **Airplane Mode** once models are cached!
- 🌓 **Dark & Light Mode**: Modern interface with seamless theme switching and system preference auto-detection.
- 🌐 **Zero Server Compute Cost**: Offloads all heavy inference math to client hardware. Hosted statically on Firebase CDN.

---

## 🤖 Curated Model Catalog

All models are pinned to immutable Hugging Face revisions and execute locally:

| Mode | Model Name | Quantization | Size | Description |
| :--- | :--- | :--- | :---: | :--- |
| **Text** | `LFM 2.5 350M` | Q4 | ~276 MB | Ultra-fast lightweight model for quick responses |
| **Text** | `LFM 2.5 1.2B Instruct` | Q4F16 | ~760 MB | High-quality general instruction model |
| **Text** | `LFM 2.5 1.2B Thinking` | Q4F16 | ~760 MB | Extended reasoning model with `<think>` scratchpad |
| **Vision** | `LFM 2.5 VL 450M` | FP16 / Q4 | ~770 MB | Multimodal image understanding & visual QA |
| **Audio** | `LFM 2.5 Audio 1.5B` | Q4 | ~1.6 GB | Speech transcription & audio model |

---

## 🚀 Quick Start

### Prerequisites
- **Node.js**: `>=20.19.0` or `>=22.12.0`
- **Browser**: Modern Chrome, Edge, or Brave with **WebGPU** enabled (with fallback to multi-threaded WASM).

### Installation

```bash
# Clone repository
git clone https://github.com/techjarves/local-browser-ai.git
cd local-browser-ai

# Install dependencies
npm ci

# Start local development server
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## 🛠️ CLI Commands

```bash
# Run TypeScript type check
npm run typecheck

# Run ESLint validation
npm run lint

# Run Vitest unit tests
npm run test

# Run Playwright E2E tests
npm run test:e2e

# Production build (outputs to dist/)
npm run build

# Preview production build locally
npm run preview

# Complete quality check (typecheck + lint + test + build)
npm run check

# Deploy to Firebase Hosting
npm run deploy
```

---

## 🏗️ Architecture Overview

```
src/
├── app.ts            # UI orchestration, chat state, theme engine, attachment management
├── models.ts         # Pinned Hugging Face model descriptors & catalog definitions
├── history.ts        # IndexedDB conversation state & Blob storage persistence
├── documents.ts      # Lazy PDF/DOCX text extraction, chunking, and lexical search
├── text-worker.ts   # Dedicated Web Worker for LLM text generation & token streaming
├── media-worker.ts  # Web Worker for vision (image QA) & audio transcription runtimes
├── storage.ts        # Browser quota preflight, cache inspection, and model disposal
└── preferences.ts    # Safe local preference migration & theme settings
```

- **IndexedDB**: Conversations and original attachment blobs are stored locally on your device.
- **Lazy Loading**: `PDF.js` and `Mammoth` are loaded dynamically only when extracting PDF or Word files.
- **Web Workers**: Model execution runs off the main UI thread to maintain 60 FPS UI responsiveness.

---

## 🚀 Firebase Hosting Deployment

Aether is pre-configured for **Firebase Hosting**:

1. **Authenticate Firebase CLI**:
   ```bash
   npx firebase-tools login
   ```
2. **Deploy to Production**:
   ```bash
   npm run deploy
   ```

Deployments utilize SPA rewrite rules (`**` -> `/index.html`), Service Worker cache rules, and Cross-Origin isolation headers (`COOP`/`COEP`) for WebAssembly multi-threading support.

---

## 🔒 Privacy & Security

- **Data Privacy**: Model weights are downloaded once from Hugging Face and cached locally in your browser (IndexedDB). Prompts, chat history, and uploaded files stay 100% on your machine.
- **No Telemetry**: Zero analytics, zero user tracking, zero external network calls during AI inference.
- **Security Context**: Production deployments enforce HTTPS (required by WebGPU browser security policies).

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.
