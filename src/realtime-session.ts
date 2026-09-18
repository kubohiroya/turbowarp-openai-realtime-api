import type {RealtimeEvent, RealtimeTransport} from './transport.js';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'failed';

export interface FunctionCall {
  callId: string;
  name: string;
  argumentsJson: string;
}

export interface RealtimeSessionHooks {
  /** Runs a function exported as a tool and resolves with its return value. */
  callFunction: (name: string, args: unknown) => Promise<unknown>;
  onResponseText: (text: string) => void;
  onError: (message: string) => void;
  onStateChange?: (state: ConnectionState) => void;
}

/**
 * Conversation logic over a transport: sending user text, collecting assistant output, and
 * answering function calls with `function_call_output` followed by one `response.create`.
 */
export class RealtimeSession {
  private stateValue: ConnectionState = 'disconnected';
  private transport: RealtimeTransport | null = null;
  private generation = 0;

  public constructor(private readonly hooks: RealtimeSessionHooks) {}

  public get state(): ConnectionState {
    return this.stateValue;
  }

  public async open(
    transport: RealtimeTransport,
    clientSecret: string,
    microphone: boolean
  ): Promise<void> {
    this.close();
    const generation = ++this.generation;
    this.transport = transport;
    this.setState('connecting');
    try {
      await transport.connect({
        clientSecret,
        microphone,
        onEvent: (event) => {
          if (generation === this.generation) void this.handleEvent(event);
        },
        onClose: (reason) => {
          if (generation !== this.generation) return;
          this.transport = null;
          this.hooks.onError(reason);
          this.setState('failed');
        }
      });
    } catch (error) {
      if (generation === this.generation) {
        this.transport = null;
        this.setState('failed');
      }
      throw error;
    }
    if (generation === this.generation) this.setState('connected');
  }

  public close(): void {
    this.generation += 1;
    const transport = this.transport;
    this.transport = null;
    transport?.close();
    if (this.stateValue !== 'disconnected') this.setState('disconnected');
  }

  public sendText(text: string): void {
    this.send({
      type: 'conversation.item.create',
      item: {type: 'message', role: 'user', content: [{type: 'input_text', text}]}
    });
    this.send({type: 'response.create'});
  }

  private send(event: RealtimeEvent): void {
    if (!this.transport || this.stateValue !== 'connected') throw new Error('Not connected to Realtime.');
    this.transport.send(event);
  }

  private async handleEvent(event: RealtimeEvent): Promise<void> {
    if (event.type === 'error') {
      this.hooks.onError(describeApiError(event));
      return;
    }
    if (event.type !== 'response.done') return;
    const output = readResponseOutput(event);
    if (output.text.length > 0) this.hooks.onResponseText(output.text);
    if (output.calls.length === 0) return;

    const generation = this.generation;
    const results = await Promise.all(output.calls.map((call) => this.runCall(call)));
    if (generation !== this.generation || !this.transport) return;
    for (const result of results) {
      this.transport.send({
        type: 'conversation.item.create',
        item: {type: 'function_call_output', call_id: result.callId, output: result.output}
      });
    }
    this.transport.send({type: 'response.create'});
  }

  private async runCall(call: FunctionCall): Promise<{callId: string; output: string}> {
    let args: unknown;
    try {
      args = call.argumentsJson.trim().length === 0 ? {} : (JSON.parse(call.argumentsJson) as unknown);
    } catch {
      return {callId: call.callId, output: JSON.stringify({error: 'Arguments were not valid JSON.'})};
    }
    try {
      const value = await this.hooks.callFunction(call.name, args);
      return {callId: call.callId, output: JSON.stringify(value ?? null)};
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.hooks.onError(message);
      return {callId: call.callId, output: JSON.stringify({error: message})};
    }
  }

  private setState(state: ConnectionState): void {
    this.stateValue = state;
    this.hooks.onStateChange?.(state);
  }
}

export function readResponseOutput(event: RealtimeEvent): {text: string; calls: FunctionCall[]} {
  const response = asRecord(event.response);
  const items = Array.isArray(response?.output) ? response.output : [];
  const texts: string[] = [];
  const calls: FunctionCall[] = [];
  for (const rawItem of items) {
    const item = asRecord(rawItem);
    if (!item) continue;
    if (item.type === 'function_call' && typeof item.name === 'string' && typeof item.call_id === 'string') {
      calls.push({
        callId: item.call_id,
        name: item.name,
        argumentsJson: typeof item.arguments === 'string' ? item.arguments : ''
      });
    } else if (item.type === 'message' && Array.isArray(item.content)) {
      for (const rawPart of item.content) {
        const part = asRecord(rawPart);
        if (typeof part?.text === 'string') texts.push(part.text);
        else if (typeof part?.transcript === 'string') texts.push(part.transcript);
      }
    }
  }
  return {text: texts.join(''), calls};
}

function describeApiError(event: RealtimeEvent): string {
  const error = asRecord(event.error);
  const message = typeof error?.message === 'string' ? error.message : 'Unknown Realtime API error.';
  const code = typeof error?.code === 'string' ? ` (${error.code})` : '';
  return `${message}${code}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
