import {extensionConfig} from './config';
import definitions from './block-definitions.json';
import {FunctionDispatcher, parseReturnValue, readArgumentPath, toScratchValue} from './function-dispatcher.js';
import {scanFunctionDefinitions, toFunctionTools} from './function-registry.js';
import {RealtimeSession} from './realtime-session.js';
import {
  normalizeRelayEndpoint,
  pairWithRelay,
  requestClientSecret,
  type FetchLike,
  type RelaySession
} from './relay-client.js';
import type {BlockUtilityLike, RuntimeLike} from './runtime-types.js';
import {
  buildSessionRequest,
  defaultSessionSettings,
  normalizeInstructions,
  normalizeOutputMode,
  normalizeVoice,
  type SessionSettings
} from './session-config.js';
import type {RealtimeTransport} from './transport.js';
import {WebRtcTransport} from './webrtc-transport.js';

type BlockTypeName = 'COMMAND' | 'REPORTER' | 'BOOLEAN' | 'HAT';
type ArgumentTypeName = 'STRING' | 'NUMBER' | 'BOOLEAN';

interface DefinitionArgument {
  type: ArgumentTypeName;
  defaultValue: string;
  menu?: string;
}

interface BlockDefinition {
  opcode: string;
  blockType: BlockTypeName;
  text: string;
  description: string;
  arguments: Record<string, DefinitionArgument>;
}

interface MenuDefinition {
  acceptReporters: boolean;
  items: string[];
}

const blockDefinitions = definitions.blocks as readonly BlockDefinition[];
const menuDefinitions = definitions.menus as Record<string, MenuDefinition>;

export const DEFINE_FUNCTION_OPCODE = `${extensionConfig.id}_defineFunction`;
export const RESPONSE_DONE_OPCODE = `${extensionConfig.id}_whenResponseDone`;
export const DEFAULT_RELAY_ENDPOINT = 'http://127.0.0.1:8787';

export interface RealtimeExtensionDependencies {
  runtime: RuntimeLike;
  fetch?: FetchLike;
  createTransport?: () => RealtimeTransport;
  now?: () => number;
}

type Args = Record<string, unknown>;

export class OpenAIRealtimeExtension implements TurboWarpExtension {
  private relayEndpoint = DEFAULT_RELAY_ENDPOINT;
  private relaySession: RelaySession | null = null;
  private settings: SessionSettings = defaultSessionSettings();
  private lastErrorMessage = '';
  private lastResponse = '';
  private readonly runtime: RuntimeLike;
  private readonly fetcher: FetchLike;
  private readonly createTransport: () => RealtimeTransport;
  private readonly now: () => number;
  private readonly dispatcher: FunctionDispatcher;
  private readonly session: RealtimeSession;

  public constructor(deps: RealtimeExtensionDependencies) {
    this.runtime = deps.runtime;
    this.fetcher = deps.fetch ?? ((input, init) => fetch(input, init));
    this.createTransport = deps.createTransport ?? (() => new WebRtcTransport());
    this.now = deps.now ?? Date.now;
    this.dispatcher = new FunctionDispatcher(this.runtime, {
      hatOpcode: DEFINE_FUNCTION_OPCODE,
      knownNames: () => new Set(this.scanFunctions().functions.map((definition) => definition.name))
    });
    this.session = new RealtimeSession({
      callFunction: (name, args) => this.callExportedFunction(name, args),
      onResponseText: (text) => {
        this.lastResponse = text;
        this.runtime.startHats(RESPONSE_DONE_OPCODE);
      },
      onError: (message) => {
        this.lastErrorMessage = message;
      },
      onStateChange: (state) => {
        if (state !== 'connected' && state !== 'connecting') {
          this.dispatcher.cancelAll('The Realtime session ended.');
        }
      }
    });
  }

  public getInfo(): Record<string, unknown> {
    return {
      id: extensionConfig.id,
      name: Scratch.translate(definitions.extensionName),
      docsURI: extensionConfig.docsURI,
      blockIconURI: extensionConfig.blockIconURI,
      blocks: blockDefinitions.map((block) => this.toScratchBlock(block)),
      menus: Object.fromEntries(
        Object.entries(menuDefinitions).map(([id, menu]) => [
          id,
          {acceptReporters: menu.acceptReporters, items: [...menu.items]}
        ])
      )
    };
  }

  // ---- relay ------------------------------------------------------------------------------

  public configureRelay(args: Args): void {
    this.record(() => {
      this.relayEndpoint = normalizeRelayEndpoint(Scratch.Cast.toString(args.ENDPOINT));
      this.relaySession = null;
    });
  }

  public pairRelay(args: Args): Promise<void> {
    return this.recordAsync(async () => {
      this.relaySession = await pairWithRelay(
        this.relayEndpoint,
        Scratch.Cast.toString(args.CODE),
        this.fetcher,
        this.now
      );
    });
  }

  public isRelayPaired(): boolean {
    return this.relaySession !== null && this.relaySession.expiresAt > this.now();
  }

