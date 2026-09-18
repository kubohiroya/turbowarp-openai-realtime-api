import {describe, expect, it} from 'vitest';
import {scanFunctionDefinitions, toFunctionTools} from '../src/function-registry.js';
import {targetWithFunctions} from './helpers/fake-runtime.js';

const OPCODE = 'ext_defineFunction';

describe('scanFunctionDefinitions', () => {
  it('reads literal hat inputs into sorted definitions', () => {
    const target = targetWithFunctions(OPCODE, [
      {name: 'set_color', description: 'Sets the color.', schema: '{"type":"object","properties":{"color":{"type":"string"}}}'},
      {name: 'get_score', exportAs: 'none', description: ''}
    ]);
    const scan = scanFunctionDefinitions([target], OPCODE);
    expect(scan.errors).toEqual([]);
    expect(scan.functions.map((definition) => definition.name)).toEqual(['get_score', 'set_color']);
    expect(scan.functions[1]).toMatchObject({
      description: 'Sets the color.',
      parameters: {type: 'object', properties: {color: {type: 'string'}}},
      exportAs: 'tool',
      targetName: 'Sprite1'
    });
  });

  it('exports only tool functions', () => {
    const scan = scanFunctionDefinitions(
      [targetWithFunctions(OPCODE, [{name: 'a'}, {name: 'b', exportAs: 'none'}])],
      OPCODE
    );
    expect(toFunctionTools(scan.functions)).toEqual([
      {type: 'function', name: 'a', description: 'Description of a', parameters: {type: 'object', properties: {}}}
    ]);
  });

  it.each([
    [{name: 'bad name'}, 'function name'],
    [{name: 'a', schema: 'not json'}, 'valid JSON'],
    [{name: 'a', schema: '[]'}, 'JSON object'],
    [{name: 'a', schema: '{"type":"string"}'}, '"type": "object"'],
    [{name: 'a', description: ''}, 'needs a description'],
    [{name: 'a', reporterInput: 'SCHEMA' as const}, 'literal text']
  ])('reports %o', (spec, message) => {
    const scan = scanFunctionDefinitions([targetWithFunctions(OPCODE, [spec])], OPCODE);
    expect(scan.functions).toEqual([]);
    expect(scan.errors[0]).toContain(message);
  });

  it('reports duplicate names across sprites', () => {
    const scan = scanFunctionDefinitions(
      [targetWithFunctions(OPCODE, [{name: 'dup'}], 'A'), targetWithFunctions(OPCODE, [{name: 'dup'}], 'B')],
      OPCODE
    );
    expect(scan.functions).toHaveLength(1);
    expect(scan.errors[0]).toContain('already defined in A');
  });

  it('ignores clones', () => {
    const clone = {...targetWithFunctions(OPCODE, [{name: 'x'}]), isOriginal: false};
    expect(scanFunctionDefinitions([clone], OPCODE).functions).toEqual([]);
  });
});
