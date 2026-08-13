declare module 'lfm2-audio-webgpu-demo/audio-model.js' {
  export class AudioModel {
    load(path: string, options: Record<string, unknown>): Promise<void>;
    transcribe(audio: Float32Array, sampleRate: number, options?: Record<string, unknown>): Promise<string>;
    generateSpeech(text: string, options?: Record<string, unknown>): Promise<{ audioCodes: number[][] }>;
    generateInterleaved(audio: Float32Array, sampleRate: number, prompt?: string, options?: Record<string, unknown>): Promise<{ text?: string; audioCodes?: number[][] }>;
    decodeAudioCodes(codes: number[][]): Promise<Float32Array>;
    dispose(): void;
  }
}
