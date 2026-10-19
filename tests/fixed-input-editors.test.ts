import {OpenAIRealtimeExtension} from '../src/extension.js';
import previousGetInfo from './fixtures/fixed-getinfo-before.json' with {type: 'json'};
import { describe, it, expect, vi } from "vitest";
import {
  createFixedInputEditor,
  EditorRegistry,
  sameFixedSnapshot,
  BlockEditorConflictError,
} from "@kubohiroya/turbowarp-extension-data-editor";
import type {
  BlockEditorHost,
  FixedBlockSnapshot,
  FixedInputEditorOptions,
  FixedHostCommitRequest,
  JsonObject,
  JsonValue,
} from "@kubohiroya/turbowarp-extension-data-editor";
import {
  fixedInputEditorOptions,
  registerFixedInputEditors,
} from "../src/fixed-input-editors.js";
import schemas from "../schemas/block-editor-fixed-inputs.schema.json" with { type: "json" };
const options = fixedInputEditorOptions();
const context = { consumerId: "fixture", nowMs: 0, settings: null };
function fixture(
  option: FixedInputEditorOptions,
  seed: Record<
    string,
    { literal?: string; source?: "reporter" | "unsupported" | "missing" }
  >,
  failCommit = false,
) {
  const definition = createFixedInputEditor(option);
  const registry = new EditorRegistry();
  const remove = registry.registerFixed(definition);
  const live: FixedBlockSnapshot = {
    targetId: "sprite",
    blockId: "fixed",
    opcode: option.opcodes[0]!,
    revision: "1",
    arguments: {},
    fixedContext: {
      contractId: option.contractId,
      contractRevision: option.contractRevision,
      generation: "g1",
      readOnlyArguments: option.readOnlyArguments ?? [],
      dependencies: option.dependencies ?? [],
      inputs: {},
    },
  };
  const args = live.arguments as Record<string, unknown>;
  const inputs = live.fixedContext.inputs as Record<string, unknown>;
  for (const [name, spec] of Object.entries(seed)) {
    const source = spec.source ?? "shadow";
    const role = option.readOnlyArguments?.includes(name)
      ? "readonly"
      : "editable";
    if (source === "reporter") args[name] = { kind: "reporter" };
    else if (source !== "missing")
      args[name] = { kind: "literal", value: spec.literal ?? "unsupported" };
    if (
      !option.bindings.some((binding) => binding.argument === name) &&
      !option.readOnlyArguments?.includes(name)
    )
      continue;
    inputs[name] = {
      source,
      role,
      ...(source === "unsupported" || source === "missing"
        ? { reason: "Unavailable standard field." }
        : {}),
      identity: `${name}:1`,
      ...(source === "shadow"
        ? { field: { blockId: `${name}:shadow`, name: "TEXT", type: "text" } }
        : {}),
    };
  }
  const requests: FixedHostCommitRequest[] = [];
  const invalidation = new Set<(error: unknown) => void>();
  const commit = (request: FixedHostCommitRequest) => {
    if (!sameFixedSnapshot(request.expected, live))
      throw new BlockEditorConflictError("changed");
    if (
      request.changes.some(
        (change) =>
          !definition.editableArguments.includes(change.argument) ||
          definition.readOnlyArguments.includes(change.argument),
      )
    )
      throw new Error("readonly patch");
    if (failCommit) throw new Error("commit rejected");
    for (const change of request.changes)
      args[change.argument] = { kind: "literal", value: change.value };
    requests.push(request);
  };
  const host: BlockEditorHost = {
    readBlock: () => live,
    commit: () => {
      throw new Error("legacy path");
    },
    fixedInputs: {
      capability: "fixed-inputs-v1",
      readBlock: () => live,
      commit,
      subscribeInvalidation: (_r, _d, listener) => {
        invalidation.add(listener);
        return () => {
          invalidation.delete(listener);
        };
      },
    },
  };
  const open = () => registry.open(live, host)!;
  const session = open();
  const set = (name: string, value: JsonValue, buffer?: string) => {
    const draft = session.getDraft();
    const entries = draft.inputs as JsonObject;
    entries[name] = {
      value,
      changed: true,
      ...(buffer === undefined ? {} : { buffer }),
    };
    session.setDraft(draft);
  };
  return {
    definition,
    registry,
    remove,
    live,
    args,
    inputs,
    requests,
    commit,
    session,
    set,
    open,
    invalidate: () => {
      for (const listener of invalidation) listener(new Error("scope changed"));
    },
  };
}

