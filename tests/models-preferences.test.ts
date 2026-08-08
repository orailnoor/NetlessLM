import { describe, expect, it } from 'vitest';
import { modelSupportsBackend, recommendedModel, TEXT_MODELS } from '../src/models';
import { defaultPreferences, parsePreferences } from '../src/preferences';

describe('model selection and preferences', () => {
  it('selects one verified default per backend', () => {
    expect(recommendedModel('webgpu').id).toBe('onnx-community/Qwen3-0.6B-ONNX');
    expect(recommendedModel('wasm').id).toBe('onnx-community/Qwen2.5-0.5B-Instruct');
    expect(TEXT_MODELS.every((model) => model.revision.length === 40)).toBe(true);
    expect(modelSupportsBackend(recommendedModel('wasm'), 'wasm')).toBe(true);
    expect(modelSupportsBackend(recommendedModel('webgpu'), 'wasm')).toBe(false);
  });

  it('migrates malformed or old preferences to safe defaults', () => {
    expect(parsePreferences('{bad json', 'wasm')).toEqual(defaultPreferences('wasm'));
    expect(parsePreferences(JSON.stringify({ version: 0, onboardingComplete: true }), 'webgpu'))
      .toEqual(defaultPreferences('webgpu'));
  });

  it('keeps only validated preference values', () => {
    const parsed = parsePreferences(JSON.stringify({
      version: 1,
      onboardingComplete: true,
      backend: 'invalid',
      selectedModelId: recommendedModel('wasm').id,
      speakResponses: 'yes'
    }), 'wasm');
    expect(parsed.onboardingComplete).toBe(true);
    expect(parsed.backend).toBe('wasm');
    expect(parsed.speakResponses).toBe(false);
  });
});
