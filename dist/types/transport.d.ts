export type RealtimeEvent = Record<string, unknown> & {
    type: string;
};
export interface TransportConnectOptions {
    clientSecret: string;
    microphone: boolean;
    onEvent: (event: RealtimeEvent) => void;
    onClose: (reason: string) => void;
}
/**
 * A connection to the Realtime API. WebRTC is the primary implementation; a WebSocket transport can
 * implement the same interface later because both carry the same JSON events.
 */
export interface RealtimeTransport {
    connect(options: TransportConnectOptions): Promise<void>;
    send(event: RealtimeEvent): void;
    close(): void;
}
