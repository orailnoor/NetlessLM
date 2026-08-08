export interface FileProgress {
  loaded: number;
  total: number;
}

export function calculateProgress(files: Iterable<FileProgress>, fallback = 0): FileProgress & { percent: number } {
  const entries = [...files];
  const loaded = entries.reduce((sum, item) => sum + Math.max(0, item.loaded), 0);
  const total = entries.reduce((sum, item) => sum + Math.max(0, item.total), 0);
  const percent = total > 0
    ? Math.round((loaded / total) * 100)
    : Math.round(fallback);
  return { loaded, total, percent: Math.max(0, Math.min(100, percent)) };
}

export class DownloadProgressTracker {
  readonly #files = new Map<string, FileProgress>();
  readonly #expectedTotal: number;
  #lastPercent = 0;

  constructor(expectedTotal: number) {
    this.#expectedTotal = Math.max(0, expectedTotal);
  }

  update(
    file: string,
    loaded: number,
    total: number,
    fallbackPercent = 0,
    complete = false
  ): FileProgress & { percent: number } {
    if (loaded > 0 || total > 0 || !this.#files.has(file)) {
      this.#files.set(file, { loaded, total });
    }
    const observed = calculateProgress(this.#files.values(), fallbackPercent);
    const expectedTotal = Math.max(this.#expectedTotal, observed.total);
    const calculated = expectedTotal > 0
      ? Math.round((observed.loaded / expectedTotal) * 100)
      : observed.percent;
    const nextPercent = complete ? 100 : Math.min(99, calculated);
    this.#lastPercent = Math.max(this.#lastPercent, nextPercent);
    return {
      loaded: complete ? expectedTotal : Math.min(observed.loaded, expectedTotal),
      total: expectedTotal,
      percent: this.#lastPercent
    };
  }
}
