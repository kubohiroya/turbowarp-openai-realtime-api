#!/usr/bin/env node
// Measures the bridge-mode cost of awaiting blocks and function-value calls on a headless TurboWarp VM.
//
//   SCRATCH_VM_PATH=/path/to/TurboWarp/scratch-vm node bench/bridge-latency.cjs
//
// Scenarios (all loops run inside a "run without screen refresh" custom block, as §3.1 requires):
//   sync     extension command that returns a plain value           (baseline, no Promise)
//   rpc      extension command that returns an already-resolved Promise (effect block via RPC, zero I/O)
//   rpc1ms   extension command whose Promise resolves after setTimeout(1ms) (RPC with ~1ms I/O)
//   call     function-value call: starts a `define function` hat and waits for its `return`
// Stepping modes:
//   fps=N    VM's own frame loop (setInterval at 1000/N ms), as in the TurboWarp editor
//   manual   harness calls runtime._step() itself and continues after setImmediate (headless test harness)

const path = require('path');
const vmPath = process.env.SCRATCH_VM_PATH || 'scratch-vm';
const VirtualMachine = require(vmPath);

const EXT = 'bench';

class BenchExtension {
    constructor (runtime) {
        this.runtime = runtime;
        this.count = 0;
        this.stepCount = 0;
        this.pendingCalls = [];
        this.callStartStep = 0;
        this.hatStartDelays = [];
        this.done = null;
    }

    getInfo () {
        const Scratch = {BlockType: {COMMAND: 'command', REPORTER: 'reporter', HAT: 'hat'}};
        return {
            id: EXT,
            name: 'Bench',
            blocks: [
                {opcode: 'whenRun', blockType: Scratch.BlockType.HAT, isEdgeActivated: false,
                    text: 'when run [SCENARIO]', arguments: {SCENARIO: {type: 'string', menu: 'scenarios'}}},
                {opcode: 'fn', blockType: Scratch.BlockType.HAT, isEdgeActivated: false,
                    text: 'define function [NAME]', arguments: {NAME: {type: 'string', menu: 'names'}}},
                {opcode: 'n', blockType: Scratch.BlockType.REPORTER, text: 'n'},
                {opcode: 'sync', blockType: Scratch.BlockType.COMMAND, text: 'sync op'},
                {opcode: 'rpc', blockType: Scratch.BlockType.COMMAND, text: 'rpc op'},
                {opcode: 'rpc1ms', blockType: Scratch.BlockType.COMMAND, text: 'rpc op 1ms'},
                {opcode: 'call', blockType: Scratch.BlockType.REPORTER, text: 'call function f'},
                {opcode: 'mark', blockType: Scratch.BlockType.COMMAND, text: 'mark hat start'},
                {opcode: 'ret', blockType: Scratch.BlockType.COMMAND, text: 'return 1'},
                {opcode: 'finish', blockType: Scratch.BlockType.COMMAND, text: 'finish'}
            ],
            menus: {
                scenarios: {acceptReporters: false, items: ['sync', 'rpc', 'rpc1ms', 'call']},
                names: {acceptReporters: false, items: ['f']}
            }
        };
    }

    whenRun () { return true; }
    fn () { return true; }
    n () { return this.count; }
    sync () { return 1; }
    rpc () { return Promise.resolve(1); }
    rpc1ms () { return new Promise(resolve => setTimeout(() => resolve(1), 1)); }
    call () {
        return new Promise(resolve => {
            this.pendingCalls.push(resolve);
            this.callStartStep = this.stepCount;
            this.runtime.startHats(`${EXT}_fn`, {NAME: 'f'});
        });
    }
    mark () { this.hatStartDelays.push(this.stepCount - this.callStartStep); }
    ret () {
        const resolve = this.pendingCalls.shift();
        if (resolve) resolve(1);
    }
    finish () { if (this.done) this.done(); }
}

// ---- project.json construction -------------------------------------------------------------

let nextId = 0;
const id = prefix => `${prefix}_${nextId++}`;

