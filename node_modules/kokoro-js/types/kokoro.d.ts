/**
 * @typedef {Object} GenerateOptions
 * @property {keyof typeof VOICES} [voice="af_heart"] The voice
 * @property {number} [speed=1] The speaking speed
 */
/**
 * @typedef {Object} StreamProperties
 * @property {RegExp} [split_pattern] The pattern to split the input text. If unset, the default sentence splitter will be used.
 * @typedef {GenerateOptions & StreamProperties} StreamGenerateOptions
 */
export class KokoroTTS {
    /**
     * Load a KokoroTTS model from the Hugging Face Hub.
     * @param {string} model_id The model id
     * @param {Object} options Additional options
     * @param {"fp32"|"fp16"|"q8"|"q4"|"q4f16"} [options.dtype="fp32"] The data type to use.
     * @param {"wasm"|"webgpu"|"cpu"|null} [options.device=null] The device to run the model on.
     * @param {import("@huggingface/transformers").ProgressCallback} [options.progress_callback=null] A callback function that is called with progress information.
     * @returns {Promise<KokoroTTS>} The loaded model
     */
    static from_pretrained(model_id: string, { dtype, device, progress_callback }?: {
        dtype?: "fp32" | "fp16" | "q8" | "q4" | "q4f16";
        device?: "wasm" | "webgpu" | "cpu" | null;
        progress_callback?: import("@huggingface/transformers").ProgressCallback;
    }): Promise<KokoroTTS>;
    /**
     * Create a new KokoroTTS instance.
     * @param {import('@huggingface/transformers').StyleTextToSpeech2Model} model The model
     * @param {import('@huggingface/transformers').PreTrainedTokenizer} tokenizer The tokenizer
     */
    constructor(model: import("@huggingface/transformers").StyleTextToSpeech2Model, tokenizer: import("@huggingface/transformers").PreTrainedTokenizer);
    model: StyleTextToSpeech2Model;
    tokenizer: import("@huggingface/transformers").PreTrainedTokenizer;
    get voices(): Readonly<{
        af_heart: {
            name: string;
            language: string;
            gender: string;
            traits: string;
            targetQuality: string;
            overallGrade: string;
        };
        af_alloy: {
            name: string;
            language: string;
            gender: string;
            targetQuality: string;
            overallGrade: string;
        };
        af_aoede: {
            name: string;
            language: string;
            gender: string;
            targetQuality: string;
            overallGrade: string;
        };
        af_bella: {
            name: string;
            language: string;
            gender: string;
            traits: string;
            targetQuality: string;
            overallGrade: string;
        };
        af_jessica: {
            name: string;
            language: string;
            gender: string;
            targetQuality: string;
            overallGrade: string;
        };
        af_kore: {
            name: string;
            language: string;
            gender: string;
            targetQuality: string;
            overallGrade: string;
        };
        af_nicole: {
            name: string;
            language: string;
            gender: string;
            traits: string;
            targetQuality: string;
            overallGrade: string;
        };
        af_nova: {
            name: string;
            language: string;
            gender: string;
            targetQuality: string;
            overallGrade: string;
        };
        af_river: {
            name: string;
            language: string;
            gender: string;
            targetQuality: string;
            overallGrade: string;
        };
        af_sarah: {
            name: string;
            language: string;
            gender: string;
            targetQuality: string;
            overallGrade: string;
        };
        af_sky: {
            name: string;
            language: string;
            gender: string;
            targetQuality: string;
            overallGrade: string;
        };
        am_adam: {
            name: string;
            language: string;
            gender: string;
            targetQuality: string;
            overallGrade: string;
        };
        am_echo: {
            name: string;
            language: string;
            gender: string;
            targetQuality: string;
            overallGrade: string;
        };
        am_eric: {
            name: string;
            language: string;
            gender: string;
            targetQuality: string;
            overallGrade: string;
        };
        am_fenrir: {
            name: string;
            language: string;
            gender: string;
            targetQuality: string;
            overallGrade: string;
        };
        am_liam: {
            name: string;
            language: string;
            gender: string;
            targetQuality: string;
            overallGrade: string;
        };
        am_michael: {
            name: string;
            language: string;
            gender: string;
            targetQuality: string;
            overallGrade: string;
        };
        am_onyx: {
            name: string;
            language: string;
            gender: string;
            targetQuality: string;
            overallGrade: string;
        };
        am_puck: {
            name: string;
            language: string;
            gender: string;
            targetQuality: string;
            overallGrade: string;
        };
        am_santa: {
            name: string;
            language: string;
            gender: string;
            targetQuality: string;
            overallGrade: string;
        };
        bf_emma: {
            name: string;
            language: string;
            gender: string;
            traits: string;
            targetQuality: string;
            overallGrade: string;
        };
        bf_isabella: {
            name: string;
            language: string;
            gender: string;
            targetQuality: string;
            overallGrade: string;
        };
        bm_george: {
            name: string;
            language: string;
            gender: string;
            targetQuality: string;
            overallGrade: string;
        };
        bm_lewis: {
            name: string;
            language: string;
            gender: string;
            targetQuality: string;
            overallGrade: string;
        };
        bf_alice: {
            name: string;
            language: string;
            gender: string;
            traits: string;
            targetQuality: string;
            overallGrade: string;
        };
        bf_lily: {
            name: string;
            language: string;
            gender: string;
            traits: string;
            targetQuality: string;
            overallGrade: string;
        };
        bm_daniel: {
            name: string;
            language: string;
            gender: string;
            traits: string;
            targetQuality: string;
            overallGrade: string;
        };
        bm_fable: {
            name: string;
            language: string;
            gender: string;
            traits: string;
            targetQuality: string;
            overallGrade: string;
        };
    }>;
    list_voices(): void;
    _validate_voice(voice: any): "b" | "a";
    /**
     * Generate audio from text.
     *
     * @param {string} text The input text
     * @param {GenerateOptions} options Additional options
     * @returns {Promise<RawAudio>} The generated audio
     */
    generate(text: string, { voice, speed }?: GenerateOptions): Promise<RawAudio>;
    /**
     * Generate audio from input ids.
     * @param {Tensor} input_ids The input ids
     * @param {GenerateOptions} options Additional options
     * @returns {Promise<RawAudio>} The generated audio
     */
    generate_from_ids(input_ids: Tensor, { voice, speed }?: GenerateOptions): Promise<RawAudio>;
    /**
     * Generate audio from text in a streaming fashion.
     * @param {string|TextSplitterStream} text The input text
     * @param {StreamGenerateOptions} options Additional options
     * @returns {AsyncGenerator<{text: string, phonemes: string, audio: RawAudio}, void, void>}
     */
    stream(text: string | TextSplitterStream, { voice, speed, split_pattern }?: StreamGenerateOptions): AsyncGenerator<{
        text: string;
        phonemes: string;
        audio: RawAudio;
    }, void, void>;
}
export namespace env {
    let wasmPaths: import("onnxruntime-common").Env.WasmPrefixOrFilePaths;
}
export { TextSplitterStream };
export type GenerateOptions = {
    /**
     * The voice
     */
    voice?: keyof typeof VOICES;
    /**
     * The speaking speed
     */
    speed?: number;
};
export type StreamProperties = {
    /**
     * The pattern to split the input text. If unset, the default sentence splitter will be used.
     */
    split_pattern?: RegExp;
};
export type StreamGenerateOptions = GenerateOptions & StreamProperties;
import { StyleTextToSpeech2Model } from "@huggingface/transformers";
import { RawAudio } from "@huggingface/transformers";
import { Tensor } from "@huggingface/transformers";
import { TextSplitterStream } from "./splitter.js";
import { VOICES } from "./voices.js";
//# sourceMappingURL=kokoro.d.ts.map