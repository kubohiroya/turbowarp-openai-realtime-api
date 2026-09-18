/**
 * Composition API: the OpenAI Realtime capability without TurboWarp block definitions.
 *
 * A downstream extension (for example `@kubohiroya/turbowarp-voice-chat`) owns its own blocks and
 * hats, and passes its own `define function` hat opcode. Importing this module does not register
 * any TurboWarp extension and does not touch the `Scratch` global.
 */
import {
  createNamedFunctions,
  type FunctionScan,
  type NamedFunctions,
  type RuntimeLike,
  type RuntimeThread
} from '@kubohiroya/turbowarp-named-functions/composition';
import {RealtimeSession, type ConnectionState} from './realtime-session.js';
import {
  normalizeRelayEndpoint,
  pairWithRelay,
  requestClientSecret,
  type FetchLike,
  type RelaySession
} from './relay-client.js';
import {
  buildSessionRequest,
  defaultSessionSettings,
  normalizeInstructions,
  normalizeModel,
  normalizeOutputMode,
  normalizeVoice,
  type OutputMode,
  type SessionSettings
} from './session-config.js';
import type {RealtimeTransport} from './transport.js';
import {addUsage, emptyUsage, type UsageTotals} from './usage.js';
import {WebRtcTransport} from './webrtc-transport.js';

export type {ConnectionState} from './realtime-session.js';
export type {OutputMode, SessionSettings} from './session-config.js';
export {SUPPORTED_MODELS} from './session-config.js';
export type {UsageTotals} from './usage.js';
export {MODEL_PRICES, PRICES_AS_OF} from './usage.js';
export type {RealtimeTransport, RealtimeEvent, TransportConnectOptions} from './transport.js';
export type {NamedFunctions, RuntimeLike, RuntimeThread} from '@kubohiroya/turbowarp-named-functions/composition';

export const DEFAULT_RELAY_ENDPOINT = 'http://127.0.0.1:8787';

export type RealtimeCompositionEvent =
  | {type: 'state'; state: ConnectionState}
  | {type: 'response'; text: string}
  | {type: 'usage'; usage: Readonly<UsageTotals>}
  | {type: 'error'; message: string}
  | {type: 'sessionTimeLimitReached'};

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
  connect(options: {microphone: boolean}): Promise<void>;
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

export function createRealtimeComposition(options: RealtimeCompositionOptions): RealtimeComposition {
  return new Composition(options);
}

class Composition implements RealtimeComposition {
  private relayEndpoint = DEFAULT_RELAY_ENDPOINT;
  private relaySession: RelaySession | null = null;
  private settingsValue: SessionSettings = defaultSessionSettings();
  private timeLimitSeconds = 0;
  private connectedAt: number | null = null;
  private timeLimitTimer: unknown = null;
  private activeModelValue = '';
  private lastResponse = '';
  private usageTotals: UsageTotals = emptyUsage();
  private readonly listeners = new Set<RealtimeCompositionListener>();
  private readonly fetcher: FetchLike;
  private readonly createTransport: () => RealtimeTransport;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly namedFunctions: NamedFunctions;
  private readonly ownsFunctions: boolean;
  private readonly session: RealtimeSession;

  public constructor(private readonly options: RealtimeCompositionOptions) {
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    this.createTransport = options.createTransport ?? (() => new WebRtcTransport());
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.ownsFunctions = options.functions === undefined;
    this.namedFunctions =
      options.functions ??
      createNamedFunctions({runtime: options.runtime, functionHatOpcode: options.functionHatOpcode});
    this.session = new RealtimeSession({
      callFunction: (name, args) => this.namedFunctions.call(name, args, {exportedOnly: true}),
      onResponseText: (text) => {
        this.lastResponse = text;
        this.emit({type: 'response', text});
      },
      onError: (message) => this.emit({type: 'error', message}),
      onStateChange: (state) => this.handleState(state),
      onUsage: (usage) => {
        this.usageTotals = addUsage(this.usageTotals, usage, this.activeModelValue);
        this.emit({type: 'usage', usage: this.usage()});
      }
    });
  }

  // ---- relay --------------------------------------------------------------------------------

  public configureRelay(endpoint: string): void {
    this.relayEndpoint = normalizeRelayEndpoint(endpoint);
    this.relaySession = null;
  }

