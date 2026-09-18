/**
 * Token usage totals from `response.done` events and an estimated cost.
 *
 * Prices are USD per 1M tokens from the OpenAI pricing page as of 2026-09-18. They are an estimate
 * for learners; the OpenAI dashboard is the source of truth for billing.
 */
export interface ModelPrice {
    textInput: number;
    cachedTextInput: number;
    textOutput: number;
    audioInput: number;
    cachedAudioInput: number;
    audioOutput: number;
}
export declare const MODEL_PRICES: Readonly<Record<string, ModelPrice>>;
export declare const PRICES_AS_OF = "2026-09-18";
export interface UsageTotals {
    responses: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    textInputTokens: number;
    audioInputTokens: number;
    cachedTextInputTokens: number;
    cachedAudioInputTokens: number;
    textOutputTokens: number;
    audioOutputTokens: number;
    estimatedCostUsd: number;
    /** Responses whose model has no known price; their cost is not included. */
    unpricedResponses: number;
}
export declare function emptyUsage(): UsageTotals;
/** Adds one `response.usage` object to the totals. Unknown or malformed usage counts as zero tokens. */
export declare function addUsage(totals: UsageTotals, usage: unknown, model: string): UsageTotals;
