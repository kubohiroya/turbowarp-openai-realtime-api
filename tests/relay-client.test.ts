import {describe, expect, it, vi} from 'vitest';
import {normalizeRelayEndpoint, pairWithRelay, requestClientSecret} from '../src/relay-client.js';

const NOW = 1_700_000_000_000;
const now = () => NOW;
const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
}

describe('normalizeRelayEndpoint', () => {
  it('accepts loopback origins', () => {
    expect(normalizeRelayEndpoint('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    expect(normalizeRelayEndpoint(' http://localhost:9000/ ')).toBe('http://localhost:9000');
    expect(normalizeRelayEndpoint('http://[::1]:8787')).toBe('http://[::1]:8787');
  });

  it.each([
    'https://127.0.0.1:8787',
    'http://example.com',
    'http://192.168.0.10:8787',
    'http://127.0.0.1:8787/v1',
    'http://127.0.0.1:8787?x=1',
    'http://user:pass@127.0.0.1:8787',
    'not a url'
  ])('rejects %s', (endpoint) => {
    expect(() => normalizeRelayEndpoint(endpoint)).toThrow(TypeError);
  });
});

describe('pairWithRelay', () => {
  it('exchanges an eight-digit code for a token', async () => {
    const fetcher = vi.fn(async () => jsonResponse({token: TOKEN, expiresAt: NOW + 60_000}));
    const session = await pairWithRelay('http://127.0.0.1:8787', ' 12345678 ', fetcher, now);
    expect(session).toEqual({endpoint: 'http://127.0.0.1:8787', token: TOKEN, expiresAt: NOW + 60_000});
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:8787/v1/pair', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({code: '12345678'}),
      redirect: 'error'
    }));
  });

  it('rejects malformed codes without calling the relay', async () => {
    const fetcher = vi.fn();
    await expect(pairWithRelay('http://127.0.0.1:8787', '1234', fetcher, now)).rejects.toThrow('eight digits');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('surfaces relay error messages', async () => {
    const fetcher = vi.fn(async () => jsonResponse({error: {code: 'invalid_code', message: 'Code rejected.'}}, 401));
    await expect(pairWithRelay('http://127.0.0.1:8787', '12345678', fetcher, now)).rejects.toThrow('Code rejected.');
  });

  it('rejects invalid tokens and expirations', async () => {
    await expect(
      pairWithRelay('http://127.0.0.1:8787', '12345678', async () => jsonResponse({token: 'short', expiresAt: NOW + 1}), now)
    ).rejects.toThrow('invalid pairing token');
    await expect(
      pairWithRelay('http://127.0.0.1:8787', '12345678', async () => jsonResponse({token: TOKEN, expiresAt: NOW}), now)
    ).rejects.toThrow('expiration');
  });
});

describe('requestClientSecret', () => {
  const session = {endpoint: 'http://127.0.0.1:8787', token: TOKEN, expiresAt: NOW + 60_000};

  it('posts the session request with the relay token', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({data: {value: 'ek_abc123', expiresAt: NOW + 60_000, model: 'gpt-realtime-2.1'}})
    );
    const secret = await requestClientSecret(session, {voice: 'marin', outputModalities: ['audio']}, fetcher, now);
    expect(secret).toEqual({value: 'ek_abc123', expiresAt: NOW + 60_000, model: 'gpt-realtime-2.1'});
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8787/v1/openai/realtime/client-secrets');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init.body))).toEqual({session: {voice: 'marin', outputModalities: ['audio']}});
  });

  it('refuses to use an expired relay session', async () => {
    const fetcher = vi.fn();
    await expect(requestClientSecret({...session, expiresAt: NOW - 1}, {}, fetcher, now)).rejects.toThrow('expired');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects secrets that are not ephemeral keys', async () => {
    const fetcher = vi.fn(async () => jsonResponse({data: {value: 'sk-real-key', expiresAt: NOW + 60_000}}));
    await expect(requestClientSecret(session, {}, fetcher, now)).rejects.toThrow('invalid client secret');
  });
});
