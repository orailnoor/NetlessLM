import type { ModelDescriptor, StorageSnapshot } from './types';

export const STORAGE_SAFETY_MULTIPLIER = 1.25;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index < 2 ? 0 : 1)} ${units[index]}`;
}

export function hasStorageCapacity(snapshot: StorageSnapshot, model: ModelDescriptor): boolean {
  if (!snapshot.quota) return true;
  return snapshot.available >= model.downloadBytes * STORAGE_SAFETY_MULTIPLIER;
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

function modelUrlMatches(url: string, model: ModelDescriptor): boolean {
  return url.includes(model.id) || url.includes(encodeURIComponent(model.id));
}

export async function isModelCached(model: ModelDescriptor): Promise<boolean> {
  if (!('caches' in globalThis)) return false;
  const matchedUrls: string[] = [];
  for (const cacheName of await caches.keys()) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    matchedUrls.push(...keys.map((request) => request.url).filter((url) => modelUrlMatches(url, model)));
  }
  const hasConfig = matchedUrls.some((url) => /(?:config|generation_config)\.json(?:\?|$)/i.test(url));
  const hasTokenizer = matchedUrls.some((url) => /tokenizer(?:_config)?\.json(?:\?|$)/i.test(url));
  const hasWeights = matchedUrls.some((url) => /\.onnx(?:_data)?(?:\?|$)/i.test(url));
  return hasConfig && hasTokenizer && hasWeights;
}

export async function removeModelFromCache(model: ModelDescriptor): Promise<number> {
  if (!('caches' in globalThis)) return 0;
  let removed = 0;
  for (const cacheName of await caches.keys()) {
    const cache = await caches.open(cacheName);
    for (const request of await cache.keys()) {
      if (modelUrlMatches(request.url, model) && await cache.delete(request)) removed += 1;
    }
  }
  return removed;
}

export async function removeStaleModelCache(model: ModelDescriptor): Promise<number> {
  if (!('caches' in globalThis)) return 0;
  let removed = 0;
  for (const cacheName of await caches.keys()) {
    const cache = await caches.open(cacheName);
    for (const request of await cache.keys()) {
      if (
        modelUrlMatches(request.url, model)
        && !request.url.includes(model.revision)
        && await cache.delete(request)
      ) {
        removed += 1;
      }
    }
  }
  return removed;
}

export async function removeCachedModelId(modelId: string): Promise<number> {
  if (!('caches' in globalThis)) return 0;
  let removed = 0;
  for (const cacheName of await caches.keys()) {
    const cache = await caches.open(cacheName);
    for (const request of await cache.keys()) {
      if (
        (request.url.includes(modelId) || request.url.includes(encodeURIComponent(modelId)))
        && await cache.delete(request)
      ) {
        removed += 1;
      }
    }
  }
  return removed;
}
