import type {RuntimeLike, RuntimeThread} from './runtime-types.js';

/**
 * Runs `define function` hats as named functions.
 *
 * A call starts every `define function` hat; the hat predicate lets only the script whose NAME
 * matches the invocation being started continue, and binds that thread to the invocation. Extension
 * hats are not restarted while running, so calls to the same name are queued and run one at a time.
 *
 * The next invocation is started only between steps (or directly from outside a step). Inside a step,
 * the hats that failed their predicate and the script that just returned still count as running
 * threads, so starting hats there would silently skip them.
 */

export interface FunctionDispatcherOptions {
  hatOpcode: string;
  /** Names that have a `define function` hat. Used to fail fast on unknown names. */
  knownNames: () => ReadonlySet<string>;
  timeoutMs?: number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface Invocation {
  name: string;
  args: unknown;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  thread: RuntimeThread | null;
  startedAtStep: number;
  timer: unknown;
  settled: boolean;
}

export const DEFAULT_FUNCTION_TIMEOUT_MS = 30_000;

export class FunctionDispatcher {
  private readonly queue: Invocation[] = [];
  private readonly running = new Map<string, Invocation>();
  private readonly byThread = new Map<RuntimeThread, Invocation>();
  private starting: Invocation | null = null;
  private step = 0;
  private readonly timeoutMs: number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  public constructor(
    private readonly runtime: RuntimeLike,
    private readonly options: FunctionDispatcherOptions
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_FUNCTION_TIMEOUT_MS;
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    runtime.on('AFTER_EXECUTE', () => this.afterStep());
    runtime.on('PROJECT_STOP_ALL', () => this.cancelAll('The project was stopped.'));
  }

  public invoke(name: string, args: unknown): Promise<unknown> {
    if (!this.options.knownNames().has(name)) {
      return Promise.reject(new Error(`Unknown function: ${name}`));
    }
    return new Promise((resolve, reject) => {
      const invocation: Invocation = {
        name, args, resolve, reject, thread: null, startedAtStep: -1, timer: null, settled: false
      };
      invocation.timer = this.setTimer(
        () => this.settle(invocation, new Error(`Function ${name} timed out.`)),
        this.timeoutMs
      );
      this.queue.push(invocation);
      this.pump();
    });
  }

  /** Hat predicate: true only for the script that should run the invocation being started. */
  public matchHat(name: string, thread: RuntimeThread | undefined): boolean {
    const invocation = this.starting;
    if (!invocation || !thread || invocation.name !== name.trim()) return false;
    invocation.thread = thread;
    this.byThread.set(thread, invocation);
    this.starting = null;
    return true;
  }

  public argumentsFor(thread: RuntimeThread | undefined): unknown {
    const invocation = thread ? this.byThread.get(thread) : undefined;
    if (!invocation) throw new Error('This block can only be used inside a running function.');
    return invocation.args;
  }

  public returnFrom(thread: RuntimeThread | undefined, value: unknown): void {
    const invocation = thread ? this.byThread.get(thread) : undefined;
    if (!invocation) throw new Error('return can only be used inside a running function.');
    this.settle(invocation, null, value);
  }

  public cancelAll(reason: string): void {
    for (const invocation of [...this.queue, ...this.running.values()]) {
      this.settle(invocation, new Error(reason));
    }
    if (this.starting) this.settle(this.starting, new Error(reason));
  }

  public get pendingCount(): number {
    return this.queue.length + this.running.size;
  }

  private pump(): void {
    if (this.starting) return;
    const index = this.queue.findIndex((invocation) => !this.running.has(invocation.name));
    if (index < 0) return;
    const [invocation] = this.queue.splice(index, 1);
    if (!invocation) return;
    this.running.set(invocation.name, invocation);
    this.starting = invocation;
    invocation.startedAtStep = this.step;
    this.runtime.startHats(this.options.hatOpcode);
  }

  private afterStep(): void {
    this.step += 1;
    const starting = this.starting;
    // A started hat is evaluated within the current or the next step (measured with bench/).
    if (starting && this.step - starting.startedAtStep > 2) {
      this.settle(starting, new Error(`Function ${starting.name} did not start. Is its script already running?`));
    }
    for (const invocation of this.running.values()) {
      if (invocation.thread && !this.runtime.threads.includes(invocation.thread)) {
        // The script ended without `return`.
        this.settle(invocation, null, null);
      }
    }
    this.pump();
  }

  private settle(invocation: Invocation, error: Error | null, value?: unknown): void {
    if (invocation.settled) return;
    invocation.settled = true;
    this.clearTimer(invocation.timer);
    const queued = this.queue.indexOf(invocation);
    if (queued >= 0) this.queue.splice(queued, 1);
    if (this.running.get(invocation.name) === invocation) this.running.delete(invocation.name);
    if (invocation.thread) this.byThread.delete(invocation.thread);
    if (this.starting === invocation) this.starting = null;
    if (error) invocation.reject(error);
    else invocation.resolve(value);
  }
}

/** Resolves a dotted path such as `items.0.name` inside parsed JSON arguments. */
export function readArgumentPath(args: unknown, path: string): unknown {
  const trimmed = path.trim();
  if (trimmed.length === 0) return args;
  let current: unknown = args;
  for (const segment of trimmed.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Converts a Scratch value for display in a reporter: objects become JSON text. */
export function toScratchValue(value: unknown): string | number | boolean {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return JSON.stringify(value);
}

/** `return [VALUE]`: JSON text is returned as JSON, anything else as a string. */
export function parseReturnValue(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return text;
  }
}
