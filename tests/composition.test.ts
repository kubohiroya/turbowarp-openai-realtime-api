import {createNamedFunctions} from '@kubohiroya/turbowarp-named-functions/composition';
import {describe, expect, it, vi} from 'vitest';
import {createRealtimeComposition, type RealtimeCompositionEvent} from '../src/composition.js';
import type {RealtimeEvent, RealtimeTransport, TransportConnectOptions} from '../src/transport.js';
import {FakeRuntime, targetWithFunctions} from './helpers/fake-runtime.js';

const OPCODE = 'downstream_defineFunction';
const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';

class FakeTransport implements RealtimeTransport {
  public readonly sent: RealtimeEvent[] = [];
  public options: TransportConnectOptions | null = null;
  public closed = false;
  public async connect(options: TransportConnectOptions): Promise<void> {
    this.options = options;
  }
  public send(event: RealtimeEvent): void {
    this.sent.push(event);
  }
  public close(): void {
    this.closed = true;
  }
}

function setup(model = 'gpt-realtime-2.1-mini') {
  let now = 1_700_000_000_000;
  const runtime = new FakeRuntime();
  const transport = new FakeTransport();
  const timers: Array<{callback: () => void; ms: number; cleared: boolean}> = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/v1/pair')) return new Response(JSON.stringify({token: TOKEN, expiresAt: now + 3_600_000}));
    const requested = (JSON.parse(String(init?.body)) as {session: {model?: string}}).session.model;
    return new Response(JSON.stringify({data: {value: 'ek_x', expiresAt: now + 60_000, model: requested ?? model}}));
  });
  const realtime = createRealtimeComposition({
    runtime,
    functionHatOpcode: OPCODE,
    fetch: fetcher,
    createTransport: () => transport,
    now: () => now,
    setTimer: (callback, ms) => {
      const timer = {callback, ms, cleared: false};
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as {cleared: boolean}).cleared = true;
    }
  });
  const events: RealtimeCompositionEvent[] = [];
  realtime.subscribe((event) => events.push(event));
  const advance = (ms: number) => {
    now += ms;
  };
  const clock = () => now;
  return {runtime, transport, fetcher, realtime, timers, events, advance, clock};
}

async function connected(model?: string) {
  const context = setup();
  await context.realtime.pairRelay('12345678');
  if (model !== undefined) context.realtime.setModel(model);
  await context.realtime.connect({microphone: false});
  return context;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createRealtimeComposition', () => {
  it('requests the chosen model and reports the one the relay used', async () => {
    const {realtime, fetcher} = await connected('gpt-realtime-2.1');
    const body = JSON.parse(String((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body)) as {
      session: {model: string};
    };
    expect(body.session.model).toBe('gpt-realtime-2.1');
    expect(realtime.activeModel).toBe('gpt-realtime-2.1');
  });

  it('omits the model to use the relay default', async () => {
    const {realtime, fetcher} = await connected();
    const body = JSON.parse(String((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body)) as {
      session: Record<string, unknown>;
    };
    expect(body.session).not.toHaveProperty('model');
    expect(realtime.activeModel).toBe('gpt-realtime-2.1-mini');
    expect(() => realtime.setModel('bad model!')).toThrow('model identifier');
  });

  it('accumulates usage and prices it with the active model', async () => {
    const {realtime, transport, events} = await connected('gpt-realtime-2.1-mini');
    transport.options?.onEvent({
      type: 'response.done',
      response: {
        output: [],
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
          input_token_details: {text_tokens: 1000, audio_tokens: 0, cached_tokens: 0},
          output_token_details: {text_tokens: 200, audio_tokens: 0}
        }
      }
    });
    await flush();
    const usage = realtime.usage();
    expect(usage).toMatchObject({responses: 1, inputTokens: 1000, outputTokens: 200});
    expect(usage.estimatedCostUsd).toBeCloseTo((1000 * 0.6 + 200 * 2.4) / 1e6, 12);
    expect(events.some((event) => event.type === 'usage')).toBe(true);
    realtime.resetUsage();
    expect(realtime.usage().responses).toBe(0);
  });

  it('disconnects at the session time limit and reports it', async () => {
    const context = setup();
    await context.realtime.pairRelay('12345678');
    context.realtime.setSessionTimeLimit(600);
    await context.realtime.connect({microphone: false});
    expect(context.timers.map((timer) => timer.ms)).toEqual([600_000]);
    context.advance(125_000);
    expect(context.realtime.sessionElapsedSeconds()).toBe(125);
    context.timers[0]?.callback();
    expect(context.transport.closed).toBe(true);
    expect(context.realtime.state).toBe('disconnected');
    expect(context.realtime.sessionElapsedSeconds()).toBe(0);
    expect(context.events.map((event) => event.type)).toContain('sessionTimeLimitReached');
  });

  it('clears the time limit on manual disconnect and ignores a late timer', async () => {
    const context = setup();
    await context.realtime.pairRelay('12345678');
    context.realtime.setSessionTimeLimit(60);
    await context.realtime.connect({microphone: false});
    context.realtime.disconnect();
    expect(context.timers[0]?.cleared).toBe(true);
    context.timers[0]?.callback();
    expect(context.events.map((event) => event.type)).not.toContain('sessionTimeLimitReached');
    expect(() => context.realtime.setSessionTimeLimit(-1)).toThrow('zero or a positive');
  });

  it('uses a shared named-functions instance for tools', async () => {
    const context = setup();
    context.runtime.targets = [targetWithFunctions('shared_defineFunction', [{name: 'shared_tool'}])];
    const functions = createNamedFunctions({runtime: context.runtime, functionHatOpcode: 'shared_defineFunction'});
    const realtime = createRealtimeComposition({
      runtime: context.runtime,
      functionHatOpcode: OPCODE,
      functions,
      fetch: context.fetcher,
      createTransport: () => context.transport,
      now: context.clock
    });
    expect(realtime.functions).toBe(functions);
    await realtime.pairRelay('12345678');
    await realtime.connect({microphone: false});
    const body = JSON.parse(String((context.fetcher.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body)) as {
      session: {tools: Array<{name: string}>};
    };
    expect(body.session.tools.map((tool) => tool.name)).toEqual(['shared_tool']);
    realtime.release();
    // A shared instance stays usable after the composition that borrowed it is released.
    expect(functions.isDefined('shared_tool')).toBe(true);
  });
});
