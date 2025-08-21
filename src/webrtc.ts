import {
  mediaDevices,
  RTCPeerConnection,
  RTCIceCandidate,
  MediaStream,
} from 'react-native-webrtc';
import { Platform, PermissionsAndroid } from 'react-native';

export type PeerState = {
  roomId: string;
  pc: RTCPeerConnection | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
};

const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];

export async function ensurePermissions() {
  if (Platform.OS === 'android') {
    const res = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ]);
    const denied = Object.values(res).some(
      v => v !== PermissionsAndroid.RESULTS.GRANTED,
    );
    if (denied) throw new Error('Kamera/Mikrofon izni verilmedi');
  }
}

export async function createLocalStream(): Promise<MediaStream> {
  console.log('[getUserMedia] start');
  const stream = (await mediaDevices.getUserMedia({
    audio: true,
    video: {
      facingMode: 'user',
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 24, max: 30 },
    },
  })) as MediaStream;
  console.log('[getUserMedia] ok: tracks=', stream.getTracks().length);
  return stream;
}

export function createPeer(
  state: PeerState,
  onRemote: (ms: MediaStream) => void,
  onIce?: (c: any) => void,
) {
  console.log('[pc] creating RTCPeerConnection');
  const pc = new RTCPeerConnection({
    iceServers,

    sdpSemantics: 'unified-plan' as any,
    bundlePolicy: 'max-bundle',
    iceCandidatePoolSize: 0,
  } as any);

  state.pc = pc;
  const pca = pc as any;

  pca.addEventListener('icecandidate', (e: any) => {
    if (e?.candidate) {
      console.log(
        '[ICE] local candidate',
        (e.candidate.candidate || '').slice(0, 60),
      );
      onIce?.(e.candidate);
    } else {
      console.log('[ICE] gathering complete');
    }
  });

  pca.addEventListener('icecandidateerror', (e: any) => {
    console.warn('[ICE] candidate error', e);
  });

  pca.addEventListener('track', (e: any) => {
    const [stream] = e?.streams || [];
    console.log(
      '[track] kind=%s streams=%d',
      e?.track?.kind,
      (e?.streams || []).length,
    );
    if (stream) onRemote(stream);
  });

  pca.addEventListener?.('addstream', (e: any) => {
    console.log('[addstream] fired');
    if (e?.stream) onRemote(e.stream);
  });

  if (state.localStream) {
    const tracks = state.localStream.getTracks();
    console.log('[pc] addTrack count=', tracks.length);
    for (const t of tracks) pc.addTrack(t, state.localStream);
  } else {
    console.warn('[pc] createPeer called without localStream');
  }

  pca.addEventListener('connectionstatechange', () =>
    console.log('[pc] connectionState =', pca.connectionState),
  );
  pca.addEventListener('iceconnectionstatechange', () =>
    console.log('[pc] iceConnectionState =', pca.iceConnectionState),
  );
  pca.addEventListener('signalingstatechange', () =>
    console.log('[pc] signalingState =', pca.signalingState),
  );
  pca.addEventListener('icegatheringstatechange', () =>
    console.log('[pc] iceGatheringState =', pca.iceGatheringState),
  );
  pca.onnegotiationneeded = () => console.log('[pc] onnegotiationneeded');

  return pc;
}

export async function handleRemoteIce(state: PeerState, candidate: any) {
  if (!state.pc || !candidate) return;
  try {
    if (!candidate.candidate) {
      console.log('[ICE] skip empty candidate');
      return;
    }
    const ice = new RTCIceCandidate({
      candidate: candidate?.candidate,
      sdpMid: candidate?.sdpMid ?? null,
      sdpMLineIndex: candidate?.sdpMLineIndex ?? null,
    });
    await state.pc.addIceCandidate(ice);
  } catch (e) {
    console.warn('[ICE] addIceCandidate error', e);
  }
}

export function cleanup(state: PeerState) {
  try {
    state.pc?.close();
  } catch {}
  state.pc = null;

  try {
    state.localStream?.getTracks().forEach(t => t.stop());
  } catch {}
  state.localStream = null;
  state.remoteStream = null;

  console.log('[cleanup] done');
}

export function preferVideoCodec(sdp: string, codec = 'VP8') {
  const lines = sdp.split('\n');
  const mIdx = lines.findIndex(l => l.startsWith('m=video'));
  if (mIdx === -1) return sdp;

  const rtpmap = /^a=rtpmap:(\d+)\s+([A-Za-z0-9_-]+)\/\d+/;
  const payloadsForCodec: string[] = [];
  for (const line of lines) {
    const m = line.match(rtpmap);
    if (m && m[2].toUpperCase().includes(codec.toUpperCase())) {
      payloadsForCodec.push(m[1]);
    }
  }
  if (!payloadsForCodec.length) return sdp;

  const parts = lines[mIdx].trim().split(' ');
  const header = parts.slice(0, 3); // m= video port proto
  const payloads = parts.slice(3);
  const newOrder = [
    ...payloadsForCodec.filter(p => payloads.includes(p)),
    ...payloads.filter(p => !payloadsForCodec.includes(p)),
  ];
  lines[mIdx] = [...header, ...newOrder].join(' ');
  return lines.join('\n');
}
