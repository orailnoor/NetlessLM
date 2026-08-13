import type { Backend, StorageSnapshot } from './types';

type GPUCapableNavigator = Navigator & {
  gpu?: { requestAdapter(options?: { powerPreference?: 'low-power' | 'high-performance' }): Promise<unknown | null> };
};

export interface CapabilityReport {
  backend: Backend;
  webgpu: boolean;
  secureContext: boolean;
  online: boolean;
  storage: StorageSnapshot;
}

export async function detectWebGPU(): Promise<boolean> {
  if (import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('forceNoWebGPU') === '1') return false;
  const gpu = (navigator as GPUCapableNavigator).gpu;
  if (!gpu) return false;
  try {
    return Boolean(await gpu.requestAdapter({ powerPreference: 'high-performance' }));
  } catch {
    return false;
  }
}

export async function readStorageSnapshot(): Promise<StorageSnapshot> {
  const estimate: StorageEstimate = await navigator.storage?.estimate?.().catch(() => ({} as StorageEstimate)) ?? {};
  const persisted = await navigator.storage?.persisted?.().catch(() => false) ?? false;
  const usage = estimate.usage ?? 0;
  const quota = estimate.quota ?? 0;
  return { usage, quota, available: Math.max(0, quota - usage), persisted };
}

export async function detectCapabilities(): Promise<CapabilityReport> {
  const webgpu = await detectWebGPU();
  return {
    backend: webgpu ? 'webgpu' : 'wasm',
    webgpu,
    secureContext: globalThis.isSecureContext,
    online: navigator.onLine,
    storage: await readStorageSnapshot()
  };
}
