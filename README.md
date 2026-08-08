# Aether Local AI

Aether is a browser-only, desktop-first private AI workspace with exactly three modes: **Text**, **Vision**, and **Audio**. Models execute locally through WebGPU. There is no account, cloud inference API, analytics, or telemetry.

## Quick start

Requires Node.js 20.19+ or 22.12+.

```bash
npm ci
npm run dev
```

The app opens without loading an inference worker or model. On first use, the three-slide introduction leads to an explicit model download.

```bash
npm run typecheck
npm run lint
npm run test
npm run test:e2e
npm run build
npm run preview
npm run check
```

## Workspace behavior

- **Text** provides local chat and can attach images, audio, TXT, Markdown, CSV, JSON, HTML, DOCX, and text-based PDF files.
- **Vision** opens the image picker immediately, preserves the selected image, and then prepares its local model with compact live progress before enabling Send.
- **Audio** starts recording or opens the audio picker immediately, then prepares its local model before enabling transcription and Send.
- **Recents** are filtered by the active mode. Titles come from the first meaningful prompt or attachment, and individual chats can be deleted.
- **Settings** shows local model/history usage and provides model removal, introduction replay, and confirmed history deletion.

Conversations and original attachment `Blob`s are stored in IndexedDB until deleted. Temporary object URLs are never persisted and are revoked when the active conversation changes. Attachments are limited to five per conversation and 10 MB each. Scanned PDFs are reported as having no extractable text; Aether does not upload them or silently run OCR.

PDF.js and Mammoth are lazy-loaded only for PDF and DOCX extraction. Extracted text is chunked locally, ranked against the current question, and limited to half the text model context budget.

## Curated LFM 2.5 catalog

All catalog entries require WebGPU and are pinned to immutable Hugging Face revisions in `src/models.ts`.

| Mode | Model | Quantization | Approximate download | License |
| --- | --- | --- | ---: | --- |
| Text | LFM2.5-350M | Q4 | 276 MB | LFM-1.0 |
| Text | LFM2.5-1.2B-Instruct | Q4F16 | 760 MB | LFM-1.0 |
| Vision | LFM2.5-VL-450M | FP16 encoder + Q4 decoder | 770 MB | LFM-1.0 |
| Audio | LFM2.5-Audio-1.5B | Q4 | 1.6 GB | LFM-1.0 |

The official LFM2.5-VL-1.6B ONNX candidate remains hidden: its current export uses a non-Transformers.js session layout and failed the required Chrome/WebGPU smoke test. It can be enabled after a compatible pinned export passes the same test.

The model picker shows the backend, size, license, installed state, and Download/Use/Remove actions. Attachment-driven setup happens automatically after selection: the composer reports aggregate bytes and percentage, keeps Send disabled until readiness, and offers retry after failure. Setup checks browser storage with a 25% safety margin and uses right-side error toasts. Switching between Vision and Audio disposes the previous media runtime; Text uses a separate worker.

## Privacy, network, and offline behavior

- Model downloads contact Hugging Face. Prompts, documents, images, recordings, inference, and saved history remain on the device.
- Aether is not fully offline until both the PWA shell and the selected model are cached.
- The service worker caches only the small UI shell. Transformers.js owns model caching.
- Cached inference does not require a network request, but browser storage can be evicted when persistent storage is denied.
- Microphone access is requested only after a user action.

Production must use HTTPS because WebGPU is available only in a secure context. Current desktop Chrome or Edge is recommended. Unsupported browsers see a compatibility screen; there is no misleading CPU fallback. Mobile is responsive but large-model inference is not guaranteed on mobile hardware.

## Architecture

- `src/app.ts`: three-mode UI, model setup, chat orchestration, attachment flows, and toasts.
- `src/models.ts`: pinned, mode-specific LFM catalog.
- `src/history.ts`: IndexedDB conversation and Blob persistence.
- `src/documents.ts`: validation, lazy extraction, chunking, and lexical retrieval.
- `src/text-worker.ts`: streaming text generation, progress, cancellation, and disposal.
- `src/media-worker.ts`: mutually exclusive vision/audio runtimes and multimodal context.
- `src/preferences.ts`: safe versioned preference migration.
- `src/storage.ts`: quota preflight, persistence request, model cache inspection, and removal.

## Testing

The normal browser suite uses mocked inference workers but real IndexedDB, file selection, PDF.js, and Mammoth paths:

```bash
npm run test:e2e
```

Real-model tests are opt-in because they download several gigabytes and require desktop Chrome with WebGPU:

```bash
AETHER_REAL_HARDWARE=1 npm run test:e2e -- e2e/hardware.spec.ts --project desktop-chrome
```

Set `AETHER_TEST_IMAGE=/absolute/image.png` and `AETHER_TEST_AUDIO=/absolute/audio.wav` to use representative fixtures. Verify a successful first download, cached reload, offline continuation, model removal, and no network request during cached generation on each supported machine.

## Deployment and troubleshooting

Run `npm run build` and serve `dist/` from an HTTPS static host with SPA fallback to `index.html`.

- **WebGPU unavailable:** update the desktop browser/GPU driver and verify HTTPS.
- **Not enough storage:** free the displayed model size plus at least 25%, then retry.
- **Download interrupted:** reconnect and retry; already cached files may be reused.
- **Document has no text:** use a text-based PDF or a supported text/DOCX file; OCR is intentionally not included.
- **Model is slow or crashes:** close GPU-heavy tabs and choose the smaller model for that mode.

## Dependency audit exception

`npm audit` currently reports five high advisories inherited through Node-only `onnxruntime-node`, `adm-zip`, and `sharp` paths. The browser production graph uses `onnxruntime-web`; these Node adapters and native binaries are not callable from the browser bundle. The browser-reachable `protobufjs` version is overridden to fixed 7.6.5. Re-audit this documented exception whenever Transformers.js or the Liquid audio adapter is upgraded. No high or critical browser-runtime-reachable advisory is accepted.
