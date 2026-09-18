import type { FetchLike } from './relay-client.js';
import type { RealtimeEvent, RealtimeTransport, TransportConnectOptions } from './transport.js';
export declare const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
export declare const EVENTS_CHANNEL = "oai-events";
export interface WebRtcDependencies {
    createPeerConnection: () => RTCPeerConnection;
    getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
    createAudioElement: () => HTMLAudioElement;
    fetch: FetchLike;
    channelOpenTimeoutMs?: number;
}
export declare function browserWebRtcDependencies(): WebRtcDependencies;
/** Browser-to-OpenAI WebRTC session authenticated with an ephemeral client secret. */
export declare class WebRtcTransport implements RealtimeTransport {
    private readonly deps;
    private peer;
    private channel;
    private microphone;
    private audio;
    private closed;
    constructor(deps?: WebRtcDependencies);
    connect(options: TransportConnectOptions): Promise<void>;
    send(event: RealtimeEvent): void;
    close(): void;
    private handleClose;
}
