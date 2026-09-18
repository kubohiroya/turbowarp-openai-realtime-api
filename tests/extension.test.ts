import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import definitions from '../src/block-definitions.json';
import {DEFINE_FUNCTION_OPCODE, OpenAIRealtimeExtension, RESPONSE_DONE_OPCODE} from '../src/extension.js';
import type {RealtimeEvent, RealtimeTransport, TransportConnectOptions} from '../src/transport.js';
import {FakeRuntime, targetWithFunctions} from './helpers/fake-runtime.js';

const NOW = 1_700_000_000_000;
const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';

beforeEach(() => {
  vi.stubGlobal('Scratch', {
    BlockType: {COMMAND: 'command', REPORTER: 'reporter', BOOLEAN: 'Boolean', HAT: 'hat'},
    ArgumentType: {STRING: 'string', NUMBER: 'number', BOOLEAN: 'Boolean'},
    Cast: {toString: (value: unknown) => String(value)},
    translate: (message: string | {default: string}) => (typeof message === 'string' ? message : message.default)
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

class FakeTransport implements RealtimeTransport {
  public readonly sent: RealtimeEvent[] = [];
  public options: TransportConnectOptions | null = null;
  public async connect(options: TransportConnectOptions): Promise<void> {
    this.options = options;
  }
  public send(event: RealtimeEvent): void {
    this.sent.push(event);
  }
  public close(): void {}
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status});
}

function relayFetch() {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/v1/pair')) return jsonResponse({token: TOKEN, expiresAt: NOW + 60_000});
    if (url.endsWith('/v1/openai/realtime/client-secrets')) {
      return jsonResponse({data: {value: 'ek_test', expiresAt: NOW + 60_000, model: 'gpt-realtime-2.1'}});
    }
    return jsonResponse({error: {message: 'not found'}}, 404);
  });
}

function setup() {
  const runtime = new FakeRuntime();
  const transport = new FakeTransport();
  const fetcher = relayFetch();
  const extension = new OpenAIRealtimeExtension({
    runtime,
    fetch: fetcher,
    createTransport: () => transport,
    now: () => NOW
  });
  return {runtime, transport, fetcher, extension};
}

