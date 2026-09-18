import {describe, expect, it, vi} from 'vitest';
import {EVENTS_CHANNEL, REALTIME_CALLS_URL, WebRtcTransport, type WebRtcDependencies} from '../src/webrtc-transport.js';

class FakeChannel extends EventTarget {
  public readyState: RTCDataChannelState = 'connecting';
  public readonly sent: string[] = [];
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onclose: (() => void) | null = null;

  public constructor(public readonly label: string) {
    super();
  }

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(): void {
    this.readyState = 'closed';
  }

  public open(): void {
    this.readyState = 'open';
    this.dispatchEvent(new Event('open'));
  }
}

class FakePeer {
  public channel: FakeChannel | null = null;
  public readonly tracks: MediaStreamTrack[] = [];
  public readonly transceivers: string[] = [];
  public remote: RTCSessionDescriptionInit | null = null;
  public connectionState: RTCPeerConnectionState = 'new';
  public ontrack: ((event: {streams: MediaStream[]}) => void) | null = null;
  public onconnectionstatechange: (() => void) | null = null;
  public closed = false;
  public openChannelOnAnswer = true;

  public createDataChannel(label: string): FakeChannel {
    this.channel = new FakeChannel(label);
    return this.channel;
  }

  public addTrack(track: MediaStreamTrack): void {
    this.tracks.push(track);
  }

  public addTransceiver(kind: string): void {
    this.transceivers.push(kind);
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    return {type: 'offer', sdp: 'v=0 offer'};
  }

  public async setLocalDescription(): Promise<void> {}

  public async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remote = description;
    if (this.openChannelOnAnswer) this.channel?.open();
  }

  public close(): void {
    this.closed = true;
  }
}

function setup(response = new Response('v=0 answer', {status: 201})) {
  const peer = new FakePeer();
  const track = {stop: vi.fn()} as unknown as MediaStreamTrack;
  const stream = {getAudioTracks: () => [track], getTracks: () => [track]} as unknown as MediaStream;
  const audio = {srcObject: null} as unknown as HTMLAudioElement;
  const deps: WebRtcDependencies = {
    createPeerConnection: () => peer as unknown as RTCPeerConnection,
    getUserMedia: vi.fn(async () => stream),
    createAudioElement: () => audio,
    fetch: vi.fn(async () => response),
    channelOpenTimeoutMs: 50
  };
  const onEvent = vi.fn();
  const onClose = vi.fn();
  return {peer, track, stream, audio, deps, onEvent, onClose, transport: new WebRtcTransport(deps)};
}

describe('WebRtcTransport', () => {
  it('exchanges SDP with the ephemeral key and opens the events channel', async () => {
    const {peer, deps, onEvent, onClose, transport} = setup();
    await transport.connect({clientSecret: 'ek_1', microphone: true, onEvent, onClose});
    expect(peer.channel?.label).toBe(EVENTS_CHANNEL);
    expect(peer.tracks).toHaveLength(1);
    expect(deps.fetch).toHaveBeenCalledWith(REALTIME_CALLS_URL, {
      method: 'POST',
      body: 'v=0 offer',
      headers: {authorization: 'Bearer ek_1', 'content-type': 'application/sdp'},
      redirect: 'error'
    });
    expect(peer.remote).toEqual({type: 'answer', sdp: 'v=0 answer'});
  });

  it('receives audio only when the microphone is off', async () => {
    const {peer, deps, onEvent, onClose, transport} = setup();
    await transport.connect({clientSecret: 'ek_1', microphone: false, onEvent, onClose});
    expect(deps.getUserMedia).not.toHaveBeenCalled();
    expect(peer.transceivers).toEqual(['audio']);
  });

  it('parses events and sends JSON', async () => {
    const {peer, onEvent, onClose, transport} = setup();
    await transport.connect({clientSecret: 'ek_1', microphone: false, onEvent, onClose});
    peer.channel?.onmessage?.({data: '{"type":"response.done"}'} as MessageEvent);
    peer.channel?.onmessage?.({data: 'not json'} as MessageEvent);
    expect(onEvent).toHaveBeenCalledTimes(1);
    transport.send({type: 'response.create'});
    expect(peer.channel?.sent).toEqual(['{"type":"response.create"}']);
  });

  it('cleans up and rethrows when call setup fails', async () => {
    const {peer, track, onEvent, onClose, transport} = setup(new Response('nope', {status: 401}));
    await expect(
      transport.connect({clientSecret: 'ek_1', microphone: true, onEvent, onClose})
    ).rejects.toThrow('Realtime call setup failed (401)');
    expect(peer.closed).toBe(true);
    expect(track.stop).toHaveBeenCalled();
    expect(() => transport.send({type: 'x'})).toThrow('Not connected');
  });

  it('times out when the data channel never opens', async () => {
    const {peer, onEvent, onClose, transport} = setup();
    peer.openChannelOnAnswer = false;
    await expect(
      transport.connect({clientSecret: 'ek_1', microphone: false, onEvent, onClose})
    ).rejects.toThrow('Timed out');
  });

  it('reports remote closure once and not after a local close', async () => {
    const first = setup();
    await first.transport.connect({clientSecret: 'ek_1', microphone: false, onEvent: first.onEvent, onClose: first.onClose});
    first.peer.channel?.onclose?.();
    expect(first.onClose).toHaveBeenCalledTimes(1);

    const second = setup();
    await second.transport.connect({clientSecret: 'ek_1', microphone: false, onEvent: second.onEvent, onClose: second.onClose});
    const channel = second.peer.channel;
    second.transport.close();
    channel?.onclose?.();
    expect(second.onClose).not.toHaveBeenCalled();
  });
});