const buildProject = () => {
    const blocks = {};
    const add = (blockId, block) => {
        blocks[blockId] = Object.assign({next: null, parent: null, inputs: {}, fields: {}, shadow: false, topLevel: false}, block);
        return blockId;
    };

    // Warp custom block "loop <scenario>" : repeat (n) { <op> }
    const defineLoop = scenario => {
        const defId = id('def');
        const protoId = id('proto');
        const repeatId = id('repeat');
        const nId = id('n');
        const proccode = `loop ${scenario}`;
        const mutation = {tagName: 'mutation', children: [], proccode, argumentids: '[]',
            argumentnames: '[]', argumentdefaults: '[]', warp: 'true'};
        add(defId, {opcode: 'procedures_definition', topLevel: true, x: 0, y: 0,
            inputs: {custom_block: [1, protoId]}, next: repeatId});
        add(protoId, {opcode: 'procedures_prototype', parent: defId, shadow: true, mutation});
        add(nId, {opcode: `${EXT}_n`, parent: repeatId});
        let bodyId;
        if (scenario === 'call') {
            const setId = id('set');
            const callId = id('call');
            add(callId, {opcode: `${EXT}_call`, parent: setId});
            bodyId = add(setId, {opcode: 'data_setvariableto', parent: repeatId,
                inputs: {VALUE: [3, callId, [10, '']]}, fields: {VARIABLE: ['x', 'var_x']}});
        } else {
            bodyId = add(id('op'), {opcode: `${EXT}_${scenario}`, parent: repeatId});
        }
        add(repeatId, {opcode: 'control_repeat', parent: defId,
            inputs: {TIMES: [3, nId, [6, '10']], SUBSTACK: [2, bodyId]}});
        return proccode;
    };

    // "when run <scenario>" : loop <scenario> ; finish
    for (const scenario of ['sync', 'rpc', 'rpc1ms', 'call']) {
        const proccode = defineLoop(scenario);
        const hatId = id('hat');
        const callId = id('pcall');
        const finishId = id('finish');
        add(hatId, {opcode: `${EXT}_whenRun`, topLevel: true, x: 0, y: 0,
            fields: {SCENARIO: [scenario, null]}, next: callId});
        add(callId, {opcode: 'procedures_call', parent: hatId, next: finishId,
            mutation: {tagName: 'mutation', children: [], proccode, argumentids: '[]', warp: 'false'}});
        add(finishId, {opcode: `${EXT}_finish`, parent: callId});
    }

    // "define function f" : mark ; return 1
    const fnId = id('fn');
    const markId = id('mark');
    const retId = id('ret');
    add(fnId, {opcode: `${EXT}_fn`, topLevel: true, x: 0, y: 0, fields: {NAME: ['f', null]}, next: markId});
    add(markId, {opcode: `${EXT}_mark`, parent: fnId, next: retId});
    add(retId, {opcode: `${EXT}_ret`, parent: markId});

    const baseTarget = {variables: {}, lists: {}, broadcasts: {}, comments: {}, currentCostume: 0,
        costumes: [{name: 'c', assetId: 'cd21514d0531fdffb22204e0ec5ed84a', md5ext: 'cd21514d0531fdffb22204e0ec5ed84a.svg',
            dataFormat: 'svg', rotationCenterX: 0, rotationCenterY: 0}],
        sounds: [], volume: 100, layerOrder: 0};
    return {
        targets: [
            Object.assign({}, baseTarget, {isStage: true, name: 'Stage', blocks: {}, tempo: 60,
                videoTransparency: 50, videoState: 'off', textToSpeechLanguage: null}),
            Object.assign({}, baseTarget, {isStage: false, name: 'S', blocks, layerOrder: 1,
                variables: {var_x: ['x', 0]}, visible: true, x: 0, y: 0, size: 100, direction: 90,
                draggable: false, rotationStyle: 'all around'})
        ],
        monitors: [],
        extensions: [EXT],
        meta: {semver: '3.0.0', vm: '0.2.0', agent: 'bench'}
    };
};

// ---- harness ---------------------------------------------------------------------------------

const createVm = async () => {
    const vm = new VirtualMachine();
    vm.setCompilerOptions({enabled: true});
    const ext = new BenchExtension(vm.runtime);
    const serviceName = vm.extensionManager._registerInternalExtension(ext);
    vm.extensionManager._loadedExtensions.set(EXT, serviceName);
    const originalStep = vm.runtime._step.bind(vm.runtime);
    vm.runtime._step = () => {
        ext.stepCount++;
        originalStep();
    };
    await vm.loadProject(buildProject());
    return {vm, ext};
};

const runScenario = async ({vm, ext}, scenario, mode, n) => {
    ext.count = n;
    ext.hatStartDelays = [];
    const finished = new Promise(resolve => { ext.done = resolve; });
    const startStep = ext.stepCount;
    const t0 = process.hrtime.bigint();
    vm.runtime.startHats(`${EXT}_whenRun`, {SCENARIO: scenario});
    if (mode === 'manual') {
        let over = false;
        finished.then(() => { over = true; });
        vm.runtime.currentStepTime = 1000 / 60;
        while (!over) {
            vm.runtime._step();
            await new Promise(resolve => setImmediate(resolve));
        }
    } else {
        await finished;
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const steps = ext.stepCount - startStep;
    const sameFrame = ext.hatStartDelays.length ?
        `${ext.hatStartDelays.filter(d => d === 0).length}/${ext.hatStartDelays.length}` : '-';
    return {scenario, mode, n, msPerOp: ms / n, stepsPerOp: steps / n, sameFrame};
};

const main = async () => {
    const modes = [
        {mode: 'fps=30', fps: 30, n: 60},
        {mode: 'fps=60', fps: 60, n: 120},
        {mode: 'fps=250', fps: 250, n: 500},
        {mode: 'manual', fps: null, n: 2000}
    ];
    const rows = [];
    for (const {mode, fps, n} of modes) {
        const ctx = await createVm();
        if (fps) {
            ctx.vm.setFramerate(fps);
            ctx.vm.start();
        }
        // warm-up: compile scripts
        for (const scenario of ['sync', 'rpc', 'rpc1ms', 'call']) {
            await runScenario(ctx, scenario, fps ? 'loop' : 'manual', 3);
        }
        for (const scenario of ['sync', 'rpc', 'rpc1ms', 'call']) {
            const r = await runScenario(ctx, scenario, fps ? 'loop' : 'manual', n);
            r.mode = mode;
            rows.push(r);
        }
        ctx.vm.stop();
        ctx.vm.quit?.();
    }
    console.log(`node ${process.version}, scratch-vm ${require(path.join(vmPath, 'package.json')).version}`);
    console.log('| mode | scenario | n | ms/op | steps/op | fn hat starts in caller\'s step |');
    console.log('|---|---|---|---|---|---|');
    for (const r of rows) {
        console.log(`| ${r.mode} | ${r.scenario} | ${r.n} | ${r.msPerOp.toFixed(3)} | ${r.stepsPerOp.toFixed(2)} | ${r.sameFrame} |`);
    }
    process.exit(0);
};

main().catch(e => {
    console.error(e);
    process.exit(1);
});
