import type { FixedInputEditorOptions, JsonValue, LiteralValue } from "@kubohiroya/turbowarp-extension-data-editor";
interface InputSchema {
    readonly type: string;
    readonly enum?: readonly (string | number)[];
    readonly minimum?: number;
    readonly maximum?: number;
    readonly exclusiveMinimum?: number;
}
export declare function readNumber(value: LiteralValue): number;
export declare function newNumberToken(value: JsonValue): string;
export declare function candidateValid(_opcode: string, _argument: string, schema: InputSchema, value: LiteralValue): boolean;
export declare function fixedInputEditorOptions(): readonly FixedInputEditorOptions[];
/** Register only visible static contracts; ordinary composition consumers load no editor runtime. */
export declare function registerFixedInputEditors(scratch: unknown, runtime: unknown, visibleBlocks: readonly unknown[]): (() => void) | undefined;
export {};