  // ---- session settings ---------------------------------------------------------------------

  public setInstructions(args: Args): void {
    this.record(() => {
      this.settings = {...this.settings, instructions: normalizeInstructions(Scratch.Cast.toString(args.TEXT))};
    });
  }

  public setVoice(args: Args): void {
    this.record(() => {
      this.settings = {...this.settings, voice: normalizeVoice(Scratch.Cast.toString(args.VOICE))};
    });
  }

  public setOutputMode(args: Args): void {
    this.record(() => {
      this.settings = {...this.settings, outputMode: normalizeOutputMode(Scratch.Cast.toString(args.MODE))};
    });
  }

  // ---- connection ---------------------------------------------------------------------------

  public connect(args: Args): Promise<void> {
    return this.recordAsync(async () => {
      if (!this.relaySession || !this.isRelayPaired()) {
        throw new Error('Pair with the local relay first.');
      }
      const scan = this.scanFunctions();
      if (scan.errors.length > 0) throw new Error(`Invalid function definitions: ${scan.errors.join('; ')}`);
      const request = buildSessionRequest(this.settings, toFunctionTools(scan.functions));
      const secret = await requestClientSecret(this.relaySession, request, this.fetcher, this.now);
      const microphone = Scratch.Cast.toString(args.MICROPHONE) !== 'off';
      await this.session.open(this.createTransport(), secret.value, microphone);
    });
  }

  public disconnect(): void {
    this.session.close();
  }

  public isConnected(): boolean {
    return this.session.state === 'connected';
  }

  public connectionState(): string {
    return this.session.state;
  }

  // ---- conversation -------------------------------------------------------------------------

  public sendText(args: Args): void {
    this.record(() => this.session.sendText(Scratch.Cast.toString(args.TEXT)));
  }

  public whenResponseDone(): boolean {
    return true;
  }

  public lastResponseText(): string {
    return this.lastResponse;
  }

  // ---- function values ----------------------------------------------------------------------

  public defineFunction(args: Args, util?: BlockUtilityLike): boolean {
    return this.dispatcher.matchHat(Scratch.Cast.toString(args.NAME), util?.thread);
  }

  public functionArgument(args: Args, util?: BlockUtilityLike): string | number | boolean {
    try {
      const value = readArgumentPath(this.dispatcher.argumentsFor(util?.thread), Scratch.Cast.toString(args.PATH));
      return toScratchValue(value);
    } catch (error) {
      this.lastErrorMessage = messageOf(error);
      return '';
    }
  }

  public functionArgumentsJson(_args: Args, util?: BlockUtilityLike): string {
    try {
      return JSON.stringify(this.dispatcher.argumentsFor(util?.thread) ?? null);
    } catch (error) {
      this.lastErrorMessage = messageOf(error);
      return '';
    }
  }

  public returnValue(args: Args, util?: BlockUtilityLike & {stopThisScript?: () => void}): void {
    try {
      this.dispatcher.returnFrom(util?.thread, parseReturnValue(Scratch.Cast.toString(args.VALUE)));
      util?.stopThisScript?.();
    } catch (error) {
      this.lastErrorMessage = messageOf(error);
    }
  }

  // ---- diagnostics --------------------------------------------------------------------------

  public lastError(): string {
    return this.lastErrorMessage;
  }

  // ---- internals ----------------------------------------------------------------------------

  private scanFunctions() {
    return scanFunctionDefinitions(this.runtime.targets, DEFINE_FUNCTION_OPCODE);
  }

  private callExportedFunction(name: string, args: unknown): Promise<unknown> {
    const definition = this.scanFunctions().functions.find((candidate) => candidate.name === name);
    if (!definition || definition.exportAs !== 'tool') {
      return Promise.reject(new Error(`Function ${name} is not exported as a tool.`));
    }
    return this.dispatcher.invoke(name, args);
  }

  private record(action: () => void): void {
    try {
      action();
      this.lastErrorMessage = '';
    } catch (error) {
      this.lastErrorMessage = messageOf(error);
    }
  }

  private async recordAsync(action: () => Promise<void>): Promise<void> {
    try {
      await action();
      this.lastErrorMessage = '';
    } catch (error) {
      this.lastErrorMessage = messageOf(error);
    }
  }

  private toScratchBlock(block: BlockDefinition): Record<string, unknown> {
    const scratchBlock: Record<string, unknown> = {
      opcode: block.opcode,
      blockType: Scratch.BlockType[block.blockType],
      text: Scratch.translate(block.text),
      arguments: Object.fromEntries(
        Object.entries(block.arguments).map(([name, argument]) => [
          name,
          {
            type: Scratch.ArgumentType[argument.type],
            defaultValue: argument.defaultValue,
            ...(argument.menu ? {menu: argument.menu} : {})
          }
        ])
      )
    };
    if (block.blockType === 'HAT') scratchBlock.isEdgeActivated = false;
    return scratchBlock;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
