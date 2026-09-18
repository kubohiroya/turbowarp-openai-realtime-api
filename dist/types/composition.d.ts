/**
 * Composition API: the OpenAI Realtime capability without TurboWarp block definitions.
 *
 * A downstream extension (for example `@kubohiroya/turbowarp-voice-chat`) owns its own blocks and
 * hats, and passes its own `define function` hat opcode. Importing this module does not register
 * any TurboWarp extension and does not touch the `Scratch` global.
 */
import { type FunctionScan, type NamedFunctions, type RuntimeLike, type RuntimeThread } from '@kubohiroya/turbowarp-named-functions/composition';
import { type ConnectionState } from './realtime-session.js';
import { type FetchLike } from './relay-client.js';
import { type OutputMode, type SessionSettings } from './session-config.js';
import type { RealtimeTransport } from './transport.js';
import { type UsageTotals } from './usage.js';
export type { ConnectionState } from './realtime-session.js';
export type { OutputMode, SessionSettings } from './session-config.js';
export { SUPPORTED_MODELS } from './session-config.js';
export type { UsageTotals } from './usage.js';
export { MODEL_PRICES, PRICES_AS_OF } from './usage.js';
export type { RealtimeTransport, RealtimeEvent, TransportConnectOptions } from './transport.js';
export type { NamedFunctions, RuntimeLike, RuntimeThread } from '@kubohiroya/turbowarp-named-functions/composition';
export declare const DEFAULT_RELAY_ENDPOINT = "http://127.0.0.1:8787";
export type RealtimeCompositionEvent = {
    type: 'state';
    state: ConnectionState;
} | {
    type: 'response';
    text: string;
} | {
    type: 'usage';
    usage: Readonly<UsageTotals>;
} | {
    type: 'error';
    message: string;
} | {
    type: 'sessionTimeLimitReached';
};
export type RealtimeCompositionListener = (event: RealtimeCompositionEvent) => void;
export interface RealtimeCompositionOptions {
    runtime: RuntimeLike;
    /** Opcode of the downstream extension's `define function` hat, e.g. `myextension_defineFunction`. */
    functionHatOpcode: string;
    /**
     * Named functions to expose as tools. Pass one shared instance when another composition also uses
     * the same `define function` hats; otherwise one is created from `functionHatOpcode`.
     */
    functions?: NamedFunctions;
    fetch?: FetchLike;
    createTransport?: () => RealtimeTransport;
    now?: () => number;
    setTimer?: (callback: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
}
export interface RealtimeComposition {
    configureRelay(endpoint: string): void;
    pairRelay(code: string): Promise<void>;
    isRelayPaired(): boolean;
    setModel(model: string): void;
    setInstructions(text: string): void;
    setVoice(voice: string): void;
    setOutputMode(mode: OutputMode): void;
    /** Seconds; 0 disables the limit. Applies from the next connection. */
    setSessionTimeLimit(seconds: number): void;
    readonly settings: Readonly<SessionSettings>;
    readonly sessionTimeLimitSeconds: number;
    /** Validates `define function` hats without connecting. */
    scanFunctions(): FunctionScan;
    /** The named functions used for tools. */
    readonly functions: NamedFunctions;
    connect(options: {
        microphone: boolean;
    }): Promise<void>;
    disconnect(): void;
    readonly state: ConnectionState;
    /** Model reported by the relay for the current or last connection; empty before connecting. */
    readonly activeModel: string;
    sessionElapsedSeconds(): number;
    sendText(text: string): void;
    readonly lastResponseText: string;
    /** Call from the `define function` hat predicate. */
    matchFunctionHat(name: string, thread: RuntimeThread | undefined): boolean;
    functionArguments(thread: RuntimeThread | undefined): unknown;
    returnFromFunction(thread: RuntimeThread | undefined, value: unknown): void;
    usage(): Readonly<UsageTotals>;
    resetUsage(): void;
    subscribe(listener: RealtimeCompositionListener): () => void;
    /** Disconnects and detaches listeners. */
    release(): void;
}
export declare function createRealtimeComposition(options: RealtimeCompositionOptions): RealtimeComposition;
