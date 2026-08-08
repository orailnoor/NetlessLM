import { afterEach, describe, expect, it, vi } from 'vitest';
import { recommendedModel } from '../src/models';
import { calculateProgress, DownloadProgressTracker } from '../src/progress';
import { formatBytes, hasStorageCapacity, isModelCached, removeModelFromCache, removeStaleModelCache } from '../src/storage';

afterEach(() => vi.unstubAllGlobals());

describe('storage, cache, and progress', () => {
  it('requires model bytes plus the 25 percent safety margin', () => {
    const model = recommendedModel('wasm');
    expect(hasStorageCapacity({ usage: 0, quota: 1, available: model.downloadBytes * 1.24, persisted: false }, model)).toBe(false);
    expect(hasStorageCapacity({ usage: 0, quota: 1, available: model.downloadBytes * 1.25, persisted: false }, model)).toBe(true);
    expect(formatBytes(570_000_000)).toMatch(/MB/);
  });

  it('aggregates multi-file download progress', () => {
    expect(calculateProgress([{ loaded: 25, total: 100 }, { loaded: 50, total: 100 }])).toEqual({
      loaded: 75,
      total: 200,
      percent: 38
    });
    expect(calculateProgress([], 130).percent).toBe(100);
  });

  it('keeps overall progress stable when new model files appear', () => {
    const tracker = new DownloadProgressTracker(1_000);
    expect(tracker.update('encoder.onnx', 200, 300).percent).toBe(20);
    expect(tracker.update('decoder.onnx', 10, 700).percent).toBe(21);
    expect(tracker.update('decoder.onnx', 300, 700).percent).toBe(50);
    expect(tracker.update('config.json', 1, 1, 100, true)).toEqual({ loaded: 1_001, total: 1_001, percent: 100 });
  });

  it('does not complete when only one file finishes', () => {
    const tracker = new DownloadProgressTracker(1_000);
    expect(tracker.update('encoder.onnx', 400, 400, 100, false).percent).toBe(40);
    expect(tracker.update('decoder.onnx', 100, 600, 17, false).percent).toBe(50);
    expect(tracker.update('pipeline', 0, 0, 100, true)).toEqual({ loaded: 1_000, total: 1_000, percent: 100 });
  });

  it('detects and removes selected model cache entries only', async () => {
    const model = recommendedModel('wasm');
    const matching = new Request(`https://huggingface.co/${model.id}/resolve/${model.revision}/model.onnx`);
    const config = new Request(`https://huggingface.co/${model.id}/resolve/${model.revision}/config.json`);
    const tokenizer = new Request(`https://huggingface.co/${model.id}/resolve/${model.revision}/tokenizer.json`);
    const unrelated = new Request('https://example.test/shell.js');
    const deleteEntry = vi.fn(async (request: Request) => request.url === matching.url);
    const cache = { keys: vi.fn(async () => [matching, config, tokenizer, unrelated]), delete: deleteEntry };
    vi.stubGlobal('caches', { keys: vi.fn(async () => ['transformers-cache']), open: vi.fn(async () => cache) });
    expect(await isModelCached(model)).toBe(true);
    expect(await removeModelFromCache(model)).toBe(1);
    expect(deleteEntry).toHaveBeenCalledTimes(3);
  });

  it('removes obsolete revisions without deleting current model files', async () => {
    const model = recommendedModel('wasm');
    const current = new Request(`https://huggingface.co/${model.id}/resolve/${model.revision}/model.onnx`);
    const stale = new Request(`https://huggingface.co/${model.id}/resolve/old-revision/model.onnx`);
    const deleteEntry = vi.fn(async (request: Request) => request.url === stale.url);
    const cache = { keys: vi.fn(async () => [current, stale]), delete: deleteEntry };
    vi.stubGlobal('caches', { keys: vi.fn(async () => ['transformers-cache']), open: vi.fn(async () => cache) });
    expect(await removeStaleModelCache(model)).toBe(1);
    expect(deleteEntry).toHaveBeenCalledOnce();
    expect(deleteEntry).toHaveBeenCalledWith(stale);
  });
});
