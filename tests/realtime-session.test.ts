import {describe, expect, it, vi} from 'vitest';
import {RealtimeSession, readResponseOutput} from '../src/realtime-session.js';
import type {RealtimeEvent, RealtimeTransport, TransportConnectOptions} from '../src/transport.js';

class FakeTransport implements RealtimeTransport {
  public readonly sent: RealtimeEvent[] = [];
  public options: TransportConnectOptions | null = null;
  public closed = false;
  public failWith: Error | null = null;

  public async connect(options: TransportConnectOptions): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.options = options;
  }

  public send(event: RealtimeEvent): void {
    this.sent.push(event);
  }

  public close(): void {
    this.closed = true;
  }

  public receive(event: RealtimeEvent): void {
    this.options?.onEvent(event);
  }
}

function responseDone(output: unknown[]): RealtimeEvent {
  return {type: 'response.done', response: {output}};
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(
  callFunction: (name: string, args: unknown) => Promise<unknown> = vi.fn(async () => ({ok: true}))
) {
  const hooks = {callFunction, onResponseText: vi.fn(), onError: vi.fn(), onStateChange: vi.fn()};
  return {session: new RealtimeSession(hooks), hooks, transport: new FakeTransport()};
}

describe('RealtimeSession', () => {
  it('opens a transport and tracks state', async () => {
    const {session, hooks, transport} = setup();
    await session.open(transport, 'ek_1', true);
    expect(transport.options).toMatchObject({clientSecret: 'ek_1', microphone: true});
    expect(session.state).toBe('connected');
    expect(hooks.onStateChange.mock.calls.map(([state]) => state)).toEqual(['connecting', 'connected']);
    session.close();
    expect(transport.closed).toBe(true);
    expect(session.state).toBe('disconnected');
  });

  it('marks a failed connection', async () => {
    const {session, transport} = setup();
    transport.failWith = new Error('no answer');
    await expect(session.open(transport, 'ek_1', false)).rejects.toThrow('no answer');
    expect(session.state).toBe('failed');
  });

  it('sends user text followed by response.create', async () => {
    const {session, transport} = setup();
    expect(() => session.sendText('hi')).toThrow('Not connected');
    await session.open(transport, 'ek_1', false);
    session.sendText('hi');
    expect(transport.sent).toEqual([
      {type: 'conversation.item.create', item: {type: 'message', role: 'user', content: [{type: 'input_text', text: 'hi'}]}},
      {type: 'response.create'}
    ]);
  });

  it('reports assistant text and transcripts', async () => {
    const {session, hooks, transport} = setup();
    await session.open(transport, 'ek_1', false);
    transport.receive(responseDone([
      {type: 'message', content: [{type: 'output_audio', transcript: 'Hello '}, {type: 'output_text', text: 'there'}]}
    ]));
    await flush();
    expect(hooks.onResponseText).toHaveBeenCalledWith('Hello there');
    expect(transport.sent).toEqual([]);
  });

  it('answers every function call, then asks for one response', async () => {
    const callFunction = vi.fn(async (name: string, args: unknown): Promise<unknown> => ({name, args}));
    const {session, transport} = setup(callFunction);
    await session.open(transport, 'ek_1', false);
    transport.receive(responseDone([
      {type: 'function_call', name: 'get_score', call_id: 'call_1', arguments: '{"player":"a"}'},
      {type: 'function_call', name: 'set_color', call_id: 'call_2', arguments: ''}
    ]));
    await flush();
    expect(callFunction).toHaveBeenCalledWith('get_score', {player: 'a'});
    expect(callFunction).toHaveBeenCalledWith('set_color', {});
    expect(transport.sent).toEqual([
      {type: 'conversation.item.create', item: {type: 'function_call_output', call_id: 'call_1', output: '{"name":"get_score","args":{"player":"a"}}'}},
      {type: 'conversation.item.create', item: {type: 'function_call_output', call_id: 'call_2', output: '{"name":"set_color","args":{}}'}},
      {type: 'response.create'}
    ]);
  });

  it('returns errors to the model instead of stalling', async () => {
    const callFunction = vi.fn(async (): Promise<unknown> => {
      throw new Error('Function f timed out.');
    });
    const {session, hooks, transport} = setup(callFunction);
    await session.open(transport, 'ek_1', false);
    transport.receive(responseDone([
      {type: 'function_call', name: 'f', call_id: 'c1', arguments: '{}'},
      {type: 'function_call', name: 'g', call_id: 'c2', arguments: '{oops'}
    ]));
    await flush();
    expect(transport.sent.slice(0, 2).map((event) => (event.item as {output: string}).output)).toEqual([
      '{"error":"Function f timed out."}',
      '{"error":"Arguments were not valid JSON."}'
    ]);
    expect(hooks.onError).toHaveBeenCalledWith('Function f timed out.');
  });

  it('drops function results that arrive after the session closed', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const callFunction = vi.fn(() => new Promise<unknown>((resolve) => { finish = resolve; }));
    const {session, transport} = setup(callFunction);
    await session.open(transport, 'ek_1', false);
    transport.receive(responseDone([{type: 'function_call', name: 'f', call_id: 'c1', arguments: '{}'}]));
    session.close();
    finish(1);
    await flush();
    expect(transport.sent).toEqual([]);
  });

  it('records API errors and transport closure', async () => {
    const {session, hooks, transport} = setup();
    await session.open(transport, 'ek_1', false);
    transport.receive({type: 'error', error: {message: 'Bad request', code: 'invalid_value'}});
    expect(hooks.onError).toHaveBeenCalledWith('Bad request (invalid_value)');
    transport.options?.onClose('The Realtime data channel closed.');
    expect(session.state).toBe('failed');
  });
});

describe('readResponseOutput', () => {
  it('ignores malformed items', () => {
    expect(readResponseOutput({type: 'response.done', response: {output: [null, {type: 'function_call'}]}})).toEqual({
      text: '',
      calls: []
    });
  });
});
