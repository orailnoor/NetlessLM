export interface ThinkingOutput {
  answer: string;
  reasoning: string;
  thinkingComplete: boolean;
}

export function splitThinkingOutput(text: string): ThinkingOutput {
  const opening = text.search(/<think>/i);
  if (opening < 0) {
    return {
      answer: text.replace(/<\/think>/gi, '').trimStart(),
      reasoning: '',
      thinkingComplete: true
    };
  }

  const reasoningStart = opening + text.slice(opening).match(/^<think>/i)![0].length;
  const remainder = text.slice(reasoningStart);
  const closing = remainder.search(/<\/think>/i);
  if (closing < 0) {
    return { answer: '', reasoning: remainder.trimStart(), thinkingComplete: false };
  }

  const closingTag = remainder.slice(closing).match(/^<\/think>/i)![0];
  return {
    answer: remainder.slice(closing + closingTag.length).trimStart(),
    reasoning: remainder.slice(0, closing).trim(),
    thinkingComplete: true
  };
}
