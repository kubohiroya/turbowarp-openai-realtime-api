/** The narrow slice of the TurboWarp VM runtime this extension depends on. */

export interface SerializedField {
  value?: unknown;
}

export interface SerializedInput {
  block?: string | null;
  shadow?: string | null;
}

export interface SerializedBlock {
  id: string;
  opcode: string;
  topLevel?: boolean;
  shadow?: boolean;
  inputs?: Record<string, SerializedInput>;
  fields?: Record<string, SerializedField>;
}

export interface RuntimeTarget {
  isOriginal?: boolean;
  isStage?: boolean;
  getName?(): string;
  blocks: {_blocks: Record<string, SerializedBlock>};
}

export interface RuntimeThread {
  topBlock?: string;
}

export interface RuntimeLike {
  targets: RuntimeTarget[];
  threads: RuntimeThread[];
  startHats(opcode: string, matchFields?: Record<string, string>): RuntimeThread[] | undefined;
  on(event: string, listener: (...args: unknown[]) => void): void;
  off?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface BlockUtilityLike {
  thread?: RuntimeThread;
}
