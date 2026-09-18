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

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'gpt-realtime-2.1': {
    textInput: 4,
    cachedTextInput: 0.4,
    textOutput: 24,
    audioInput: 32,
    cachedAudioInput: 0.4,
    audioOutput: 64
  },
  'gpt-realtime-2.1-mini': {
    textInput: 0.6,
    cachedTextInput: 0.06,
    textOutput: 2.4,
    audioInput: 10,
    cachedAudioInput: 0.3,
    audioOutput: 20
  }
};

export const PRICES_AS_OF = '2026-09-18';

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

export function emptyUsage(): UsageTotals {
  return {
    responses: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    textInputTokens: 0,
    audioInputTokens: 0,
    cachedTextInputTokens: 0,
    cachedAudioInputTokens: 0,
    textOutputTokens: 0,
    audioOutputTokens: 0,
    estimatedCostUsd: 0,
    unpricedResponses: 0
  };
}

/** Adds one `response.usage` object to the totals. Unknown or malformed usage counts as zero tokens. */
export function addUsage(totals: UsageTotals, usage: unknown, model: string): UsageTotals {
  const root = asRecord(usage);
  if (!root) return totals;
  const input = asRecord(root.input_token_details);
  const output = asRecord(root.output_token_details);
  const cachedDetails = asRecord(input?.cached_tokens_details);

  const textInput = count(input?.text_tokens);
  const audioInput = count(input?.audio_tokens);
  const cached = count(input?.cached_tokens);
  // Without a breakdown, attribute cached tokens to text first: the instructions and tools prefix.
  const cachedText = cachedDetails ? count(cachedDetails.text_tokens) : Math.min(cached, textInput);
  const cachedAudio = cachedDetails ? count(cachedDetails.audio_tokens) : Math.max(0, cached - cachedText);
  const textOutput = count(output?.text_tokens);
  const audioOutput = count(output?.audio_tokens);

  const next: UsageTotals = {
    responses: totals.responses + 1,
    inputTokens: totals.inputTokens + count(root.input_tokens),
    outputTokens: totals.outputTokens + count(root.output_tokens),
    cachedInputTokens: totals.cachedInputTokens + cached,
    textInputTokens: totals.textInputTokens + textInput,
    audioInputTokens: totals.audioInputTokens + audioInput,
    cachedTextInputTokens: totals.cachedTextInputTokens + cachedText,
    cachedAudioInputTokens: totals.cachedAudioInputTokens + cachedAudio,
    textOutputTokens: totals.textOutputTokens + textOutput,
    audioOutputTokens: totals.audioOutputTokens + audioOutput,
    estimatedCostUsd: totals.estimatedCostUsd,
    unpricedResponses: totals.unpricedResponses
  };

  const price = MODEL_PRICES[model];
  if (!price) {
    next.unpricedResponses += 1;
    return next;
  }
  next.estimatedCostUsd +=
    (Math.max(0, textInput - cachedText) * price.textInput +
      cachedText * price.cachedTextInput +
      Math.max(0, audioInput - cachedAudio) * price.audioInput +
      cachedAudio * price.cachedAudioInput +
      textOutput * price.textOutput +
      audioOutput * price.audioOutput) /
    1_000_000;
  return next;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
