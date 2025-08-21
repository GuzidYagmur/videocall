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

/** WebRTC olaylarını görünür kıl (HUD’da/logcat’te rahat takip) */
export function installPcInstrumentation(pc: RTCPeerConnection, name = 'pc') {
  if (!pc) return;
  const pca = pc as any;
  const L = (...a: any[]) => console.log(`[${name}]`, ...a);

  L('instrumentation: install');
  pca.addEventListener?.('negotiationneeded', () =>
    L('event: negotiationneeded'),
  );
  pca.addEventListener?.('icegatheringstatechange', () =>
    L('iceGatheringState =', pca.iceGatheringState),
  );
  pca.addEventListener?.('iceconnectionstatechange', () =>
    L('iceConnectionState =', pca.iceConnectionState),
  );
  pca.addEventListener?.('connectionstatechange', () =>
    L('connectionState =', pca.connectionState),
  );
  pca.addEventListener?.('signalingstatechange', () =>
    L('signalingState =', pca.signalingState),
  );
  pca.addEventListener?.('track', (ev: any) =>
    L('event: track', ev?.track?.kind, !!ev?.streams?.[0]),
  );

  // Başlangıç snapshot
  try {
    const send = pc
      .getSenders()
      .map(s => s.track?.kind + ':' + (s.track?.readyState || 'n/a'));
    const recv = pc
      .getReceivers()
      .map(r => r.track?.kind + ':' + (r.track?.readyState || 'n/a'));
    L('snapshot', { send, recv });
  } catch (e: any) {
    L('snapshot error', e?.message);
  }
}

/**
 * SDP’yi sadece VP8 (video) ve OPUS (audio) kalacak şekilde filtreler.
 * H264/HEVC/AV1 ve ilgili fmtp/rtcp-fb satırlarını temizler.
 */
export function forceVp8AndOpus(original: string): string {
  if (!original) return original;
  const sdp = original.split(/\r?\n/);

  const pts: Record<'audio' | 'video', Set<string>> = {
    audio: new Set(),
    video: new Set(),
  };
  const keepVideo = new Set<string>();
  const keepAudio = new Set<string>();

  // rtpmap’leri tara, hangi m= bloğunda olduklarını bul
  for (let i = 0; i < sdp.length; i++) {
    const m = sdp[i].match(/^a=rtpmap:(\d+)\s+([A-Za-z0-9_-]+)\/(\d+)/);
    if (!m) continue;
    const pt = m[1],
      codec = m[2].toUpperCase();

    let kind: 'audio' | 'video' | undefined;
    for (let j = i; j >= 0; j--) {
      if (sdp[j].startsWith('m=audio')) {
        kind = 'audio';
        break;
      }
      if (sdp[j].startsWith('m=video')) {
        kind = 'video';
        break;
      }
    }
    if (!kind) continue;
    pts[kind].add(pt);

    if (kind === 'video' && codec === 'VP8') keepVideo.add(pt);
    if (kind === 'audio' && codec === 'OPUS') keepAudio.add(pt);
  }

  const filterMLine = (kind: 'audio' | 'video', keep: Set<string>) => {
    const idx = sdp.findIndex(l => l.startsWith(`m=${kind}`));
    if (idx === -1) return;
    const parts = sdp[idx].trim().split(' ');
    const header = parts.slice(0, 3); // m=<kind> <port> <proto>
    const payloads = parts.slice(3).filter(pt => keep.has(pt));
    sdp[idx] = [...header, ...payloads].join(' ');
  };

  filterMLine('video', keepVideo);
  filterMLine('audio', keepAudio);

  const keepAll = new Set<string>([...keepVideo, ...keepAudio]);
  const out: string[] = [];
  for (const line of sdp) {
    const rtp = line.match(/^a=rtpmap:(\d+)\s/);
    const fmtp = line.match(/^a=fmtp:(\d+)\s/);
    const fb = line.match(/^a=rtcp-fb:(\d+)\s/);
    const pt = (rtp || fmtp || fb)?.[1];
    if (pt && !keepAll.has(pt)) continue; // istenmeyen PT satırlarını at
    out.push(line);
  }
  return out.join('\r\n');
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

  // Enstrümantasyon
  installPcInstrumentation(pc, 'pc-local');

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

export function cleanup(state: PeerState, why: string = 'unknown') {
  try {
    // zaten temiz mi?
    const already =
      !state.pc &&
      (!state.localStream ||
        state.localStream.getTracks().every(t => t.readyState === 'ended')) &&
      !state.remoteStream;

    if (already) {
      console.log('[cleanup] skipped (already clean). reason=', why);
      return;
    }

    try {
      state.pc?.close();
    } catch {}
    state.pc = null;

    try {
      state.localStream?.getTracks().forEach(t => t.stop());
    } catch {}
    state.localStream = null;
    state.remoteStream = null;

    console.log('[cleanup] done. reason=', why);
  } catch (e: any) {
    console.warn('[cleanup] error', e?.message || e);
  }
}

/** (İsteğe bağlı) Eski yardımcı – export ETMİYORUM ki çakışma olmasın. */
