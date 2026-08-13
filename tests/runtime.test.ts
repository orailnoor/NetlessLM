import { describe, expect, it, vi } from 'vitest';
import { trimConversation } from '../src/context';
import { MockTextEngine } from '../src/engine-client';
import { RuntimeStateMachine } from '../src/state-machine';
import type { ChatMessage } from '../src/types';

describe('runtime behavior', () => {
  it('enforces recoverable state transitions', () => {
    const machine = new RuntimeStateMachine();
    machine.transition('onboarding');
    machine.transition('preflight');
    machine.transition('downloading');
    machine.transition('warming');
    machine.transition('ready');
    machine.transition('generating');
    machine.transition('ready');
    expect(machine.state).toBe('ready');
    expect(() => machine.transition('boot')).toThrow('Invalid runtime transition');
  });

  it('preserves the system prompt and newest turns when trimming', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'old '.repeat(100) },
      { role: 'assistant', content: 'older '.repeat(100) },
      { role: 'user', content: 'newest question' }
    ];
    const result = trimConversation(messages, 200, 0.75);
    expect(result.trimmed).toBe(true);
    expect(result.messages[0]?.role).toBe('system');
    expect(result.messages.at(-1)?.content).toBe('newest question');
  });

  it('cancels an in-flight generation cleanly', async () => {
    const engine = new MockTextEngine();
    const generated = engine.generate([{ role: 'user', content: 'long prompt' }], 100, false, vi.fn());
    await new Promise((resolve) => setTimeout(resolve, 25));
    engine.cancel();
    const result = await generated;
    expect(result.cancelled).toBe(true);
    expect(result.tokenCount).toBeLessThan(10);
  });

  it('returns reasoning separately when thinking is enabled', async () => {
    const engine = new MockTextEngine();
    const result = await engine.generate([{ role: 'user', content: 'reason carefully' }], 100, true, vi.fn());
    expect(result.reasoning).toContain('identify the request');
    expect(result.text).not.toContain(result.reasoning);
  });
});
