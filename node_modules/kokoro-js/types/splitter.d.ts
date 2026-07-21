/**
 * Splits the input text into an array of sentences.
 * @param {string} text The text to split.
 * @returns {string[]} An array of sentences.
 */
export function split(text: string): string[];
/**
 * A simple stream-based text splitter that emits complete sentences.
 */
export class TextSplitterStream {
    _buffer: string;
    _sentences: any[];
    _resolver: (value: any) => void;
    _closed: boolean;
    /**
     * Push one or more text chunks into the stream.
     * @param  {...string} texts Text fragments to process.
     */
    push(...texts: string[]): void;
    /**
     * Closes the stream, signaling that no more text will be pushed.
     * This will flush any remaining text in the buffer as a sentence
     * and allow the consuming process to finish processing the stream.
     */
    close(): void;
    /**
     * Flushes any remaining text in the buffer as a sentence.
     */
    flush(): void;
    /**
     * Resolve the pending promise to signal that sentences are available.
     * @private
     */
    private _resolve;
    /**
     * Processes the internal buffer to extract complete sentences.
     * If the potential sentence boundary is at the end of the current buffer,
     * it waits for more text before splitting.
     * @private
     */
    private _process;
    /**
     * Returns the array of sentences currently available.
     * @type {string[]} The array of sentences.
     * @readonly
     */
    readonly get sentences(): string[];
    /**
     * Async iterator to yield sentences as they become available.
     * @returns {AsyncGenerator<string, void, void>}
     */
    [Symbol.asyncIterator](): AsyncGenerator<string, void, void>;
    /**
     * Synchronous iterator that flushes the buffer and returns all sentences.
     * @returns {Iterator<string>}
     */
    [Symbol.iterator](): Iterator<string>;
}
//# sourceMappingURL=splitter.d.ts.map