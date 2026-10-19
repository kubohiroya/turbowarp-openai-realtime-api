import type {
  FixedInputBinding,
  FixedInputEditorOptions,
  JsonValue,
  LiteralValue,
} from "@kubohiroya/turbowarp-extension-data-editor";
import type { SchemaBundle } from "@kubohiroya/turbowarp-extension-data-editor/schema";
import schemas from "../schemas/block-editor-fixed-inputs.schema.json" with { type: "json" };
interface InputSchema {
  readonly type: string;
  readonly enum?: readonly (string | number)[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
}
const contracts = schemas.$defs as Readonly<
  Record<string, { readonly properties: Readonly<Record<string, InputSchema>> }>
>;
const repository = "turbowarp-openai-realtime-api";
const extensionId = "kubohiroyaopenairealtime";
const token = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u;
export function readNumber(value: LiteralValue): number {
  if (typeof value !== "string" && typeof value !== "number")
    throw new TypeError("Invalid numeric projection.");
  if (typeof value === "string" && value.trim() === "")
    throw new TypeError("Existing blank field is readonly.");
  const number = Number(value);
  if (!Number.isFinite(number))
    throw new TypeError("Existing nonfinite field is readonly.");
  return number;
}
export function newNumberToken(value: JsonValue): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Invalid new number.");
    return Object.is(value, -0) ? "-0" : String(value);
  }
  if (
    typeof value !== "string" ||
    !token.test(value.trim()) ||
    !Number.isFinite(Number(value))
  )
    throw new TypeError("Invalid new number.");
  return value.trim();
}
function existingChoice(_opcode: string, value: LiteralValue): string {
  if (typeof value !== "string")
    throw new TypeError("Invalid string projection.");
  return value;
}
export function candidateValid(
  _opcode: string,
  _argument: string,
  schema: InputSchema,
  value: LiteralValue,
): boolean {
  if (schema.type === "number" || schema.type === "integer") {
    let number;
    try {
      number = readNumber(value);
    } catch {
      return false;
    }
    if (schema.type === "integer" && !Number.isInteger(number)) return false;
    if (schema.minimum !== undefined && number < schema.minimum) return false;
    if (schema.maximum !== undefined && number > schema.maximum) return false;
    if (
      schema.exclusiveMinimum !== undefined &&
      number <= schema.exclusiveMinimum
    )
      return false;
    if (schema.enum && !schema.enum!.includes(number)) return false;
    return true;
  }
  return typeof value === "string" && schema.enum!.includes(value);
}
export function fixedInputEditorOptions(): readonly FixedInputEditorOptions[] {
  return Object.entries(contracts).map(([opcode, contract]) => ({
    apiVersion: 1,
    extensionId,
    editorId: `${extensionId}.fixed.${opcode}`,
    opcodes: [`${extensionId}_${opcode}`],
    contractId: `${repository}.${opcode}.fixed`,
    contractRevision: "fixed-inputs-v1",
    validationContext: () => ({
      consumerId: repository,
      nowMs: 0,
      settings: null,
    }),
    bindings: Object.entries(contract.properties).map(
      ([argument, schema]): FixedInputBinding => {
        const numeric = schema.type === "number" || schema.type === "integer";
        const source = {
          repository,
          path: "schemas/block-editor-fixed-inputs.schema.json",
          symbol: `/$defs/${opcode}/properties/${argument}`,
        };
        return {
          argument,
          schemaBundle: {
            identity: {
              ownerId: repository,
              contractId: `${opcode}.${argument}`,
              revision: "fixed-inputs-v1",
              variantId: "fixed",
            },
            dialect: "draft-07",
            root: {
              retrievalUri: `${schemas.$id}?binding=${opcode}.${argument}`,
              document: schema as unknown as SchemaBundle["root"]["document"],
              artifact: { role: "canonical-schema", source },
            },
            resources: [],
            provenance: {
              canonicalSources: [
                source,
                { repository, path: "src/block-definitions.json" },
                { repository, path: "src/extension.ts", symbol: opcode },
              ],
              generatedFiles: [],
              referenceSchemas: [],
              generationSources: [],
            },
          },
          control: numeric
            ? { kind: "number" }
            : {
                kind: "enum",
                choices: schema.enum!.map((value) => ({
                  value,
                  label: String(value),
                })),
              },
          read: (value) =>
            numeric ? readNumber(value) : existingChoice(opcode, value),
          encode: (value) => {
            if (numeric) return newNumberToken(value);
            if (typeof value !== "string" || !schema.enum!.includes(value))
              throw new TypeError("Invalid new enum value.");
            return value;
          },
          validateCandidate: (value) =>
            candidateValid(opcode, argument, schema, value)
              ? []
              : [
                  {
                    path: argument,
                    message: "Check this value before saving.",
                  },
                ],
        };
      },
    ),
  }));
}

interface RegistrationRuntime {
  on?(event: string, listener: () => void): void;
  off?(event: string, listener: () => void): void;
}
/** Register only visible static contracts; ordinary composition consumers load no editor runtime. */
export function registerFixedInputEditors(
  scratch: unknown,
  runtime: unknown,
  visibleBlocks: readonly unknown[],
): (() => void) | undefined {
  const api = (
    scratch as {
      gui?: {
        blockEditors?: {
          apiVersion?: number;
          registerFixedInputEditor?: (
            options: FixedInputEditorOptions,
          ) => () => void;
        };
      };
    }
  ).gui?.blockEditors;
  if (
    api?.apiVersion !== 1 ||
    typeof api.registerFixedInputEditor !== "function"
  )
    return undefined;
  const visibleOpcodes = new Set(
    visibleBlocks.flatMap((block) => {
      if (typeof block !== "object" || block === null || !("opcode" in block))
        return [];
      return typeof block.opcode === "string" ? [block.opcode] : [];
    }),
  );
  const events = runtime as RegistrationRuntime | undefined;
  const removers: (() => void)[] = [];
  let active = true;
  const dispose = () => {
    if (!active) return;
    active = false;
    events?.off?.("RUNTIME_DISPOSED", dispose);
    for (const remove of removers.splice(0).reverse()) remove();
  };
  try {
    for (const options of fixedInputEditorOptions()) {
      if (
        options.opcodes.some((opcode) =>
          visibleOpcodes.has(opcode.slice(extensionId.length + 1)),
        )
      )
        removers.push(api.registerFixedInputEditor.call(api, options));
    }
    events?.on?.("RUNTIME_DISPOSED", dispose);
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}
