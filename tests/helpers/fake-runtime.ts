import type {RuntimeLike, RuntimeThread} from '@kubohiroya/turbowarp-named-functions/composition';

type RuntimeTarget = RuntimeLike['targets'][number];
type SerializedBlock = RuntimeTarget['blocks']['_blocks'][string];

/** Minimal stand-in for the TurboWarp runtime: records startHats calls and lets tests drive steps. */
export class FakeRuntime implements RuntimeLike {
  public targets: RuntimeTarget[] = [];
  public threads: RuntimeThread[] = [];
  public readonly startedHats: string[] = [];
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  public startHats(opcode: string): RuntimeThread[] {
    this.startedHats.push(opcode);
    return [];
  }

  public on(event: string, listener: (...args: unknown[]) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  public emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  public step(): void {
    this.emit('AFTER_EXECUTE');
  }

  public spawnThread(): RuntimeThread {
    const thread: RuntimeThread = {topBlock: `thread-${this.threads.length}`};
    this.threads.push(thread);
    return thread;
  }

  public endThread(thread: RuntimeThread): void {
    this.threads = this.threads.filter((candidate) => candidate !== thread);
  }
}

export interface FunctionHatSpec {
  name: string;
  description?: string;
  schema?: string;
  exportAs?: 'tool' | 'none';
  /** Use a reporter block instead of literal text for this input. */
  reporterInput?: 'NAME' | 'DESCRIPTION' | 'SCHEMA';
}

/** Builds a target whose blocks container holds `define function` hats as the VM serializes them. */
export function targetWithFunctions(
  opcode: string,
  specs: readonly FunctionHatSpec[],
  name = 'Sprite1'
): RuntimeTarget {
  const blocks: Record<string, SerializedBlock> = {};
  specs.forEach((spec, index) => {
    const hatId = `hat${index}`;
    const inputs: Record<string, {block: string; shadow: string}> = {};
    const values = {
      NAME: spec.name,
      DESCRIPTION: spec.description ?? `Description of ${spec.name}`,
      SCHEMA: spec.schema ?? '{"type":"object","properties":{}}'
    };
    for (const [inputName, value] of Object.entries(values)) {
      const shadowId = `${hatId}_${inputName}`;
      blocks[shadowId] = {id: shadowId, opcode: 'text', shadow: true, topLevel: false, fields: {TEXT: {value}}};
      if (spec.reporterInput === inputName) {
        const reporterId = `${shadowId}_reporter`;
        blocks[reporterId] = {id: reporterId, opcode: 'data_variable', topLevel: false};
        inputs[inputName] = {block: reporterId, shadow: shadowId};
      } else {
        inputs[inputName] = {block: shadowId, shadow: shadowId};
      }
    }
    blocks[hatId] = {
      id: hatId,
      opcode,
      topLevel: true,
      inputs,
      fields: {EXPORT: {value: spec.exportAs ?? 'tool'}}
    };
  });
  return {isOriginal: true, isStage: false, getName: () => name, blocks: {_blocks: blocks}};
}