describe('OpenAIRealtimeExtension', () => {
  it('describes every block, marks hats as predicate hats, and implements each opcode', () => {
    const {extension} = setup();
    const info = extension.getInfo() as {
      id: string;
      blocks: Array<{opcode: string; blockType: string; isEdgeActivated?: boolean}>;
      menus: Record<string, {items: string[]}>;
    };
    expect(info.id).toBe('kubohiroyaopenairealtime');
    expect(info.blocks).toHaveLength(definitions.blocks.length);
    for (const block of info.blocks) {
      expect(typeof (extension as unknown as Record<string, unknown>)[block.opcode]).toBe('function');
      if (block.blockType === 'hat') expect(block.isEdgeActivated).toBe(false);
    }
    expect(info.menus.voices?.items).toContain('marin');
  });

  it('records errors instead of throwing', () => {
    const {extension} = setup();
    extension.configureRelay({ENDPOINT: 'https://example.com'});
    expect(extension.lastError()).toContain('loopback');
    extension.configureRelay({ENDPOINT: 'http://127.0.0.1:9999'});
    expect(extension.lastError()).toBe('');
  });

  it('requires pairing before connecting', async () => {
    const {extension, fetcher} = setup();
    await extension.connect({MICROPHONE: 'on'});
    expect(extension.lastError()).toContain('Pair with the local relay first');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('pairs, mints a secret with exported tools, and connects', async () => {
    const {extension, runtime, transport, fetcher} = setup();
    runtime.targets = [
      targetWithFunctions(DEFINE_FUNCTION_OPCODE, [
        {name: 'get_score', description: 'Returns the score.'},
        {name: 'internal', exportAs: 'none'}
      ])
    ];
    await extension.pairRelay({CODE: '12345678'});
    expect(extension.isRelayPaired()).toBe(true);
    extension.setInstructions({TEXT: 'Be brief.'});
    extension.setVoice({VOICE: 'Cedar'});
    extension.setOutputMode({MODE: 'text'});
    await extension.connect({MICROPHONE: 'off'});
    expect(extension.lastError()).toBe('');
    expect(extension.isConnected()).toBe(true);
    expect(transport.options).toMatchObject({clientSecret: 'ek_test', microphone: false});

    const [, init] = fetcher.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      session: {
        instructions: 'Be brief.',
        voice: 'cedar',
        outputModalities: ['text'],
        tools: [
          {type: 'function', name: 'get_score', description: 'Returns the score.', parameters: {type: 'object', properties: {}}}
        ]
      }
    });
  });

  it('refuses to connect with invalid function definitions', async () => {
    const {extension, runtime} = setup();
    runtime.targets = [targetWithFunctions(DEFINE_FUNCTION_OPCODE, [{name: 'bad name'}])];
    await extension.pairRelay({CODE: '12345678'});
    await extension.connect({MICROPHONE: 'off'});
    expect(extension.lastError()).toContain('Invalid function definitions');
    expect(extension.isConnected()).toBe(false);
  });

  it('runs a tool call through the define function hat and returns its value', async () => {
    const {extension, runtime, transport} = setup();
    runtime.targets = [targetWithFunctions(DEFINE_FUNCTION_OPCODE, [{name: 'get_score'}])];
    await extension.pairRelay({CODE: '12345678'});
    await extension.connect({MICROPHONE: 'off'});

    transport.options?.onEvent({
      type: 'response.done',
      response: {output: [{type: 'function_call', name: 'get_score', call_id: 'call_1', arguments: '{"player":{"name":"Ada"}}'}]}
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.startedHats).toContain(DEFINE_FUNCTION_OPCODE);

    // The VM evaluates the started hat, then runs its script.
    const thread = runtime.spawnThread();
    expect(extension.defineFunction({NAME: 'other'}, {thread})).toBe(false);
    expect(extension.defineFunction({NAME: 'get_score'}, {thread})).toBe(true);
    expect(extension.functionArgument({PATH: 'player.name'}, {thread})).toBe('Ada');
    expect(extension.functionArgumentsJson({}, {thread})).toBe('{"player":{"name":"Ada"}}');
    const stopThisScript = vi.fn();
    extension.returnValue({VALUE: '{"score":10}'}, {thread, stopThisScript});
    expect(stopThisScript).toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(transport.sent).toEqual([
      {type: 'conversation.item.create', item: {type: 'function_call_output', call_id: 'call_1', output: '{"score":10}'}},
      {type: 'response.create'}
    ]);
  });

  it('does not let the model call functions that are not exported', async () => {
    const {extension, runtime, transport} = setup();
    runtime.targets = [targetWithFunctions(DEFINE_FUNCTION_OPCODE, [{name: 'secret_op', exportAs: 'none'}])];
    await extension.pairRelay({CODE: '12345678'});
    await extension.connect({MICROPHONE: 'off'});
    transport.options?.onEvent({
      type: 'response.done',
      response: {output: [{type: 'function_call', name: 'secret_op', call_id: 'c', arguments: '{}'}]}
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.startedHats).not.toContain(DEFINE_FUNCTION_OPCODE);
    expect((transport.sent[0]?.item as {output: string}).output).toContain('not exported');
  });

  it('starts the response hat with the assistant text', async () => {
    const {extension, runtime, transport} = setup();
    await extension.pairRelay({CODE: '12345678'});
    await extension.connect({MICROPHONE: 'off'});
    extension.sendText({TEXT: 'Hi'});
    expect(transport.sent.map((event) => event.type)).toEqual(['conversation.item.create', 'response.create']);
    transport.options?.onEvent({
      type: 'response.done',
      response: {output: [{type: 'message', content: [{type: 'output_text', text: 'Hello!'}]}]}
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.startedHats).toContain(RESPONSE_DONE_OPCODE);
    expect(extension.lastResponseText()).toBe('Hello!');
    extension.disconnect();
    expect(extension.connectionState()).toBe('disconnected');
  });

  it('reports argument blocks used outside a function', () => {
    const {extension, runtime} = setup();
    expect(extension.functionArgument({PATH: 'x'}, {thread: runtime.spawnThread()})).toBe('');
    expect(extension.lastError()).toContain('inside a running function');
  });
});
