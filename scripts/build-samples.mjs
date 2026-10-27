import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import console from 'node:console';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {basename, resolve} from 'node:path';
import process from 'node:process';
import {fileURLToPath, URL} from 'node:url';
import {crc32} from 'node:zlib';

const root = new URL('../', import.meta.url);
export const manifest = JSON.parse(await readFile(new URL('samples/manifest.json', root), 'utf8'));

// ZIP STORE with fixed timestamps keeps committed SB3s reproducible without dependencies.
function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const filename = Buffer.from(name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    header.copy(directory, 6, 4, 30);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, filename);
    offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.size, 8);
  end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export async function buildSamples({check = false} = {}) {
  const {extension, baseURL, samples} = manifest;
  const base = new URL(baseURL);
  assert.equal(base.protocol, 'https:');
  assert.ok(base.href.endsWith('/'), 'baseURL must end with /');
  assert.match(extension.id, /^[a-zA-Z0-9]+$/);
  assert.match(extension.bundle, /^dist\/[a-zA-Z0-9-]+\.js$/);
  assert.equal(typeof extension.unsandboxed, 'boolean', 'Declare the sandbox requirement explicitly');
  const bundle = await readFile(new URL(extension.bundle, root), 'utf8');
  assert.ok(bundle.includes(`// ID: ${extension.id}\n`), 'Bundle ID must match samples/manifest.json');
  const definitions = JSON.parse(await readFile(new URL('src/block-definitions.json', root), 'utf8'));
  const opcodes = new Set(definitions.blocks.filter(block => block.opcode).map(block => `${extension.id}_${block.opcode}`));
  const menuOpcodes = new Set(definitions.blocks.flatMap(block =>
    Object.values(block.arguments ?? {}).filter(arg => arg.menu).map(arg => `${extension.id}_menu_${arg.menu}`)
  ));
  const names = new Set();
  assert.ok(samples.length > 0, 'Provide at least one sample');
  for (const sample of samples) {
    assert.match(sample.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(!names.has(sample.name), 'Sample names must be unique');
    names.add(sample.name);
    const source = new URL(`samples/${sample.name}/`, root);
    const project = JSON.parse(await readFile(new URL('project.json', source), 'utf8'));
    assert.equal(project.targets.filter(target => target.isStage).length, 1);
    assert.equal(project.targets[0].isStage, true);
    const entries = new Map();
    let extensionBlocks = 0;
    for (const target of project.targets) {
      const blocks = target.blocks;
      for (const [id, block] of Object.entries(blocks)) {
        if (block.opcode.startsWith(`${extension.id}_`)) {
          assert.ok(opcodes.has(block.opcode) || menuOpcodes.has(block.opcode), `Unknown extension opcode: ${block.opcode}`);
          if (opcodes.has(block.opcode)) extensionBlocks++;
        }
        for (const reference of [block.next, block.parent]) {
          assert.ok(reference === null || Object.hasOwn(blocks, reference), `Broken block reference in ${id}`);
        }
        for (const input of Object.values(block.inputs)) {
          for (const reference of input.slice(1)) {
            if (typeof reference === 'string') assert.ok(Object.hasOwn(blocks, reference), `Broken input in ${id}`);
          }
        }
      }
      for (const asset of [...target.costumes, ...target.sounds]) {
        assert.equal(basename(asset.md5ext), asset.md5ext, 'Assets must be local filenames');
        const data = await readFile(new URL(asset.md5ext, source));
        asset.assetId = createHash('md5').update(data).digest('hex');
        asset.md5ext = `${asset.assetId}.${asset.dataFormat}`;
        entries.set(asset.md5ext, data);
      }
    }
    assert.ok(extensionBlocks > 0, 'Each sample must use this extension');
    const dependencies = extension.dependencies ?? [];
    for (const dep of dependencies) {
      assert.match(dep.id, /^[a-zA-Z0-9]+$/);
      assert.equal(new URL(dep.url).origin, 'https://extensions.turbowarp.org');
    }
    project.extensions = [...dependencies.map(dep => dep.id), extension.id];
    // TurboWarp offers the unsandboxed consent checkbox for embedded data URLs.
    // Arbitrary HTTPS extension URLs from projects are always loaded sandboxed.
    const extensionURL = extension.unsandboxed
      ? `data:application/javascript;base64,${Buffer.from(bundle).toString('base64')}`
      : new URL(extension.bundle, base).href;
    project.extensionURLs = Object.fromEntries([...dependencies.map(dep => [dep.id, dep.url]), [extension.id, extensionURL]]);
    entries.set('project.json', Buffer.from(`${JSON.stringify(project)}\n`));
    const output = new URL(`samples/${sample.name}.sb3`, root);
    const archive = zip(entries);
    if (check) {
      assert.deepEqual(await readFile(output), archive, `Stale sample: ${sample.name}; run samples:build`);
    } else {
      await writeFile(output, archive);
    }
    console.log(`${check ? 'Verified' : 'Built'} ${fileURLToPath(output)}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await buildSamples({check: process.argv.includes('--check')});
}
