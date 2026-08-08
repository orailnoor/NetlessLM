// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { chunkDocument, extractDocument, selectRelevantChunks, validateAttachment } from '../src/documents';

describe('local document handling', () => {
  it('validates count, size, and supported extensions', () => {
    expect(validateAttachment(new File(['hello'], 'notes.txt'), 0)).toBeNull();
    expect(validateAttachment(new File(['hello'], 'tool.exe'), 0)).toMatch(/not supported/i);
    expect(validateAttachment(new File(['hello'], 'notes.txt'), 5)).toMatch(/up to 5/i);
  });

  it('chunks and ranks relevant document text without embeddings', () => {
    const chunks = chunkDocument(`${'introduction '.repeat(120)}\n${'invoice total payment '.repeat(120)}`, 400, 40);
    const selected = selectRelevantChunks(chunks, 'What is the invoice payment total?', 500);
    expect(chunks.length).toBeGreaterThan(2);
    expect(selected.map((chunk) => chunk.text).join(' ')).toContain('invoice total payment');
  });

  it('removes invalid replacement and control characters from extracted text', async () => {
    const result = await extractDocument(new File(['स्वास्थ्य\uFFFD रिपोर्ट\u0000 ठीक है'], 'report.txt', { type: 'text/plain' }));
    expect(result.text).toBe('स्वास्थ्य रिपोर्ट  ठीक है');
    expect(result.text).not.toContain('\uFFFD');
  });
});
