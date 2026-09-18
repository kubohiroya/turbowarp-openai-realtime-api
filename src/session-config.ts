export type OutputMode = 'audio' | 'text';

export interface FunctionTool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Request body sent to the relay's client-secret route (see capability-proxy). */
export interface RealtimeSessionRequest {
  instructions?: string;
  voice?: string;
  outputModalities?: [OutputMode];
  tools?: FunctionTool[];
}

export interface SessionSettings {
  instructions: string;
  voice: string;
  outputMode: OutputMode;
}

export const MAX_INSTRUCTIONS_LENGTH = 16384;
export const MAX_TOOLS = 32;
const VOICE_PATTERN = /^[a-z0-9_-]{1,32}$/u;

export function defaultSessionSettings(): SessionSettings {
  return {instructions: '', voice: 'marin', outputMode: 'audio'};
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
  if (settings.instructions.length > 0) request.instructions = settings.instructions;
  if (tools.length > 0) request.tools = tools.map((tool) => ({...tool}));
  return request;
}
