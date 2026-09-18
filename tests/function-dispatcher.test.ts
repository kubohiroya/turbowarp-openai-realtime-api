import {describe, expect, it} from 'vitest';
import {
  FunctionDispatcher,
  parseReturnValue,
  readArgumentPath,
  toScratchValue
} from '../src/function-dispatcher.js';
import {FakeRuntime} from './helpers/fake-runtime.js';

const OPCODE = 'ext_defineFunction';

function setup(names = ['f', 'g'], timeoutMs = 30_000) {
  const runtime = new FakeRuntime();
  const timers: Array<{callback: () => void; ms: number; cleared: boolean}> = [];
  const dispatcher = new FunctionDispatcher(runtime, {
    hatOpcode: OPCODE,
    knownNames: () => new Set(names),
    timeoutMs,
    setTimer: (callback, ms) => {
      const timer = {callback, ms, cleared: false};
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as {cleared: boolean}).cleared = true;
    }
  });
  return {runtime, dispatcher, timers};
}

/** Simulates the VM evaluating the started hats: the one named `name` matches. */
function runHat(runtime: FakeRuntime, dispatcher: FunctionDispatcher, name: string) {
  const thread = runtime.spawnThread();
  const matched = dispatcher.matchHat(name, thread);
  return {thread, matched};
}

describe('FunctionDispatcher', () => {
  it('starts the hats, binds the matching thread, and resolves on return', async () => {
    const {runtime, dispatcher} = setup();
    const result = dispatcher.invoke('f', {x: 1});
    expect(runtime.startedHats).toEqual([OPCODE]);
    expect(dispatcher.matchHat('g', runtime.spawnThread())).toBe(false);
    const {thread, matched} = runHat(runtime, dispatcher, 'f');
    expect(matched).toBe(true);
    expect(dispatcher.argumentsFor(thread)).toEqual({x: 1});
    dispatcher.returnFrom(thread, {ok: true});
    await expect(result).resolves.toEqual({ok: true});
  });

  it('resolves null when the script ends without return', async () => {
    const {runtime, dispatcher} = setup();
    const result = dispatcher.invoke('f', {});
    const {thread} = runHat(runtime, dispatcher, 'f');
    runtime.endThread(thread);
    runtime.step();
    await expect(result).resolves.toBeNull();
  });

  it('queues calls to the same name and runs different names concurrently', async () => {
    const {runtime, dispatcher} = setup();
    const first = dispatcher.invoke('f', 1);
    const second = dispatcher.invoke('f', 2);
    const other = dispatcher.invoke('g', 3);
    const f1 = runHat(runtime, dispatcher, 'f');
    // The next invocation starts only after the step ends.
    expect(runtime.startedHats).toHaveLength(1);
    runtime.step();
    // f is running, so the next invocation started is g, not the second f.
    expect(runtime.startedHats).toHaveLength(2);
    const g1 = runHat(runtime, dispatcher, 'g');
    expect(dispatcher.argumentsFor(g1.thread)).toBe(3);
    runtime.step();
    expect(runtime.startedHats).toHaveLength(2);
    dispatcher.returnFrom(f1.thread, 'one');
    expect(runtime.startedHats).toHaveLength(2);
    runtime.step();
    expect(runtime.startedHats).toHaveLength(3);
    const f2 = runHat(runtime, dispatcher, 'f');
    expect(dispatcher.argumentsFor(f2.thread)).toBe(2);
    dispatcher.returnFrom(f2.thread, 'two');
    dispatcher.returnFrom(g1.thread, 'three');
    await expect(Promise.all([first, second, other])).resolves.toEqual(['one', 'two', 'three']);
  });

  it('rejects unknown names without starting hats', async () => {
    const {runtime, dispatcher} = setup();
    await expect(dispatcher.invoke('missing', {})).rejects.toThrow('Unknown function');
    expect(runtime.startedHats).toEqual([]);
  });

  it('fails an invocation whose hat never starts', async () => {
    const {runtime, dispatcher} = setup();
    const result = dispatcher.invoke('f', {});
    runtime.step();
    runtime.step();
    runtime.step();
    await expect(result).rejects.toThrow('did not start');
  });

  it('times out and clears timers on settle', async () => {
    const {runtime, dispatcher, timers} = setup(['f'], 5);
    const result = dispatcher.invoke('f', {});
    runHat(runtime, dispatcher, 'f');
    timers[0]?.callback();
    await expect(result).rejects.toThrow('timed out');
    runtime.step();
    const second = dispatcher.invoke('f', {});
    const {thread} = runHat(runtime, dispatcher, 'f');
    dispatcher.returnFrom(thread, 1);
    await second;
    expect(timers[1]?.cleared).toBe(true);
  });

  it('cancels everything when the project stops', async () => {
    const {runtime, dispatcher} = setup();
    const running = dispatcher.invoke('f', {});
    const queued = dispatcher.invoke('f', {});
    runHat(runtime, dispatcher, 'f');
    runtime.emit('PROJECT_STOP_ALL');
    await expect(running).rejects.toThrow('stopped');
    await expect(queued).rejects.toThrow('stopped');
    expect(dispatcher.pendingCount).toBe(0);
  });

  it('throws when argument blocks are used outside a function', () => {
    const {runtime, dispatcher} = setup();
    expect(() => dispatcher.argumentsFor(runtime.spawnThread())).toThrow('inside a running function');
    expect(() => dispatcher.returnFrom(undefined, 1)).toThrow('inside a running function');
  });
});

describe('helpers', () => {
  it('reads dotted argument paths', () => {
    const args = {city: 'Tokyo', items: [{name: 'a'}]};
    expect(readArgumentPath(args, 'city')).toBe('Tokyo');
    expect(readArgumentPath(args, 'items.0.name')).toBe('a');
    expect(readArgumentPath(args, 'missing.x')).toBeUndefined();
    expect(readArgumentPath(args, '')).toBe(args);
  });

  it('converts values for reporters', () => {
    expect(toScratchValue(undefined)).toBe('');
    expect(toScratchValue(3)).toBe(3);
    expect(toScratchValue({a: 1})).toBe('{"a":1}');
  });

  it('parses return values', () => {
    expect(parseReturnValue('{"score":10}')).toEqual({score: 10});
    expect(parseReturnValue('42')).toBe(42);
    expect(parseReturnValue('hello')).toBe('hello');
    expect(parseReturnValue('  ')).toBe('');
  });
});
