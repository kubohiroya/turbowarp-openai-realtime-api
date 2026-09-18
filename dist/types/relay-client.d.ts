import type { RealtimeSessionRequest } from './session-config.js';
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
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
export declare function normalizeRelayEndpoint(endpoint: string): string;
export declare function pairWithRelay(endpoint: string, code: string, fetcher?: FetchLike, now?: () => number): Promise<RelaySession>;
export declare function requestClientSecret(session: RelaySession, request: RealtimeSessionRequest, fetcher?: FetchLike, now?: () => number): Promise<ClientSecret>;
