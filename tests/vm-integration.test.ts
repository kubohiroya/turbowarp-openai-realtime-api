// Runs `define function` hats on a real headless TurboWarp VM.
// Skipped unless SCRATCH_VM_PATH points at a TurboWarp scratch-vm checkout, e.g.
//   SCRATCH_VM_PATH=/path/to/TurboWarp/scratch-vm pnpm test
import {createRequire} from 'node:module';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import type {RuntimeLike} from '../src/runtime-types.js';

const vmPath = process.env.SCRATCH_VM_PATH;
const ID = 'kubohiroyaopenairealtime';

interface VirtualMachineLike {
  runtime: RuntimeLike & {
    setFramerate?(fps: number): void;
    getSpriteTargetByName(name: string): {lookupVariableByNameAndType(name: string, type: string): {value: unknown}};
  };
  extensionManager: {
    _registerInternalExtension(extension: unknown): string;
    _loadedExtensions: Map<string, string>;
  };
  setCompilerOptions(options: {enabled: boolean}): void;
  setFramerate(fps: number): void;
  loadProject(project: unknown): Promise<void>;
  start(): void;
  stop(): void;
}

type Block = Record<string, unknown>;

function buildProject() {
  const blocks: Record<string, Block> = {};
  const add = (id: string, block: Block) => {
    blocks[id] = {next: null, parent: null, inputs: {}, fields: {}, shadow: false, topLevel: false, ...block};
  };
  const defineFunction = (hatId: string, name: string, next: string) =>
    add(hatId, {
      opcode: `${ID}_defineFunction`,
      topLevel: true,
      x: 0,
      y: 0,
      next,
      inputs: {
        NAME: [1, [10, name]],
        DESCRIPTION: [1, [10, `Function ${name}`]],
        SCHEMA: [1, [10, '{"type":"object","properties":{}}']]
      },
      fields: {EXPORT: ['tool', null]}
    });

  // define function greet: return (join "hello " (function argument "player.name")); set marker to "after"
  defineFunction('greet', 'greet', 'greetReturn');
  add('greetArg', {opcode: `${ID}_functionArgument`, parent: 'greetJoin', inputs: {PATH: [1, [10, 'player.name']]}});
  add('greetJoin', {
    opcode: 'operator_join',
    parent: 'greetReturn',
    inputs: {STRING1: [1, [10, 'hello ']], STRING2: [3, 'greetArg', [10, '']]}
  });
  add('greetReturn', {
    opcode: `${ID}_returnValue`,
    parent: 'greet',
    next: 'greetAfter',
    inputs: {VALUE: [3, 'greetJoin', [10, '']]}
  });
  add('greetAfter', {
    opcode: 'data_setvariableto',
    parent: 'greetReturn',
    inputs: {VALUE: [1, [10, 'after']]},
    fields: {VARIABLE: ['marker', 'var_marker']}
  });

  // define function silent: set marker to "silent" (no return)
  defineFunction('silent', 'silent', 'silentSet');
  add('silentSet', {
    opcode: 'data_setvariableto',
    parent: 'silent',
    inputs: {VALUE: [1, [10, 'silent']]},
    fields: {VARIABLE: ['marker', 'var_marker']}
  });

  // define function echo: return (function arguments JSON)
  defineFunction('echo', 'echo', 'echoReturn');
  add('echoArgs', {opcode: `${ID}_functionArgumentsJson`, parent: 'echoReturn'});
  add('echoReturn', {opcode: `${ID}_returnValue`, parent: 'echo', inputs: {VALUE: [3, 'echoArgs', [10, '']]}});

  const base = {
    variables: {},
    lists: {},
    broadcasts: {},
    comments: {},
    currentCostume: 0,
    costumes: [{name: 'c', assetId: 'cd21514d0531fdffb22204e0ec5ed84a', md5ext: 'cd21514d0531fdffb22204e0ec5ed84a.svg', dataFormat: 'svg', rotationCenterX: 0, rotationCenterY: 0}],
    sounds: [],
    volume: 100,
    layerOrder: 0
  };
  return {
    targets: [
      {...base, isStage: true, name: 'Stage', blocks: {}, tempo: 60, videoTransparency: 50, videoState: 'off', textToSpeechLanguage: null},
      {...base, isStage: false, name: 'S', blocks, layerOrder: 1, variables: {var_marker: ['marker', '']}, visible: true, x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around'}
    ],
    monitors: [],
    extensions: [ID],
    meta: {semver: '3.0.0', vm: '0.2.0', agent: 'test'}
  };
}

describe.skipIf(!vmPath)('define function on a real TurboWarp VM', () => {
  let vm: VirtualMachineLike;
  let call: (name: string, args: unknown) => Promise<unknown>;
  const marker = () => vm.runtime.getSpriteTargetByName('S').lookupVariableByNameAndType('marker', '').value;

  beforeAll(async () => {
    vi.stubGlobal('Scratch', {
      BlockType: {COMMAND: 'command', REPORTER: 'reporter', BOOLEAN: 'Boolean', HAT: 'hat'},
      ArgumentType: {STRING: 'string', NUMBER: 'number', BOOLEAN: 'Boolean'},
      Cast: {toString: (value: unknown) => String(value)},
      translate: (message: string | {default: string}) => (typeof message === 'string' ? message : message.default)
    });
    const require = createRequire(import.meta.url);
    const VirtualMachine = require(vmPath as string) as new () => VirtualMachineLike;
    const {OpenAIRealtimeExtension} = await import('../src/extension.js');
    vm = new VirtualMachine();
    vm.setCompilerOptions({enabled: true});
    const extension = new OpenAIRealtimeExtension({runtime: vm.runtime});
    const serviceName = vm.extensionManager._registerInternalExtension(extension);
    vm.extensionManager._loadedExtensions.set(ID, serviceName);
    await vm.loadProject(buildProject());
    vm.setFramerate(250);
    vm.start();
    call = (name, args) =>
      (extension as unknown as {callExportedFunction(name: string, args: unknown): Promise<unknown>}).callExportedFunction(name, args);
  });

  afterAll(() => {
    vm?.stop();
    vi.unstubAllGlobals();
  });

  it('runs only the matching hat and returns its value', async () => {
    await expect(call('greet', {player: {name: 'Ada'}})).resolves.toBe('hello Ada');
  });

  it('stops the script at return', async () => {
    await call('greet', {player: {name: 'Bo'}});
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(marker()).not.toBe('after');
  });

  it('resolves null when the script ends without return', async () => {
    await expect(call('silent', {})).resolves.toBeNull();
    expect(marker()).toBe('silent');
  });

  it('gives each invocation its own arguments, queued per name', async () => {
    const results = await Promise.all([
      call('echo', {n: 1}),
      call('echo', {n: 2}),
      call('greet', {player: {name: 'Cy'}}),
      call('echo', {n: 3})
    ]);
    expect(results).toEqual([{n: 1}, {n: 2}, 'hello Cy', {n: 3}]);
  });
});