  public async pairRelay(code: string): Promise<void> {
    this.relaySession = await pairWithRelay(this.relayEndpoint, code, this.fetcher, this.now);
  }

  public isRelayPaired(): boolean {
    return this.relaySession !== null && this.relaySession.expiresAt > this.now();
  }

  // ---- settings -----------------------------------------------------------------------------

  public setModel(model: string): void {
    this.settingsValue = {...this.settingsValue, model: normalizeModel(model)};
  }

  public setInstructions(text: string): void {
    this.settingsValue = {...this.settingsValue, instructions: normalizeInstructions(text)};
  }

  public setVoice(voice: string): void {
    this.settingsValue = {...this.settingsValue, voice: normalizeVoice(voice)};
  }

  public setOutputMode(mode: OutputMode): void {
    this.settingsValue = {...this.settingsValue, outputMode: normalizeOutputMode(mode)};
  }

  public setSessionTimeLimit(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new TypeError('Session time limit must be zero or a positive number of seconds.');
    }
    this.timeLimitSeconds = seconds;
  }

  public get settings(): Readonly<SessionSettings> {
    return {...this.settingsValue};
  }

  public get sessionTimeLimitSeconds(): number {
    return this.timeLimitSeconds;
  }

  // ---- connection ---------------------------------------------------------------------------

  public scanFunctions(): FunctionScan {
    return this.namedFunctions.scan();
  }

  public get functions(): NamedFunctions {
    return this.namedFunctions;
  }

  public async connect(options: {microphone: boolean}): Promise<void> {
    if (!this.relaySession || !this.isRelayPaired()) throw new Error('Pair with the local relay first.');
    const request = buildSessionRequest(this.settingsValue, this.namedFunctions.tools());
    const secret = await requestClientSecret(this.relaySession, request, this.fetcher, this.now);
    this.activeModelValue = secret.model || this.settingsValue.model;
    await this.session.open(this.createTransport(), secret.value, options.microphone);
  }

  public disconnect(): void {
    this.session.close();
  }

  public get state(): ConnectionState {
    return this.session.state;
  }

  public get activeModel(): string {
    return this.activeModelValue;
  }

  public sessionElapsedSeconds(): number {
    return this.connectedAt === null ? 0 : Math.max(0, (this.now() - this.connectedAt) / 1000);
  }

  public sendText(text: string): void {
    this.session.sendText(text);
  }

  public get lastResponseText(): string {
    return this.lastResponse;
  }

  // ---- function values ----------------------------------------------------------------------

  public matchFunctionHat(name: string, thread: RuntimeThread | undefined): boolean {
    return this.namedFunctions.matchHat(name, thread);
  }

  public functionArguments(thread: RuntimeThread | undefined): unknown {
    return this.namedFunctions.argumentsFor(thread);
  }

  public returnFromFunction(thread: RuntimeThread | undefined, value: unknown): void {
    this.namedFunctions.returnFrom(thread, value);
  }

  // ---- usage --------------------------------------------------------------------------------

  public usage(): Readonly<UsageTotals> {
    return {...this.usageTotals};
  }

  public resetUsage(): void {
    this.usageTotals = emptyUsage();
    this.emit({type: 'usage', usage: this.usage()});
  }

  // ---- events -------------------------------------------------------------------------------

  public subscribe(listener: RealtimeCompositionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public release(): void {
    this.disconnect();
    this.listeners.clear();
    if (this.ownsFunctions) this.namedFunctions.release();
  }

  private handleState(state: ConnectionState): void {
    if (state === 'connected') {
      this.connectedAt = this.now();
      if (this.timeLimitSeconds > 0) {
        this.timeLimitTimer = this.setTimer(() => this.reachTimeLimit(), this.timeLimitSeconds * 1000);
      }
    } else if (state !== 'connecting') {
      this.connectedAt = null;
      this.cancelTimeLimit();
      this.namedFunctions.cancelAll('The Realtime session ended.');
    }
    this.emit({type: 'state', state});
  }

  private reachTimeLimit(): void {
    this.timeLimitTimer = null;
    if (this.session.state !== 'connected') return;
    this.session.close();
    this.emit({type: 'sessionTimeLimitReached'});
  }

  private cancelTimeLimit(): void {
    if (this.timeLimitTimer !== null) this.clearTimer(this.timeLimitTimer);
    this.timeLimitTimer = null;
  }

  private emit(event: RealtimeCompositionEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
