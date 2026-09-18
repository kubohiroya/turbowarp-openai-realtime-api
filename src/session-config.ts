import type {FunctionTool} from '@kubohiroya/turbowarp-named-functions/composition';

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

export const MAX_INSTRUCTIONS_LENGTH = 16384;
export const MAX_TOOLS = 32;
const VOICE_PATTERN = /^[a-z0-9_-]{1,32}$/u;
const MODEL_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;

export const SUPPORTED_MODELS = ['gpt-realtime-2.1-mini', 'gpt-realtime-2.1'] as const;

export function defaultSessionSettings(): SessionSettings {
  return {model: '', instructions: '', voice: 'marin', outputMode: 'audio'};
}

/** Accepts an empty string (relay default) or a model identifier; the relay decides what is allowed. */
export function normalizeModel(value: string): string {
  const model = value.trim();
  if (model.length > 0 && !MODEL_PATTERN.test(model)) throw new TypeError('Model must be a model identifier.');
  return model;
}

export function normalizeVoice(value: string): string {
  const voice = value.trim().toLowerCase();
  if (!VOICE_PATTERN.test(voice)) throw new TypeError('Voice must be a lowercase identifier.');
  return voice;
}

export function normalizeInstructions(value: string): string {
  if (value.length > MAX_INSTRUCTIONS_LENGTH) {
    throw new TypeError(`Instructions must be at most ${MAX_INSTRUCTIONS_LENGTH} characters.`);
  }
  return value;
}

export function normalizeOutputMode(value: string): OutputMode {
  if (value === 'audio' || value === 'text') return value;
  throw new TypeError('Output must be audio or text.');
}

export function buildSessionRequest(
  settings: SessionSettings,
  tools: readonly FunctionTool[]
): RealtimeSessionRequest {
  if (tools.length > MAX_TOOLS) throw new TypeError(`At most ${MAX_TOOLS} functions can be exported as tools.`);
  const request: RealtimeSessionRequest = {
    voice: settings.voice,
    outputModalities: [settings.outputMode]
  };
  if (settings.model.length > 0) request.model = settings.model;
  if (settings.instructions.length > 0) request.instructions = settings.instructions;
  if (tools.length > 0) request.tools = tools.map((tool) => ({...tool}));
  return request;
}
