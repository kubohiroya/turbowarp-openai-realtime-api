import {
  createExtensionManifest,
  serializeExtensionManifest
} from '@kubohiroya/turbowarp-extension-manifest';
import {describe, expect, it} from 'vitest';
import definitions from '../src/block-definitions.json';
import {extensionConfig} from '../src/config.js';

describe('extension API manifest', () => {
  it('serializes the canonical block definitions deterministically', () => {
    const first = serializeExtensionManifest(extensionConfig.id, definitions);
    const second = serializeExtensionManifest(extensionConfig.id, structuredClone(definitions));
    const manifest = createExtensionManifest(extensionConfig.id, definitions);

    expect(first).toBe(second);
    expect(first).toBe(`${JSON.stringify(manifest, null, 2)}\n`);
    expect(manifest.id).toBe(extensionConfig.id);
    expect(manifest.blocks).toHaveLength(definitions.blocks.length);
    expect(manifest.blocks.map((block) => block.opcode)).toEqual(
      definitions.blocks.map((block) => block.opcode).sort()
    );
  });

  it('declares every menu a block argument references', () => {
    const manifest = createExtensionManifest(extensionConfig.id, definitions);
    const declared = new Set(manifest.menus.map((menu) => menu.id));
    const referenced = manifest.blocks.flatMap((block) =>
      block.arguments.flatMap((argument) => (argument.menu === undefined ? [] : [argument.menu]))
    );

    expect([...new Set(referenced)].filter((menu) => !declared.has(menu))).toEqual([]);
  });
});