const contracts = schemas.$defs as Record<
  string,
  {
    properties: Record<
      string,
      {
        type: string;
        enum?: (string | number)[];
        minimum?: number;
        maximum?: number;
      }
    >;
  }
>;
function seed(option: FixedInputEditorOptions) {
  const opcode = option.opcodes[0]!.slice(option.extensionId.length + 1);
  return Object.fromEntries(
    Object.entries(contracts[opcode]!.properties).map(([name, schema]) => [
      name,
      { literal: String(schema.enum?.[0] ?? Math.max(1, schema.minimum ?? 0)) },
    ]),
  );
}
describe("fixed static owner contract", () => {
  for (const option of options) {
    const opcode = option.opcodes[0]!.slice(option.extensionId.length + 1);
    it(`${opcode}: exact canonical property roots and prepared factory`, () => {
      expect(createFixedInputEditor(option).saveContract).toBe(
        "prepared-fixed-v1",
      );
      expect(option.bindings.map((b) => b.argument).sort()).toEqual(
        Object.keys(contracts[opcode]!.properties).sort(),
      );
      for (const b of option.bindings) {
        expect(b.schemaBundle.root.document).toEqual(
          contracts[opcode]!.properties[b.argument],
        );
        expect(b.schemaBundle.root.artifact.role).toBe("canonical-schema");
      }
    });
    it(`${opcode}: no-op exact raw preservation`, async () => {
      const f = fixture(option, seed(option));
      const before = structuredClone(f.live.arguments);
      expect(await f.session.save()).toEqual({
        status: "saved",
        changed: false,
      });
      expect(f.live.arguments).toEqual(before);
      expect(f.requests).toHaveLength(0);
      f.session.dispose();
      f.remove();
    });
    it(`${opcode}: reporter stays readonly and invalidation discards session`, async () => {
      const base = seed(option);
      base[option.bindings[0]!.argument] = { source: "reporter" } as never;
      const f = fixture(option, base);
      expect(await f.session.save()).toEqual({
        status: "saved",
        changed: false,
      });
      f.invalidate();
      expect(() => f.session.getDraft()).toThrow();
      f.session.dispose();
      f.remove();
    });
    for (const binding of option.bindings) {
      const schema = contracts[opcode]!.properties[binding.argument]!;
      if (binding.control?.kind === "number") {
        it(`${opcode}.${binding.argument}: new NP grammar without buffer; existing alias projection`, () => {
          for (const value of [
            "",
            " ",
            "0x10",
            "+1",
            "001",
            "1.",
            ".5",
            "1e",
            "1e999",
            "NaN",
            "Infinity",
          ])
            expect(() => binding.encode(value, context)).toThrow();
          for (const value of ["-0", "1e2", "1.25"])
            expect(binding.encode(value, context)).toBe(value);
          for (const value of ["0x10", "+1", "001", "1."])
            expect(binding.read(value)).toBe(Number(value));
          for (const value of ["", " ", "NaN", "Infinity"])
            expect(() => binding.read(value)).toThrow();
        });
        it(`${opcode}.${binding.argument}: prepared invalid new token atomic; untouched blank retained`, async () => {
          const f = fixture(option, seed(option));
          const before = structuredClone(f.live.arguments);
          f.set(binding.argument, "0x10");
          expect((await f.session.save()).status).toBe("invalid");
          expect(f.requests).toHaveLength(0);
          expect(f.live.arguments).toEqual(before);
          f.session.dispose();
          f.remove();
          const old = seed(option);
          old[binding.argument] = { literal: "" };
          const g = fixture(option, old);
          expect(await g.session.save()).toEqual({
            status: "saved",
            changed: false,
          });
          expect(g.args[binding.argument]).toEqual({
            kind: "literal",
            value: "",
          });
          g.session.dispose();
          g.remove();
        });
      } else {
        it(`${opcode}.${binding.argument}: exact new enum, unknown old no-op`, async () => {
          for (const value of schema.enum!)
            expect(binding.encode(value, context)).toBe(value);
          expect(() => binding.encode("unknown-new", context)).toThrow();
          const old = seed(option);
          old[binding.argument] = { literal: "legacy-unknown" };
          const f = fixture(option, old);
          expect(await f.session.save()).toEqual({
            status: "saved",
            changed: false,
          });
          expect(f.args[binding.argument]).toEqual({
            kind: "literal",
            value: "legacy-unknown",
          });
          f.session.dispose();
          f.remove();
        });
      }
      it(`${opcode}.${binding.argument}: prepared save encodes only edited value`, async () => {
        const f = fixture(option, seed(option));
        const value =
          schema.enum?.[schema.enum.length - 1] ??
          Math.max(2, schema.minimum ?? 0);
        f.set(binding.argument, value);
        expect((await f.session.save()).status).toBe("saved");
        expect(f.requests[0]?.changes).toEqual([
          { argument: binding.argument, value: binding.encode(value, context) },
        ]);
        f.session.dispose();
        f.remove();
      });
    }
  }
  it("optional capability, visible-only registration and idempotent lifetime cleanup", () => {
    expect(
      registerFixedInputEditors(
        {},
        {},
        options.map((o) => ({
          opcode: o.opcodes[0]!.slice(o.extensionId.length + 1),
        })),
      ),
    ).toBeUndefined();
    const remove = vi.fn(),
      register = vi.fn(() => remove),
      events = new Map<string, () => void>();
    const runtime = {
      on: (event: string, fn: () => void) => events.set(event, fn),
      off: (event: string) => events.delete(event),
    };
    const scratch = {
      gui: {
        blockEditors: { apiVersion: 1, registerFixedInputEditor: register },
      },
    };
    const dispose = registerFixedInputEditors(scratch, runtime, [
      {
        opcode: options[0]!.opcodes[0]!.slice(
          options[0]!.extensionId.length + 1,
        ),
      },
    ])!;
    expect(register).toHaveBeenCalledTimes(1);
    events.get("RUNTIME_DISPOSED")!();
    dispose();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(events.size).toBe(0);
  });
  it("partial registration rollback", () => {
    const remove = vi.fn();
    let count = 0;
    const scratch = {
      gui: {
        blockEditors: {
          apiVersion: 1,
          registerFixedInputEditor: () => {
            if (count++ === 1) throw new Error("fixture");
            return remove;
          },
        },
      },
    };
    const visible = options.map((o) => ({
      opcode: o.opcodes[0]!.slice(o.extensionId.length + 1),
    }));
    if (options.length > 1) {
      expect(() => registerFixedInputEditors(scratch, {}, visible)).toThrow(
        "fixture",
      );
      expect(remove).toHaveBeenCalledTimes(1);
    } else {
      registerFixedInputEditors(scratch, {}, [])!();
      expect(remove).not.toHaveBeenCalled();
    }
  });
});

