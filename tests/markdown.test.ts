// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/markdown';

describe('safe Markdown', () => {
  it('keeps useful formatting and strips executable markup', () => {
    const html = renderMarkdown('**safe** <img src=x onerror="alert(1)"><script>alert(1)</script>');
    expect(html).toContain('<strong>safe</strong>');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<script');
  });
});
