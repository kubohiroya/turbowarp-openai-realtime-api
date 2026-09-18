import type {RuntimeTarget, SerializedBlock} from './runtime-types.js';
import type {FunctionTool} from './session-config.js';

export const FUNCTION_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
export const MAX_DESCRIPTION_LENGTH = 1024;

export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  exportAs: 'tool' | 'none';
  targetName: string;
  blockId: string;
}

export interface FunctionScan {
  functions: FunctionDefinition[];
  errors: string[];
}

/**
 * Reads every `define function` hat in the project. NAME, DESCRIPTION, and SCHEMA are part of the
 * tool contract sent to the model before any script runs, so they must be literal text.
 */
export function scanFunctionDefinitions(targets: readonly RuntimeTarget[], hatOpcode: string): FunctionScan {
  const functions: FunctionDefinition[] = [];
  const errors: string[] = [];
  const seen = new Map<string, string>();

  for (const target of targets) {
    if (target.isOriginal === false) continue;
    const targetName = target.getName?.() ?? (target.isStage ? 'Stage' : 'sprite');
    const blocks = target.blocks._blocks;
    for (const block of Object.values(blocks)) {
      if (block.opcode !== hatOpcode || block.topLevel === false) continue;
      const where = `${targetName} (block ${block.id})`;
      try {
        const definition = readDefinition(block, blocks, targetName);
        const previous = seen.get(definition.name);
        if (previous !== undefined) {
          throw new Error(`function "${definition.name}" is already defined in ${previous}`);
        }
        seen.set(definition.name, where);
        functions.push(definition);
      } catch (error) {
        errors.push(`${where}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  functions.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  return {functions, errors};
}

export function toFunctionTools(functions: readonly FunctionDefinition[]): FunctionTool[] {
  return functions
    .filter((definition) => definition.exportAs === 'tool')
    .map((definition) => ({
      type: 'function',
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters
    }));
}

function readDefinition(
  block: SerializedBlock,
  blocks: Record<string, SerializedBlock>,
  targetName: string
): FunctionDefinition {
  const name = readLiteralInput(block, blocks, 'NAME').trim();
  if (!FUNCTION_NAME_PATTERN.test(name)) {
    throw new Error('function name must be 1-64 letters, digits, "_" or "-"');
  }
  const description = readLiteralInput(block, blocks, 'DESCRIPTION').trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`description must be at most ${MAX_DESCRIPTION_LENGTH} characters`);
  }
  const parameters = parseSchema(readLiteralInput(block, blocks, 'SCHEMA'));
  const exportValue = String(block.fields?.EXPORT?.value ?? 'none');
  const exportAs = exportValue === 'tool' ? 'tool' : 'none';
  if (exportAs === 'tool' && description.length === 0) {
    throw new Error('a function exported as a tool needs a description');
  }
  return {name, description, parameters, exportAs, targetName, blockId: block.id};
}

function readLiteralInput(
  block: SerializedBlock,
  blocks: Record<string, SerializedBlock>,
  inputName: string
): string {
  const input = block.inputs?.[inputName];
  if (!input) throw new Error(`${inputName} is missing`);
  if (input.block && input.block !== input.shadow) {
    throw new Error(`${inputName} must be literal text, not a reporter block`);
  }
  const shadowId = input.shadow ?? input.block;
  const shadow = shadowId ? blocks[shadowId] : undefined;
  const field = shadow?.fields ? Object.values(shadow.fields)[0] : undefined;
  if (!field) throw new Error(`${inputName} is missing`);
  return String(field.value ?? '');
}

function parseSchema(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error('args schema must be valid JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('args schema must be a JSON object');
  }
  const schema = value as Record<string, unknown>;
  if (schema.type !== 'object') throw new Error('args schema must have "type": "object"');
  return schema;
}