it('actual getInfo preserves metadata and registers once without owner constructor effects', () => {
 const remove=vi.fn(),register=vi.fn(()=>remove),listeners=new Map<string,()=>void>();
 const runtime={on:(event:string,fn:()=>void)=>listeners.set(event,fn),off:(event:string)=>listeners.delete(event)};
 vi.stubGlobal('Scratch',{BlockType:{COMMAND:'command',REPORTER:'reporter',BOOLEAN:'Boolean',HAT:'hat',CONDITIONAL:'conditional',EVENT:'event',LOOP:'loop',LABEL:'label',BUTTON:'button'},ArgumentType:{STRING:'string',NUMBER:'number',BOOLEAN:'Boolean',COLOR:'color'},translate:(value:unknown)=>typeof value==='string'?value:(value as {default:string}).default,Cast:{toString:String,toNumber:Number},vm:{runtime},gui:{blockEditors:{apiVersion:1,registerFixedInputEditor:register}}});
 try {
  const instance=Object.create(OpenAIRealtimeExtension.prototype) as OpenAIRealtimeExtension;
  Object.assign(instance,{runtime,fixedEditorRuntime:runtime,enabled:true});
  const expected=structuredClone(previousGetInfo) as Record<string,unknown>;
  
  expect(JSON.parse(JSON.stringify(instance.getInfo()))).toEqual(expected);
  expect(JSON.parse(JSON.stringify(instance.getInfo()))).toEqual(expected);
  expect(register).toHaveBeenCalledTimes(options.length);
  listeners.get('RUNTIME_DISPOSED')!();expect(remove).toHaveBeenCalledTimes(options.length);
  instance.getInfo();expect(register).toHaveBeenCalledTimes(options.length);
 } finally {vi.unstubAllGlobals();}
});
