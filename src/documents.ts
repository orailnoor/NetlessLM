import type { DocumentChunk } from './types';

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const SUPPORTED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'wav', 'mp3', 'm4a', 'webm', 'txt', 'md', 'csv', 'json', 'html', 'htm', 'docx', 'pdf'];

export function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

export function validateAttachment(file: File, existingCount: number): string | null {
  if (existingCount >= MAX_ATTACHMENTS) return `A conversation can contain up to ${MAX_ATTACHMENTS} attachments.`;
  if (file.size > MAX_ATTACHMENT_BYTES) return 'Attachments must be 10 MB or smaller.';
  if (!SUPPORTED_EXTENSIONS.includes(extensionOf(file.name))) return 'This file type is not supported.';
  return null;
}

export function chunkDocument(text: string, chunkSize = 1_200, overlap = 150): DocumentChunk[] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) return [];
  const chunks: DocumentChunk[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(normalized.length, start + chunkSize);
    if (end < normalized.length) {
      const boundary = Math.max(normalized.lastIndexOf('\n', end), normalized.lastIndexOf(' ', end));
      if (boundary > start + Math.floor(chunkSize * 0.6)) end = boundary;
    }
    chunks.push({ text: normalized.slice(start, end).trim(), index: chunks.length });
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

function queryTerms(query: string): Set<string> {
  return new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
}

export function selectRelevantChunks(chunks: readonly DocumentChunk[], query: string, maxCharacters: number): DocumentChunk[] {
  if (!chunks.length || maxCharacters <= 0) return [];
  const terms = queryTerms(query);
  const scored = chunks.map((chunk) => {
    const lower = chunk.text.toLowerCase();
    let score = chunk.index === 0 ? 0.25 : 0;
    for (const term of terms) if (lower.includes(term)) score += 1;
    return { chunk, score };
  }).sort((left, right) => right.score - left.score || left.chunk.index - right.chunk.index);
  const selected: DocumentChunk[] = [];
  let used = 0;
  for (const item of scored) {
    if (used + item.chunk.text.length > maxCharacters && selected.length) continue;
    selected.push(item.chunk);
    used += item.chunk.text.length;
    if (used >= maxCharacters) break;
  }
  return selected.sort((left, right) => left.index - right.index);
}

export async function extractDocument(file: File): Promise<{ text: string; chunks: DocumentChunk[]; pageCount?: number }> {
  const extension = extensionOf(file.name);
  let text: string;
  let pageCount: number | undefined;
  if (extension === 'pdf') {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useWorkerFetch: false, isEvalSupported: false }).promise;
    pageCount = document.numPages;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 100); pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '));
    }
    text = pages.join('\n\n');
  } else if (extension === 'docx') {
    const mammoth = await import('mammoth/mammoth.browser');
    text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  } else if (extension === 'html' || extension === 'htm') {
    const parsed = new DOMParser().parseFromString(await file.text(), 'text/html');
    text = parsed.body.textContent ?? '';
  } else {
    text = await file.text();
  }
  text = [...text.normalize('NFKC')].map((character) => {
    const code = character.codePointAt(0) ?? 0;
    if (character === '\uFFFD') return '';
    return code === 9 || code === 10 || code === 13 || code >= 32 ? character : ' ';
  }).join('');
  if (!text.trim()) throw new Error('No extractable text was found. Scanned PDFs are not supported.');
  return { text, chunks: chunkDocument(text), pageCount };
}
