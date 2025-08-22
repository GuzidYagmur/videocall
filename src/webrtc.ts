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
  });

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

  if (state.localStream) {
    const tracks = state.localStream.getTracks();
    console.log('[pc] Adding tracks, count:', tracks.length);

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      try {
        console.log(
          `[pc] Adding track ${i + 1}/${tracks.length}: ${track.kind}`,
        );
        pc.addTrack(track, state.localStream);
        console.log(`[pc] Track ${i + 1} added successfully`);
      } catch (err) {
        console.error(`[pc] Failed to add track ${i + 1}:`, err);
      }
    }
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
    state.localStream?.getTracks().forEach(t => {
      try {
        t.stop();
      } catch (err) {
        console.warn('[cleanup] Error stopping track:', err);
      }
    });
  } catch {}
  state.localStream = null;
  state.remoteStream = null;

  console.log('[cleanup] done');
}

export function preferVideoCodec(sdp: string, codec = 'VP8') {
  try {
    if (!sdp || typeof sdp !== 'string') {
      console.warn(
        '[preferVideoCodec] Invalid SDP provided, returning original',
      );
      return sdp || '';
    }

    const lines = sdp.split('\n');

    const mIdx = lines.findIndex(l => l && l.startsWith('m=video'));

    if (mIdx === -1) {
      console.log(
        '[preferVideoCodec] No video line found in SDP, returning original',
      );
      return sdp;
    }

    const rtpmap = /^a=rtpmap:(\d+)\s+([A-Za-z0-9_-]+)\/\d+/;
    const payloadsForCodec: string[] = [];

    for (const line of lines) {
      if (!line) continue;

      try {
        const m = line.match(rtpmap);
        if (
          m &&
          m[1] &&
          m[2] &&
          m[2].toUpperCase().includes(codec.toUpperCase())
        ) {
          payloadsForCodec.push(m[1]);
          console.log(`[preferVideoCodec] Found ${codec} payload: ${m[1]}`);
        }
      } catch (err) {
        console.warn('[preferVideoCodec] Error processing line:', line, err);
      }
    }

    if (!payloadsForCodec.length) {
      console.log(
        `[preferVideoCodec] Codec ${codec} not found in SDP, returning original`,
      );
      return sdp;
    }

    const videoLine = lines[mIdx];
    if (!videoLine) {
      console.warn(
        '[preferVideoCodec] Video line is empty, returning original',
      );
      return sdp;
    }

    const parts = videoLine.trim().split(' ');

    if (parts.length < 3) {
      console.warn(
        '[preferVideoCodec] Invalid video line format, parts:',
        parts,
      );
      return sdp;
    }

    const header = parts.slice(0, 3);
    const payloads = parts.slice(3);

    if (payloads.length === 0) {
      console.warn('[preferVideoCodec] No payloads found in video line');
      return sdp;
    }

    console.log('[preferVideoCodec] Original payloads:', payloads);

    const preferredPayloads = payloadsForCodec.filter(p =>
      payloads.includes(p),
    );
    const otherPayloads = payloads.filter(p => !payloadsForCodec.includes(p));
    const newOrder = [...preferredPayloads, ...otherPayloads];

    console.log('[preferVideoCodec] Reordered payloads:', newOrder);

    if (newOrder.length > 0) {
      lines[mIdx] = [...header, ...newOrder].join(' ');
      console.log('[preferVideoCodec] Updated video line:', lines[mIdx]);
    }

    return lines.join('\n');
  } catch (error) {
    console.error('[preferVideoCodec] Unexpected error processing SDP:', error);

    return sdp || '';
  }
}
