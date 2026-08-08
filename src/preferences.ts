import { recommendedModel } from './models';
import type { AppPreferencesV1, Backend } from './types';

export const PREFERENCES_KEY = 'aether.preferences.v1';

export function defaultPreferences(backend: Backend = 'wasm'): AppPreferencesV1 {
  return {
    version: 1,
    onboardingComplete: false,
    selectedModelId: recommendedModel(backend).id,
    backend,
    speakResponses: false,
    compactSidebar: false
  };
}

export function parsePreferences(value: string | null, backend: Backend): AppPreferencesV1 {
  if (!value) return defaultPreferences(backend);
  try {
    const parsed = JSON.parse(value) as Partial<AppPreferencesV1>;
    if (parsed.version !== 1) return defaultPreferences(backend);
    return {
      ...defaultPreferences(backend),
      ...parsed,
      version: 1,
      onboardingComplete: parsed.onboardingComplete === true,
      speakResponses: parsed.speakResponses === true,
      compactSidebar: parsed.compactSidebar === true,
      backend: parsed.backend === 'webgpu' || parsed.backend === 'wasm' ? parsed.backend : backend,
      selectedModelId: typeof parsed.selectedModelId === 'string'
        ? parsed.selectedModelId
        : recommendedModel(backend).id
    };
  } catch {
    return defaultPreferences(backend);
  }
}

export function loadPreferences(backend: Backend): AppPreferencesV1 {
  return parsePreferences(globalThis.localStorage?.getItem(PREFERENCES_KEY) ?? null, backend);
}

export function savePreferences(preferences: AppPreferencesV1): void {
  globalThis.localStorage?.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}
