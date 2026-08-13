import { describe, expect, it } from 'vitest';
import { splitThinkingOutput } from '../src/thinking';

describe('thinking output parsing', () => {
  it('keeps an unfinished reasoning stream separate from the answer', () => {
    expect(splitThinkingOutput('<think>Checking the numbers')).toEqual({
      answer: '', reasoning: 'Checking the numbers', thinkingComplete: false
    });
  });

  it('separates completed reasoning from the final answer', () => {
    expect(splitThinkingOutput('<think>Checking the numbers</think>The answer is 42.')).toEqual({
      answer: 'The answer is 42.', reasoning: 'Checking the numbers', thinkingComplete: true
    });
  });

  it('passes through normal model output', () => {
    expect(splitThinkingOutput('A normal answer.')).toEqual({
      answer: 'A normal answer.', reasoning: '', thinkingComplete: true
    });
  });
});
