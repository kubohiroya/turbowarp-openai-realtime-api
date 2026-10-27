import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import {test} from 'node:test';
import {URL} from 'node:url';

const root = new URL('../', import.meta.url);

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'turbowarp-samples-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  for (const path of ['scripts', 'samples', 'src/block-definitions.json', 'site', 'dist']) {
    await cp(new URL(path, root), join(dir, path), {recursive: true});
  }
  const manifest = JSON.parse(await readFile(join(dir, 'samples/manifest.json'), 'utf8'));
  return {dir, name: manifest.samples[0].name};
}

function run(dir, script, ...args) {
  return spawnSync(process.execPath, [`scripts/${script}.mjs`, ...args], {cwd: dir, encoding: 'utf8'});
}

test('the committed SB3s are current and builds are byte-for-byte reproducible', async t => {
  const {dir, name} = await fixture(t);
  const path = join(dir, `samples/${name}.sb3`);
  const before = await readFile(path);
  const checked = run(dir, 'build-samples', '--check');
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(run(dir, 'build-samples').status, 0);
  assert.deepEqual(await readFile(path), before);
});

test('stale assets fail check without overwriting the distributed sample', async t => {
  const {dir, name} = await fixture(t);
  const path = join(dir, `samples/${name}.sb3`);
  const before = await readFile(path);
  const backdrop = join(dir, `samples/${name}/backdrop.svg`);
  await writeFile(backdrop, `${await readFile(backdrop, 'utf8')}\n`);
  const checked = run(dir, 'build-samples', '--check');
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /Stale sample/);
  assert.deepEqual(await readFile(path), before);
});

test('an extension block removed from the definitions is rejected', async t => {
  const {dir} = await fixture(t);
  const path = join(dir, 'src/block-definitions.json');
  const definitions = JSON.parse(await readFile(path, 'utf8'));
  definitions.blocks = [];
  await writeFile(path, JSON.stringify(definitions));
  const checked = run(dir, 'build-samples', '--check');
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /Unknown extension opcode/);
});

test('broken block references are rejected before generating a project', async t => {
  const {dir, name} = await fixture(t);
  const path = join(dir, `samples/${name}/project.json`);
  const project = JSON.parse(await readFile(path, 'utf8'));
  Object.values(project.targets[0].blocks)[0].next = 'missing-block';
  await writeFile(path, JSON.stringify(project));
  const checked = run(dir, 'build-samples', '--check');
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /Broken block reference/);
});

test('a manifest with the wrong bundle ID is rejected', async t => {
  const {dir} = await fixture(t);
  const path = join(dir, 'samples/manifest.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.extension.id = 'wrongid';
  await writeFile(path, JSON.stringify(manifest));
  const checked = run(dir, 'build-samples', '--check');
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /Bundle ID/);
});

test('the Pages artifact contains directly downloadable SB3 and JS files', async t => {
  const {dir, name} = await fixture(t);
  const built = run(dir, 'prepare-pages');
  assert.equal(built.status, 0, built.stderr);
  assert.deepEqual(await readFile(join(dir, `_site/samples/${name}.sb3`)), await readFile(join(dir, `samples/${name}.sb3`)));
  const manifest = JSON.parse(await readFile(join(dir, 'samples/manifest.json'), 'utf8'));
  assert.deepEqual(await readFile(join(dir, '_site', manifest.extension.bundle)), await readFile(join(dir, manifest.extension.bundle)));
  await assert.rejects(readFile(join(dir, `_site/samples/${name}/project.json`)), {code: 'ENOENT'});
});

test('the sample ships blank settings, has no audio assets, and keeps start actions behind user clicks', async () => {
  const manifest = JSON.parse(await readFile(new URL('samples/manifest.json', root), 'utf8'));
  for (const sample of manifest.samples) {
    const project = JSON.parse(await readFile(new URL(`samples/${sample.name}/project.json`, root), 'utf8'));
    const stage = project.targets[0];
    assert.equal(stage.variables['sample-endpoint'][1], '');
    assert.equal(stage.variables['sample-alias'][1], '');
    assert.ok(project.targets.every(target => target.sounds.length === 0));
    assert.ok(!JSON.stringify(project).includes('_sendCommand'));
    let block = Object.values(stage.blocks).find(block => block.opcode === 'event_whenflagclicked');
    while (block) {
      assert.ok(!/_(pairRelay|connect|startConversation|getStatusField|sendText|speak)$/.test(block.opcode), `External action on green flag: ${block.opcode}`);
      block = block.next ? stage.blocks[block.next] : null;
    }
  }
});
