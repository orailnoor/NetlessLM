# Aether Local AI

Aether is a desktop-first, browser-only chat app powered by local models. It uses WebGPU when available, falls back to WASM/CPU, stores model files in browser-managed cache, and never sends prompts to an Aether backend.

## Quick start

Requirements: Node.js 20.19+ or 22.12+.

```bash
npm ci
npm run dev
```

Open the local URL shown by Vite. The landing page itself does not start an inference worker or fetch model weights. The first setup asks the user to download one selected text model.

Useful commands:

```bash
npm run build       # production PWA in dist/
npm run preview     # serve the production build
npm run typecheck   # strict TypeScript check
npm run lint        # ESLint
npm run test        # unit tests
npm run test:e2e    # mocked-worker browser tests
npm run check       # typecheck + lint + unit tests + build
```

For the browser suite, install Playwright Chromium once if Chrome is unavailable: `npx playwright install chromium`.

## What the first-time setup does

The onboarding is exactly three slides:

1. Private AI in your browser: local chat, no account, no telemetry.
2. Download once, use offline: the initial model download comes from Hugging Face and is cached by the browser.
3. Ready for this device: detected backend, recommended model, download size, free quota, and one Download & Start action.

After onboarding, Aether remembers only versioned UI preferences and the selected model. Chat content is not persisted. The introduction can be replayed from Settings.

## Supported models

| Use | Model | Backend / dtype | Approx. download | License |
| --- | --- | --- | ---: | --- |
| Recommended | `onnx-community/Qwen3-0.6B-ONNX` | WebGPU / q4f16 | 543.4 MB | Apache-2.0 |
| CPU fallback | `onnx-community/Qwen2.5-0.5B-Instruct` | WASM / q8 | 488.4 MB | Apache-2.0 |
| Optional quality | `LiquidAI/LFM2.5-1.2B-Instruct-ONNX` | WebGPU / q4f16 | 725.2 MB | LFM-1.0 |
| Optional vision | `LiquidAI/LFM2.5-VL-450M-ONNX` | WebGPU / fp16 + q4 | ~770 MB | LFM-1.0 |
| Optional audio | `LiquidAI/LFM2.5-Audio-1.5B-ONNX` | WebGPU / q4 | ~1.6 GB | LFM-1.0 |

Every catalog entry is pinned to an immutable revision in `src/models.ts`. The quality model is never selected or downloaded automatically. Images use direct LFM2.5 visual reasoning with image follow-up questions. Microphone transcription and spoken answers share LFM2.5 Audio. These optional models are WebGPU-only and download only when first invoked; the media worker disposes vision before audio (and audio before vision) to limit peak memory.

## Architecture

- `src/app.ts`: UI orchestration, onboarding, setup recovery, chat, and accessibility.
- `src/state-machine.ts`: explicit runtime transitions from boot through generation and recovery.
- `src/models.ts`: verified model catalog and backend selection.
- `src/text-worker.ts`: single text-generation worker with correlated progress, streaming, cancellation, and disposal.
- `src/media-worker.ts`: lazy, mutually exclusive LFM2.5 vision and audio runtimes.
- `src/storage.ts`: quota safety checks, persistent-storage request, cache status, and model removal.
- `src/preferences.ts`: safe versioned preferences parsing.
- `src/context.ts` and `src/markdown.ts`: context trimming and sanitized rendering.

Workers dynamically import their inference runtimes, so opening Aether does not evaluate ONNX or fetch model weights. Vite PWA precaches only the small application shell; WASM runtimes and all models stay lazy.

## Browser support

Current desktop Chrome or Edge is recommended. WebGPU is feature-detected, not browser-sniffed, and production must be served over HTTPS. Current Firefox and Safari may work where WebGPU and the required model operations are available. If WebGPU is missing, Aether selects a smaller Qwen 2.5 model and clearly labels the slower CPU/WASM mode.

Mobile layouts are supported visually, including a 390×844 onboarding viewport, but larger-model inference is not promised on mobile hardware.

## Privacy, network, and offline behavior

- Model and optional-feature downloads contact Hugging Face.
- Prompts, generated text, microphone audio, generated speech, and attached images are processed locally.
- There is no account, server API, analytics, or telemetry.
- A first visit is not fully offline: both the shell and selected model must finish caching.
- A cached model can generate without network requests. The service worker does not intercept model downloads; Transformers.js owns that cache.
- Storage is browser-managed and may be evicted unless persistence is granted. Settings shows usage and lets the user remove the selected model.

Microphone access is requested only after the microphone button is pressed. Images are restricted to PNG, JPEG, or WebP under 8 MB. LFM2.5 Audio is a large optional download and is unavailable in WASM fallback mode.

## Deployment

Run `npm run build`, then serve `dist/` from any static host with HTTPS and SPA fallback to `index.html`. Do not add a server-side inference proxy: this project’s privacy contract is browser-only execution.

## Troubleshooting

- **WebGPU unavailable:** update the browser/GPU driver, verify HTTPS, or use the WASM fallback.
- **Not enough storage:** free at least the displayed model size plus 25%, then retry.
- **Download interrupted:** reconnect and use Retry setup; cached files can be reused by the browser.
- **Offline startup fails:** reconnect once so both the PWA shell and selected model can finish caching.
- **Model runs slowly:** close GPU-heavy tabs, select the smaller fallback, or use a WebGPU-capable desktop browser.
- **Model cache disappeared:** browser eviction can occur when persistent storage was denied; download it again.

## Dependency audit note

`npm audit` currently reports high advisories inherited from Transformers.js through `onnxruntime-node`/`adm-zip` and Node-only `sharp`; upstream currently offers no complete fix. The production browser build selects `onnxruntime-web`. Its generated compatibility map contains ignored placeholders for the Node adapters, but no callable Node implementation, ZIP parser, or libvips binary. The browser-reachable `protobufjs` advisory is overridden to fixed 7.6.5. Re-check this exception whenever Transformers.js or Liquid's browser-audio adapter is upgraded.

## Real-hardware smoke test

Run this opt-in checklist on each target browser/device:

1. Clear site storage and confirm the landing page fetches no model or inference runtime.
2. Complete all three slides and download exactly one text model.
3. Generate one answer, then verify a second answer creates no network requests.
4. Reload offline and generate from the cached model.
5. Invoke image reasoning and audio separately; confirm each optional model is absent until invoked and the previous media runtime is disposed when switching.
6. Remove the selected model in Settings and confirm offline setup reports it missing.
7. Repeat with WebGPU disabled to validate the WASM fallback.

The automated real-model probes are opt-in because they download large models:

```bash
AETHER_REAL_HARDWARE=1 AETHER_TEST_IMAGE=/absolute/image.png npm run test:e2e -- --grep "real LFM2.5 vision" --project desktop-chrome
AETHER_REAL_HARDWARE=1 AETHER_TEST_AUDIO=/absolute/speech.wav npm run test:e2e -- --grep "real LFM2.5 audio" --project desktop-chrome
```
