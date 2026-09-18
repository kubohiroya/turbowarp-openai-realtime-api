import type { FunctionTool } from '@kubohiroya/turbowarp-named-functions/composition';
export type OutputMode = 'audio' | 'text';
/** Request body sent to the relay's client-secret route (see capability-proxy). */
export interface RealtimeSessionRequest {
    model?: string;
    instructions?: string;
    voice?: string;
    outputModalities?: [OutputMode];
    tools?: FunctionTool[];
}
export interface SessionSettings {
    /** Empty means the relay's default model. */
    model: string;
    instructions: string;
    voice: string;
    outputMode: OutputMode;
}
export declare const MAX_INSTRUCTIONS_LENGTH = 16384;
export declare const MAX_TOOLS = 32;
export declare const SUPPORTED_MODELS: readonly ["gpt-realtime-2.1-mini", "gpt-realtime-2.1"];
export declare function defaultSessionSettings(): SessionSettings;
/** Accepts an empty string (relay default) or a model identifier; the relay decides what is allowed. */
export declare function normalizeModel(value: string): string;
export declare function normalizeVoice(value: string): string;
export declare function normalizeInstructions(value: string): string;
export declare function normalizeOutputMode(value: string): OutputMode;
export declare function buildSessionRequest(settings: SessionSettings, tools: readonly FunctionTool[]): RealtimeSessionRequest;
