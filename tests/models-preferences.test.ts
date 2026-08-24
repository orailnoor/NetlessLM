import { describe, expect, it } from 'vitest';
import { MODEL_CATALOG, modelsForMode, recommendedModel } from '../src/models';
import { defaultPreferences, parsePreferences } from '../src/preferences';

describe('three-mode model selection and preferences', () => {
  it('exposes only pinned LFM models for text, vision, and audio', () => {
    expect(modelsForMode('text')).toHaveLength(3);
    expect(modelsForMode('vision')).toHaveLength(1);

    expect(MODEL_CATALOG.every((model) => model.name.startsWith('LFM 2.5'))).toBe(true);
    expect(MODEL_CATALOG.every((model) => model.revision.length === 40)).toBe(true);
    expect(recommendedModel('text').id).toContain('LFM2.5-1.2B');
    expect(modelsForMode('text').find((model) => model.supportsThinking)?.id).toContain('Thinking');
    expect(modelsForMode('vision').every((model) => model.browserVerified !== false)).toBe(true);
  });

  it('falls back safely for malformed preferences', () => {
    expect(parsePreferences('{bad json')).toEqual(defaultPreferences());
    expect(parsePreferences(JSON.stringify({ version: 0 }))).toEqual(defaultPreferences());
  });

  it('migrates onboarding state from version one without retaining old models', () => {
    const parsed = parsePreferences(null, JSON.stringify({ version: 1, onboardingComplete: true, compactSidebar: true }));
    expect(parsed.version).toBe(2);
    expect(parsed.onboardingComplete).toBe(true);
    expect(parsed.compactSidebar).toBe(true);
    expect(parsed.selectedModelByMode.vision).toBe(recommendedModel('vision').id);
  });

  it('replaces hidden or wrong-mode selections with the verified default', () => {
    const parsed = parsePreferences(JSON.stringify({
      ...defaultPreferences(),
      selectedModelByMode: {
        ...defaultPreferences().selectedModelByMode,
        vision: 'LiquidAI/LFM2.5-VL-1.6B-ONNX'
      }
    }));
    expect(parsed.selectedModelByMode.vision).toBe('LiquidAI/LFM2.5-VL-450M-ONNX');
  });
});
