import type {FetchLike} from './relay-client.js';
import type {RealtimeEvent, RealtimeTransport, TransportConnectOptions} from './transport.js';

export const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
export const EVENTS_CHANNEL = 'oai-events';

export interface WebRtcDependencies {
  createPeerConnection: () => RTCPeerConnection;
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createAudioElement: () => HTMLAudioElement;
  fetch: FetchLike;
  channelOpenTimeoutMs?: number;
}

export function browserWebRtcDependencies(): WebRtcDependencies {
  return {
    createPeerConnection: () => new RTCPeerConnection(),
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    createAudioElement: () => {
      const element = document.createElement('audio');
      element.autoplay = true;
      return element;
    },
    fetch: (input, init) => fetch(input, init)
  };
}

/** Browser-to-OpenAI WebRTC session authenticated with an ephemeral client secret. */
export class WebRtcTransport implements RealtimeTransport {
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private microphone: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private closed = false;

  public constructor(private readonly deps: WebRtcDependencies = browserWebRtcDependencies()) {}

  public async connect(options: TransportConnectOptions): Promise<void> {
    this.closed = false;
    try {
      const peer = this.deps.createPeerConnection();
      this.peer = peer;
      const audio = this.deps.createAudioElement();
      this.audio = audio;
      peer.ontrack = (event) => {
        audio.srcObject = event.streams[0] ?? null;
      };

      if (options.microphone) {
        const stream = await this.deps.getUserMedia({audio: true});
        this.microphone = stream;
        for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
      } else {
        peer.addTransceiver('audio', {direction: 'recvonly'});
      }

      const channel = peer.createDataChannel(EVENTS_CHANNEL);
      this.channel = channel;
      channel.onmessage = (message) => {
        const event = parseEvent(message.data);
        if (event) options.onEvent(event);
      };
      channel.onclose = () => this.handleClose(options, 'The Realtime data channel closed.');
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
          this.handleClose(options, `The Realtime connection ${peer.connectionState}.`);
        }
      };
      const opened = waitForOpen(channel, this.deps.channelOpenTimeoutMs ?? 15_000);
      // Awaited below; this keeps an early failure from surfacing as an unhandled rejection.
      opened.catch(() => undefined);

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const response = await this.deps.fetch(REALTIME_CALLS_URL, {
        method: 'POST',
        body: offer.sdp ?? '',
        headers: {
          authorization: `Bearer ${options.clientSecret}`,
          'content-type': 'application/sdp'
        },
        redirect: 'error'
      });
      const answer = await response.text();
      if (!response.ok) {
        throw new Error(`Realtime call setup failed (${response.status}).`);
      }
      await peer.setRemoteDescription({type: 'answer', sdp: answer});
      await opened;
    } catch (error) {
      this.close();
      throw error;
    }
  }

  public send(event: RealtimeEvent): void {
    if (!this.channel || this.channel.readyState !== 'open') {
      throw new Error('Not connected to Realtime.');
    }
    this.channel.send(JSON.stringify(event));
  }

  public close(): void {
    this.closed = true;
    const channel = this.channel;
    const peer = this.peer;
    this.channel = null;
    this.peer = null;
    if (channel) {
      channel.onmessage = null;
      channel.onclose = null;
      channel.close();
    }
    if (peer) {
      peer.onconnectionstatechange = null;
      peer.ontrack = null;
      peer.close();
    }
    for (const track of this.microphone?.getTracks() ?? []) track.stop();
    this.microphone = null;
    if (this.audio) {
      this.audio.srcObject = null;
      this.audio = null;
    }
  }

  private handleClose(options: TransportConnectOptions, reason: string): void {
    if (this.closed) return;
    this.close();
    options.onClose(reason);
  }
}

function parseEvent(data: unknown): RealtimeEvent | null {
  if (typeof data !== 'string') return null;
  try {
    const value = JSON.parse(data) as unknown;
    if (typeof value === 'object' && value !== null && typeof (value as {type?: unknown}).type === 'string') {
      return value as RealtimeEvent;
    }
  } catch {
    // Ignore malformed events.
  }
  return null;
}

function waitForOpen(channel: RTCDataChannel, timeoutMs: number): Promise<void> {
  if (channel.readyState === 'open') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out opening the Realtime data channel.')), timeoutMs);
    channel.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    }, {once: true});
  });
}
