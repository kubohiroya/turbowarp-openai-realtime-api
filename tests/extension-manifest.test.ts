import {describe, expect, it} from 'vitest';
import schema from '../schemas/extension-manifest.schema.json';
import {
  createExtensionManifest,
  EXTENSION_MANIFEST_FORMAT_VERSION,
  serializeExtensionManifest
} from '../src/extension-manifest.js';
import expectedManifest from './fixtures/extension-manifest.json';
import sourceFixture from './fixtures/extension-manifest-source.json';

describe('extension API manifest', () => {
  it('serializes a fixture deterministically', () => {
    expect(createExtensionManifest(sourceFixture.id, sourceFixture.definitions)).toEqual(
      expectedManifest
    );
    expect(serializeExtensionManifest(sourceFixture.id, sourceFixture.definitions)).toBe(
      `${JSON.stringify(expectedManifest, null, 2)}\n`
    );
  });

  it('keeps the JSON Schema format version aligned with the generator', () => {
    expect(schema.properties.formatVersion.const).toBe(EXTENSION_MANIFEST_FORMAT_VERSION);
  });

  it('rejects duplicate opcodes', () => {
    expect(() =>
      createExtensionManifest('fixtureextension', {
        blocks: [
          {opcode: 'same', blockType: 'COMMAND'},
          {opcode: 'same', blockType: 'REPORTER'}
        ]
      })
    ).toThrow('Duplicate block opcode: same');
  });

  it('rejects an argument that references an unknown menu', () => {
    expect(() =>
      createExtensionManifest('fixtureextension', {
        blocks: [
          {
            opcode: 'choose',
            blockType: 'REPORTER',
            arguments: {VALUE: {type: 'STRING', menu: 'missing'}}
          }
        ]
      })
    ).toThrow('references unknown menu: missing');
  });
});
