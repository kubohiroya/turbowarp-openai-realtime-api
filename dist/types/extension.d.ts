import { type RealtimeCompositionOptions } from './composition.js';
import { type BlockUtilityLike } from '@kubohiroya/turbowarp-named-functions/composition';
export declare const DEFINE_FUNCTION_OPCODE: string;
export declare const RESPONSE_DONE_OPCODE: string;
export declare const TIME_LIMIT_OPCODE: string;
export type RealtimeExtensionDependencies = Omit<RealtimeCompositionOptions, 'functionHatOpcode'>;
type Args = Record<string, unknown>;
/** Block surface over the Realtime composition. */
export declare class OpenAIRealtimeExtension implements TurboWarpExtension {
    private lastErrorMessage;
    private readonly realtime;
    constructor(deps: RealtimeExtensionDependencies);
    getInfo(): Record<string, unknown>;
    configureRelay(args: Args): void;
    pairRelay(args: Args): Promise<void>;
    isRelayPaired(): boolean;
    setInstructions(args: Args): void;
    setVoice(args: Args): void;
    setOutputMode(args: Args): void;
    setModel(args: Args): void;
    setSessionTimeLimit(args: Args): void;
    connect(args: Args): Promise<void>;
    disconnect(): void;
    isConnected(): boolean;
    connectionState(): string;
    currentModel(): string;
    sessionElapsed(): number;
    whenSessionTimeLimitReached(): boolean;
    sendText(args: Args): void;
    whenResponseDone(): boolean;
    lastResponseText(): string;
    defineFunction(args: Args, util?: BlockUtilityLike): boolean;
    functionArgument(args: Args, util?: BlockUtilityLike): string | number | boolean;
    functionArgumentsJson(_args: Args, util?: BlockUtilityLike): string;
    returnValue(args: Args, util?: BlockUtilityLike & {
        stopThisScript?: () => void;
    }): void;
    usageValue(args: Args): number | string;
    resetUsage(): void;
    lastError(): string;
    private record;
    private recordAsync;
    private toScratchBlock;
}
export {};
