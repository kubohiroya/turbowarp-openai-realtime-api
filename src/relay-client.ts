import type {RealtimeSessionRequest} from './session-config.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,}$/u;
const CLIENT_SECRET_PATTERN = /^ek_[A-Za-z0-9_-]+$/u;

export interface RelaySession {
  endpoint: string;
  token: string;
  expiresAt: number;
}

export interface ClientSecret {
  value: string;
  expiresAt: number;
  model: string;
}

/** Accepts only a plain loopback HTTP origin so the relay token can never leave this machine. */
export function normalizeRelayEndpoint(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    throw new TypeError('Relay endpoint must be a valid URL.');
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTNAMES.has(url.hostname)) {
    throw new TypeError('Relay endpoint must use HTTP on a loopback hostname.');
  }
  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new TypeError('Relay endpoint must contain only its loopback origin.');
  }
  return url.origin;
}

export async function pairWithRelay(
  endpoint: string,
  code: string,
  fetcher: FetchLike = fetch,
  now: () => number = Date.now
): Promise<RelaySession> {
  const origin = normalizeRelayEndpoint(endpoint);
  const trimmed = code.trim();
  if (!/^\d{8}$/u.test(trimmed)) {
    throw new TypeError('Relay pairing code must contain exactly eight digits.');
  }
  const record = requireRecord(
    await requestJson(fetcher, `${origin}/v1/pair`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({code: trimmed}),
      redirect: 'error'
    }),
    'Relay returned an invalid pairing response.'
  );
  const token = String(record.token ?? '');
  if (!TOKEN_PATTERN.test(token)) throw new Error('Relay returned an invalid pairing token.');
  if (typeof record.expiresAt !== 'number' || !Number.isFinite(record.expiresAt) || record.expiresAt <= now()) {
    throw new Error('Relay returned an invalid session expiration.');
  }
  return {endpoint: origin, token, expiresAt: record.expiresAt};
}

export async function requestClientSecret(
  session: RelaySession,
  request: RealtimeSessionRequest,
  fetcher: FetchLike = fetch,
  now: () => number = Date.now
): Promise<ClientSecret> {
  if (session.expiresAt <= now()) {
    throw new Error('Relay session has expired. Pair with the local relay again.');
  }
  const envelope = requireRecord(
    await requestJson(fetcher, `${session.endpoint}/v1/openai/realtime/client-secrets`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.token}`
      },
      body: JSON.stringify({session: request}),
      redirect: 'error'
    }),
    'Relay returned an invalid client secret response.'
  );
  const data = requireRecord(envelope.data, 'Relay returned an invalid client secret response.');
  const value = String(data.value ?? '');
  if (!CLIENT_SECRET_PATTERN.test(value)) throw new Error('Relay returned an invalid client secret.');
  if (typeof data.expiresAt !== 'number' || !Number.isFinite(data.expiresAt) || data.expiresAt <= now()) {
    throw new Error('Relay returned an expired client secret.');
  }
  return {value, expiresAt: data.expiresAt, model: String(data.model ?? '')};
}

async function requestJson(fetcher: FetchLike, url: string, init: RequestInit): Promise<unknown> {
  const response = await fetcher(url, init);
  const text = await response.text();
  let result: unknown = null;
  if (text.length > 0) {
    try {
      result = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Relay returned a non-JSON response (${response.status}).`);
    }
  }
  if (!response.ok) {
    throw new Error(`Relay request failed (${response.status}): ${errorDetail(result)}`);
  }
  return result;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function errorDetail(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    const error = (value as Record<string, unknown>).error;
    if (typeof error === 'object' && error !== null) {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === 'string') return message;
    }
  }
  return 'unknown error';
}
