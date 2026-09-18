import {extensionConfig} from './config';
import definitions from './block-definitions.json';
import {
  createRealtimeComposition,
  type RealtimeComposition,
  type RealtimeCompositionOptions,
  type UsageTotals
} from './composition.js';
import {
  parseJsonOrText,
  readArgumentPath,
  toScratchValue,
  type BlockUtilityLike
} from '@kubohiroya/turbowarp-named-functions/composition';
import {normalizeOutputMode} from './session-config.js';

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
export const TIME_LIMIT_OPCODE = `${extensionConfig.id}_whenSessionTimeLimitReached`;

export type RealtimeExtensionDependencies = Omit<RealtimeCompositionOptions, 'functionHatOpcode'>;

type Args = Record<string, unknown>;

const USAGE_FIELDS: Record<string, (usage: UsageTotals) => number> = {
  costUSD: (usage) => Math.round(usage.estimatedCostUsd * 1_000_000) / 1_000_000,
  responses: (usage) => usage.responses,
  inputTokens: (usage) => usage.inputTokens,
  outputTokens: (usage) => usage.outputTokens,
  cachedInputTokens: (usage) => usage.cachedInputTokens,
  textInputTokens: (usage) => usage.textInputTokens,
  audioInputTokens: (usage) => usage.audioInputTokens,
  textOutputTokens: (usage) => usage.textOutputTokens,
  audioOutputTokens: (usage) => usage.audioOutputTokens
};

/** Block surface over the Realtime composition. */
export class OpenAIRealtimeExtension implements TurboWarpExtension {
  private lastErrorMessage = '';
  private readonly realtime: RealtimeComposition;

  public constructor(deps: RealtimeExtensionDependencies) {
    this.realtime = createRealtimeComposition({...deps, functionHatOpcode: DEFINE_FUNCTION_OPCODE});
    this.realtime.subscribe((event) => {
      if (event.type === 'response') deps.runtime.startHats(RESPONSE_DONE_OPCODE);
      else if (event.type === 'sessionTimeLimitReached') deps.runtime.startHats(TIME_LIMIT_OPCODE);
      else if (event.type === 'error') this.lastErrorMessage = event.message;
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
    this.record(() => this.realtime.configureRelay(Scratch.Cast.toString(args.ENDPOINT)));
  }

  public pairRelay(args: Args): Promise<void> {
    return this.recordAsync(() => this.realtime.pairRelay(Scratch.Cast.toString(args.CODE)));
  }

  public isRelayPaired(): boolean {
    return this.realtime.isRelayPaired();
  }

  // ---- session settings ---------------------------------------------------------------------

  public setInstructions(args: Args): void {
    this.record(() => this.realtime.setInstructions(Scratch.Cast.toString(args.TEXT)));
  }

  public setVoice(args: Args): void {
    this.record(() => this.realtime.setVoice(Scratch.Cast.toString(args.VOICE)));
  }

  public setOutputMode(args: Args): void {
    this.record(() => this.realtime.setOutputMode(normalizeOutputMode(Scratch.Cast.toString(args.MODE))));
  }

  public setModel(args: Args): void {
    this.record(() => this.realtime.setModel(Scratch.Cast.toString(args.MODEL)));
  }

  public setSessionTimeLimit(args: Args): void {
    this.record(() => this.realtime.setSessionTimeLimit(Scratch.Cast.toNumber(args.SECONDS)));
  }

  // ---- connection ---------------------------------------------------------------------------

  public connect(args: Args): Promise<void> {
    return this.recordAsync(() =>
      this.realtime.connect({microphone: Scratch.Cast.toString(args.MICROPHONE) !== 'off'})
    );
  }

  public disconnect(): void {
    this.realtime.disconnect();
  }

  public isConnected(): boolean {
    return this.realtime.state === 'connected';
  }

  public connectionState(): string {
    return this.realtime.state;
  }

  public currentModel(): string {
    return this.realtime.activeModel;
  }

  public sessionElapsed(): number {
    return Math.floor(this.realtime.sessionElapsedSeconds());
  }

  public whenSessionTimeLimitReached(): boolean {
    return true;
  }

  // ---- conversation -------------------------------------------------------------------------

  public sendText(args: Args): void {
    this.record(() => this.realtime.sendText(Scratch.Cast.toString(args.TEXT)));
  }

  public whenResponseDone(): boolean {
    return true;
  }

  public lastResponseText(): string {
    return this.realtime.lastResponseText;
  }

  // ---- function values ----------------------------------------------------------------------

  public defineFunction(args: Args, util?: BlockUtilityLike): boolean {
    return this.realtime.matchFunctionHat(Scratch.Cast.toString(args.NAME), util?.thread);
  }

  public functionArgument(args: Args, util?: BlockUtilityLike): string | number | boolean {
    try {
      const value = readArgumentPath(this.realtime.functionArguments(util?.thread), Scratch.Cast.toString(args.PATH));
      return toScratchValue(value);
    } catch (error) {
      this.lastErrorMessage = messageOf(error);
      return '';
    }
  }

  public functionArgumentsJson(_args: Args, util?: BlockUtilityLike): string {
    try {
      return JSON.stringify(this.realtime.functionArguments(util?.thread) ?? null);
    } catch (error) {
      this.lastErrorMessage = messageOf(error);
      return '';
    }
  }

  public returnValue(args: Args, util?: BlockUtilityLike & {stopThisScript?: () => void}): void {
    try {
      this.realtime.returnFromFunction(util?.thread, parseJsonOrText(Scratch.Cast.toString(args.VALUE)));
      util?.stopThisScript?.();
    } catch (error) {
      this.lastErrorMessage = messageOf(error);
    }
  }

  // ---- usage and diagnostics ----------------------------------------------------------------

  public usageValue(args: Args): number | string {
    const read = USAGE_FIELDS[Scratch.Cast.toString(args.FIELD)];
    return read ? read(this.realtime.usage()) : '';
  }

  public resetUsage(): void {
    this.realtime.resetUsage();
  }

  public lastError(): string {
    return this.lastErrorMessage;
  }

  // ---- internals ----------------------------------------------------------------------------

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
