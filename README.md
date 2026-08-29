# Aether

[![Live Demo](https://img.shields.io/badge/Live_Demo-https%3A%2F%2Fnetless--lm.web.app-7c4dff?style=for-the-badge&logo=firebase)](https://netless-lm.web.app)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.19.0-339933?style=for-the-badge&logo=nodedotjs)](https://nodejs.org)
[![WebGPU](https://img.shields.io/badge/WebGPU-Accelerated-007ACC?style=for-the-badge&logo=w3c)](https://www.w3.org/TR/webgpu/)
[![PWA](https://img.shields.io/badge/PWA-Offline_Ready-5A0FC8?style=for-the-badge&logo=pwa)](https://netless-lm.web.app)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

<p align="center">
  <b>Watch the Setup & Demo Video:</b> <a href="https://youtu.be/tdg7T7LthY8">https://youtu.be/tdg7T7LthY8</a>
</p>

<p align="center">
  <a href="https://youtu.be/tdg7T7LthY8">
    <img src="https://img.youtube.com/vi/tdg7T7LthY8/maxresdefault.jpg" alt="Aether Setup & Demo Video" width="100%">
  </a>
</p>

Aether is a browser-native, zero-backend AI workspace that executes Large Language Models (LLMs), Computer Vision models, and Audio processing entirely on client hardware using **WebGPU** and **WebAssembly (WASM)**.

No external API keys, cloud servers, or user accounts are required. All inference, document chunking, and state persistence occur locally within the browser.

[**Launch Live Demo**](https://netless-lm.web.app)

---

## Core Capabilities

- **Zero-Server Local Inference**: Prompts, media files, and document embeddings never leave your device. All model math runs client-side via WebGPU.
- **Multimodal AI Runtimes**:
  - **Text Generation**: Interactive chat supporting extended reasoning (`<think>` scratchpad) and document context querying.
  - **Vision Processing**: In-browser image analysis and visual question answering.
  - **Audio Processing**: High-fidelity speech transcription and voice interaction.
- **Client-Side Retrieval-Augmented Generation (RAG)**: Extract, chunk, and index PDF, DOCX, TXT, Markdown, CSV, JSON, and HTML files entirely within the browser sandbox.
- **Progressive Web Application**: Fully installable PWA for macOS, Windows, Linux, Android, and iOS. Operates completely offline once models are cached in IndexedDB.
- **Web Worker Parallelism**: Heavy AI workloads execute in background Web Workers, maintaining a smooth 60 FPS UI thread.
- **Cross-Origin Security & Isolation**: Pre-configured with COOP/COEP headers to support multi-threaded WASM and modern WebGPU security contexts.

---

## Model Catalog

Aether pins curated open models to immutable Hugging Face revisions to ensure deterministic client-side loading:

| Mode | Model Identifier | Quantization | Download Size | Primary Use Case |
| :--- | :--- | :--- | :---: | :--- |
| **Text** | `LFM 2.5 350M` | Q4 | ~276 MB | Ultra-fast lightweight response generation |
| **Text** | `LFM 2.5 1.2B Instruct` | Q4F16 | ~760 MB | High-quality general instruction following |
| **Text** | `LFM 2.5 1.2B Thinking` | Q4F16 | ~760 MB | Extended step-by-step reasoning via `<think>` blocks |
| **Vision** | `LFM 2.5 VL 450M` | FP16 / Q4 | ~770 MB | Image understanding and multimodal Q&A |
| **Audio** | `LFM 2.5 Audio 1.5B` | Q4 | ~1.6 GB | Client-side speech transcription and processing |

---

## Quick Start

### Prerequisites

- **Node.js**: `>=20.19.0` or `>=22.12.0`
- **Browser**: Google Chrome, Microsoft Edge, or Brave with **WebGPU** enabled (with automated fallback to multi-threaded WASM).

### Local Development Setup

```bash
# Clone the repository
git clone https://github.com/techjarves/local-browser-ai.git
cd local-browser-ai

# Install dependencies cleanly
npm ci

# Start the Vite development server
npm run dev
```

Navigate to `http://localhost:5173` in your browser.

---

## CLI & Scripts

The repository includes scripts for code verification, testing, and deployment:

```bash
# Type checking
npm run typecheck

# Linting
npm run lint

# Unit tests (Vitest)
npm run test

# End-to-end tests (Playwright)
npm run test:e2e

# Full verification suite (typecheck, lint, test, build)
npm run check

# Build production bundle (outputs to dist/)
npm run build

# Preview production build locally
npm run preview

# Deploy to Firebase Hosting
npm run deploy
```

---

## Architecture Overview

```
src/
├── app.ts            # UI lifecycle management, chat state, and event orchestration
├── models.ts         # Immutable Hugging Face model descriptors and catalog definitions
├── history.ts        # IndexedDB state management and Blob storage persistence
├── documents.ts      # Client-side document parsing, text chunking, and lexical search
├── text-worker.ts   # Dedicated Web Worker for LLM text generation and token streaming
├── media-worker.ts  # Background worker for vision processing and speech transcription
├── storage.ts        # Storage quota checks, browser cache management, and memory cleanup
└── preferences.ts    # Application preferences and theme state persistence
```

### Key Technical Patterns

- **Storage Engine**: IndexedDB manages chat sessions, system messages, and binary attachments.
- **Dynamic Resource Loading**: Libraries like `PDF.js` and `Mammoth` load lazily on-demand when processing PDF or Word documents.
- **Thread Isolation**: Inference runs inside worker threads (`text-worker.ts`, `media-worker.ts`), preventing main thread freezing during intensive matrix operations.

---

## Deployment

Aether is optimized for deployment on static hosting providers such as **Firebase Hosting**:

1. **Authenticate Firebase CLI**:
   ```bash
   npx firebase-tools login
   ```

2. **Deploy to Production**:
   ```bash
   npm run deploy
   ```

Production builds configure SPA rewrites (`**` -> `/index.html`), offline service worker caching, and COOP/COEP HTTP headers (`Same-Origin` / `Require-Corp`) for WebGPU and multi-threaded WASM execution.

---

## Privacy & Security Model

- **Local Execution**: Model weights are downloaded once directly from Hugging Face CDN and cached in local browser storage. User input, attachments, and conversations are never transmitted across the network.
- **Zero Telemetry**: No analytics scripts, tracking pixels, or phone-home requests are embedded.
- **Secure Contexts**: WebGPU requires a Secure Context (HTTPS or localhost) in all modern web browsers.

---

## License

This project is licensed under the [MIT License](LICENSE).

