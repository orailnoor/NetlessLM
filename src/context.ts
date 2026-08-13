import type { ChatMessage } from './types';

export interface TrimResult {
  messages: ChatMessage[];
  trimmed: boolean;
  estimatedTokens: number;
}

export function estimateTokens(messages: readonly ChatMessage[]): number {
  return Math.ceil(messages.reduce((total, message) => total + message.content.length + 16, 0) / 4);
}

export function trimConversation(
  messages: readonly ChatMessage[],
  contextTokens: number,
  limitRatio = 0.75
): TrimResult {
  const budget = Math.floor(contextTokens * limitRatio);
  const system = messages.find((message) => message.role === 'system');
  const nonSystem = messages.filter((message) => message.role !== 'system');
  const selected: ChatMessage[] = [];
  let used = system ? estimateTokens([system]) : 0;

  for (let index = nonSystem.length - 1; index >= 0; index -= 1) {
    const message = nonSystem[index];
    if (!message) continue;
    const cost = estimateTokens([message]);
    if (used + cost > budget && selected.length > 0) break;
    selected.unshift(message);
    used += cost;
  }

  const result = system ? [system, ...selected] : selected;
  return {
    messages: result,
    trimmed: result.length < messages.length,
    estimatedTokens: used
  };
}
