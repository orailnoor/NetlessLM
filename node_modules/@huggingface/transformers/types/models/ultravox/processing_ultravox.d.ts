/**
 * Represents a UltravoxProcessor that extracts features from an audio input.
 */
export class UltravoxProcessor extends Processor {
    static tokenizer_class: typeof AutoTokenizer;
    static feature_extractor_class: typeof AutoFeatureExtractor;
    /**
     * @param {string} text The text input to process.
     * @param {Float32Array} audio The audio input to process.
     */
    _call(text: string, audio?: Float32Array, kwargs?: {}): Promise<{
        audio_token_len: number[];
        audio_values: any;
        /**
         * List of token ids to be fed to a model.
         */
        input_ids: import("../../transformers.js").Tensor;
        /**
         * List of indices specifying which tokens should be attended to by the model.
         */
        attention_mask: import("../../transformers.js").Tensor;
        /**
         * List of token type ids to be fed to a model.
         */
        token_type_ids?: import("../../transformers.js").Tensor;
    }>;
}
import { Processor } from '../../processing_utils.js';
import { AutoTokenizer } from '../auto/tokenization_auto.js';
import { AutoFeatureExtractor } from '../auto/feature_extraction_auto.js';
//# sourceMappingURL=processing_ultravox.d.ts.map