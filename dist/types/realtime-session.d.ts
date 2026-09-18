import type { RealtimeEvent, RealtimeTransport } from './transport.js';
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
    /** Receives `response.usage` from every `response.done`, including function-call rounds. */
    onUsage?: (usage: unknown) => void;
}
/**
 * Conversation logic over a transport: sending user text, collecting assistant output, and
 * answering function calls with `function_call_output` followed by one `response.create`.
 */
export declare class RealtimeSession {
    private readonly hooks;
    private stateValue;
    private transport;
    private generation;
    constructor(hooks: RealtimeSessionHooks);
    get state(): ConnectionState;
    open(transport: RealtimeTransport, clientSecret: string, microphone: boolean): Promise<void>;
    close(): void;
    sendText(text: string): void;
    private send;
    private handleEvent;
    private runCall;
    private setState;
}
export declare function readResponseOutput(event: RealtimeEvent): {
    text: string;
    calls: FunctionCall[];
};
