import { modelsForMode, recommendedModel } from './models';
import type { AppMode, AppPreferencesV2 } from './types';

export const PREFERENCES_KEY = 'aether.preferences.v2';
const LEGACY_KEY = 'aether.preferences.v1';
const MODES: AppMode[] = ['text', 'vision', 'audio'];

export function defaultPreferences(): AppPreferencesV2 {
  return {
    version: 2,
    onboardingComplete: false,
    activeMode: 'text',
    selectedModelByMode: {
      text: recommendedModel('text').id,
      vision: recommendedModel('vision').id,
      audio: recommendedModel('audio').id
    },
    compactSidebar: false
  };
}

export function parsePreferences(value: string | null, legacyValue: string | null = null): AppPreferencesV2 {
  const defaults = defaultPreferences();
  try {
    if (value) {
      const parsed = JSON.parse(value) as Partial<AppPreferencesV2>;
      if (parsed.version === 2) {
        const selections = { ...defaults.selectedModelByMode };
        for (const mode of MODES) {
          const candidate = parsed.selectedModelByMode?.[mode];
          if (typeof candidate === 'string' && modelsForMode(mode).some((model) => model.id === candidate)) selections[mode] = candidate;
        }
        return {
          ...defaults,
          version: 2,
          onboardingComplete: parsed.onboardingComplete === true,
          activeMode: MODES.includes(parsed.activeMode as AppMode) ? parsed.activeMode as AppMode : 'text',
          selectedModelByMode: selections,
          compactSidebar: parsed.compactSidebar === true
        };
      }
    }
    if (legacyValue) {
      const legacy = JSON.parse(legacyValue) as { onboardingComplete?: boolean; compactSidebar?: boolean };
      return {
        ...defaults,
        onboardingComplete: legacy.onboardingComplete === true,
        compactSidebar: legacy.compactSidebar === true
      };
    }
  } catch {
    return defaults;
  }
  return defaults;
}

export function loadPreferences(): AppPreferencesV2 {
  const preferences = parsePreferences(
    globalThis.localStorage?.getItem(PREFERENCES_KEY) ?? null,
    globalThis.localStorage?.getItem(LEGACY_KEY) ?? null
  );
  savePreferences(preferences);
  globalThis.localStorage?.removeItem(LEGACY_KEY);
  return preferences;
}

export function savePreferences(preferences: AppPreferencesV2): void {
  globalThis.localStorage?.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}
