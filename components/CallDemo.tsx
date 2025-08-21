import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
} from 'react-native';
import { RTCView } from 'react-native-webrtc';
import type { MediaStream } from 'react-native-webrtc';

import {
  PeerState,
  ensurePermissions,
  createLocalStream,
  createPeer,
  handleRemoteIce,
  cleanup,
  preferVideoCodec,
} from '../src/webrtc';
import { socket } from '../src/signaling';

type CallStatus = 'idle' | 'joined' | 'calling' | 'connected';
type SdpType = 'offer' | 'answer' | 'pranswer' | 'rollback';
type SdpInit = { type: SdpType; sdp: string };
type OfferAnswerPayload = { from?: string; sdp: SdpInit };
type IceCandidateInitLite = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
};
type IcePayload = { from?: string; candidate: IceCandidateInitLite };

function Btn({
  title,
  onPress,
  disabled,
  danger,
}: {
  title: string;
  onPress?: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={!!disabled}
      style={({ pressed }) => [
        styles.btnBase,
        disabled
          ? styles.btnDisabled
          : danger
          ? styles.btnDanger
          : styles.btnPrimary,
        pressed && !disabled && styles.btnPressed,
      ]}
    >
      <Text style={styles.btnText}>{title}</Text>
    </Pressable>
  );
}

export default function CallDemo() {
  const [roomId, setRoomId] = useState('demo');
  const [status, setStatus] = useState<CallStatus>('idle');

  const [pcReady, setPcReady] = useState(false);
  const [localReady, setLocalReady] = useState(false);

  const stateRef = useRef<PeerState>({
    roomId: '',
    pc: null,
    localStream: null,
    remoteStream: null,
  });
  const [, force] = useState(0);

  const flags = useRef({
    makingOffer: false,
    ignoreOffer: false,
    isSettingRemoteAnswerPending: false,
    polite: true,
    mySocketId: null as string | null,
    remoteSocketId: null as string | null,
  });

  const canStart = pcReady && localReady && status === 'joined';

  function waitForSocketConnected(timeout = 4000) {
    return new Promise<void>((resolve, reject) => {
      if (socket.connected) return resolve();
      const timer = setTimeout(
        () => reject(new Error('Signaling sunucusuna bağlanılamadı.')),
        timeout,
      );
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  useEffect(() => {
    if (socket.connected) flags.current.mySocketId = socket.id ?? null;
    else
      socket.once(
        'connect',
        () => (flags.current.mySocketId = socket.id ?? null),
      );

    socket.on('joined-room', () => {
      console.log('[WS] joined-room');
      setStatus('joined');
    });

    socket.on('offer-received', async ({ from, sdp }: OfferAnswerPayload) => {
      try {
        console.log('[WS] offer-received from', from);
        const pc = stateRef.current.pc!;
        if (!flags.current.remoteSocketId)
          flags.current.remoteSocketId = from ?? null;

        const me = flags.current.mySocketId ?? '';
        const other = from ?? '';
        flags.current.polite = me && other ? me.localeCompare(other) > 0 : true;

        const readyForOffer =
          pc.signalingState === 'stable' ||
          flags.current.isSettingRemoteAnswerPending;
        const offerCollision =
          sdp?.type === 'offer' &&
          (flags.current.makingOffer || !readyForOffer);
        flags.current.ignoreOffer = !flags.current.polite && offerCollision;
        if (flags.current.ignoreOffer) {
          console.log(
            '[negotiation] ignoring incoming offer (impolite + collision)',
          );
          return;
        }

        console.log('[SDP] setRemoteDescription(type=%s)', sdp?.type);
        await pc.setRemoteDescription(sdp as any);

        if (sdp?.type === 'offer') {
          console.log('[SDP] createAnswer()');
          const answer = await pc.createAnswer();
          // (İstenirse burada da VP8 tercih edilebilir)
          console.log('[SDP] setLocalDescription(answer)');
          await pc.setLocalDescription(answer);
          socket.emit('answer', {
            roomId: stateRef.current.roomId,
            sdp: { type: answer.type, sdp: answer.sdp },
          });
          setStatus('calling');
        } else {
          setStatus('connected');
        }
      } catch (e) {
        console.error('[offer-received] error', e);
        Alert.alert('Hata (offer-received)', String(e));
      }
    });

    socket.on('answer-received', async ({ from, sdp }: OfferAnswerPayload) => {
      try {
        console.log('[WS] answer-received from', from);
        if (!flags.current.remoteSocketId)
          flags.current.remoteSocketId = from ?? null;
        flags.current.isSettingRemoteAnswerPending = true;
        console.log('[SDP] setRemoteDescription(answer)');
        await stateRef.current.pc!.setRemoteDescription(sdp as any);
        flags.current.isSettingRemoteAnswerPending = false;
        setStatus('connected');
      } catch (e) {
        flags.current.isSettingRemoteAnswerPending = false;
        console.error('[answer-received] error', e);
        Alert.alert('Hata (answer-received)', String(e));
      }
    });

    socket.on('ice-candidate-received', async ({ candidate }: IcePayload) => {
      try {
        console.log('[ICE] remote candidate -> addIceCandidate');
        await handleRemoteIce(stateRef.current, candidate);
      } catch (e) {
        console.error('[ice-candidate]', e);
      }
    });

    return () => {
      socket.off('joined-room');
      socket.off('offer-received');
      socket.off('answer-received');
      socket.off('ice-candidate-received');
      cleanup(stateRef.current);
      setPcReady(false);
      setLocalReady(false);
    };
  }, []);

  async function initAndJoin() {
    try {
      console.log('[initAndJoin] start');
      if (stateRef.current.pc) cleanup(stateRef.current);
      setPcReady(false);
      setLocalReady(false);

      await ensurePermissions();
      await waitForSocketConnected();

      stateRef.current.roomId = roomId.trim();

      console.log('[initAndJoin] createLocalStream()');
      stateRef.current.localStream = await createLocalStream();
      setLocalReady(true);
      force(x => x + 1);

      console.log('[initAndJoin] createPeer()');
      const pc = createPeer(
        stateRef.current,
        (ms: MediaStream) => {
          console.log('[track] remote stream set');
          stateRef.current.remoteStream = ms;
          setStatus('connected');
          force(x => x + 1);
        },
        candidate => {
          const plain = {
            candidate: candidate?.candidate,
            sdpMid: candidate?.sdpMid ?? null,
            sdpMLineIndex: candidate?.sdpMLineIndex ?? null,
          };
          socket.emit('ice-candidate', {
            roomId: stateRef.current.roomId,
            candidate: plain,
          });
        },
      );
      stateRef.current.pc = pc;
      setPcReady(!!pc);

      console.log('[initAndJoin] join-room ->', stateRef.current.roomId);
      socket.emit('join-room', { roomId: stateRef.current.roomId });
    } catch (e) {
      console.error('[initAndJoin] error', e);
      Alert.alert('Hata (join)', String(e));
    }
  }

  async function startCall() {
    try {
      if (!canStart) return;
      await waitForSocketConnected();

      const s = stateRef.current;
      if (!s.pc || !s.localStream)
        throw new Error('Önce “Kamerayı Aç & Odaya Katıl”.');
      if (flags.current.makingOffer) return;
      if (s.pc.signalingState !== 'stable')
        throw new Error(`Uygunsuz durum: ${s.pc.signalingState}`);

      flags.current.makingOffer = true;

      console.log('[startCall] createOffer() begin');
      const offer = await s.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      } as any);

      const munged = preferVideoCodec(offer.sdp || '', 'VP8');
      const finalOffer = { type: offer.type, sdp: munged } as const;

      console.log('[startCall] setLocalDescription(offer, VP8-first)');
      await s.pc.setLocalDescription(finalOffer as any);

      console.log('[startCall] emit offer');
      socket.emit('offer', {
        roomId: s.roomId,
        sdp: finalOffer,
      });
      setStatus('calling');
      console.log('[startCall] done');
    } catch (e: any) {
      console.error('[startCall] error', e);
      Alert.alert('Offer hatası', e?.message ?? String(e));
    } finally {
      flags.current.makingOffer = false;
    }
  }

  function endCall() {
    console.log('[endCall]');
    cleanup(stateRef.current);
    setStatus('idle');
    setPcReady(false);
    setLocalReady(false);
    stateRef.current.roomId = '';
    stateRef.current.remoteStream = null;
    stateRef.current.localStream = null;
    stateRef.current.pc = null;
  }

  const { localStream, remoteStream } = stateRef.current;

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>WebRTC Görüşme</Text>
      <Text style={{ marginBottom: 8 }}>Durum: {status}</Text>
      <Text style={styles.debug}>
        pcReady={String(pcReady)} | localReady={String(localReady)} | canStart=
        {String(canStart)}
      </Text>

      <View style={styles.row}>
        <Text style={styles.label}>Room ID:</Text>
        <TextInput
          value={roomId}
          onChangeText={setRoomId}
          style={styles.input}
          placeholder="ör: demo"
        />
      </View>

      <View style={styles.btns}>
        <Btn
          title="Kamerayı Aç & Odaya Katıl"
          onPress={initAndJoin}
          disabled={status === 'connected'}
        />
        <Btn
          title="Aramayı Başlat (Offer)"
          onPress={startCall}
          disabled={!canStart}
        />
        <Btn title="Bitir" onPress={endCall} danger />
      </View>

      <Text style={styles.sub}>Yerel Yayın</Text>
      {localStream ? (
        <RTCView
          streamURL={localStream.toURL()}
          style={styles.video}
          objectFit="cover"
        />
      ) : (
        <View style={styles.placeholder}>
          <Text>Kamera kapalı</Text>
        </View>
      )}

      <Text style={styles.sub}>Karşı Taraf</Text>
      {remoteStream ? (
        <RTCView
          streamURL={remoteStream.toURL()}
          style={styles.video}
          objectFit="cover"
        />
      ) : (
        <View style={styles.placeholder}>
          <Text>Bağlantı bekleniyor…</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  debug: { fontSize: 12, color: '#666', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  label: { width: 80 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 40,
  },
  btns: { gap: 8, marginVertical: 12 },
  sub: { fontSize: 16, fontWeight: '600', marginVertical: 8 },
  video: {
    width: '100%',
    height: 220,
    backgroundColor: '#000',
    borderRadius: 8,
  },
  placeholder: {
    height: 220,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Buton stilleri
  btnBase: {
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: '#0A84FF' },
  btnDisabled: { backgroundColor: '#C7C7CC' },
  btnDanger: { backgroundColor: '#FF3B30' },
  btnPressed: { opacity: 0.85 },
  btnText: { color: '#fff', fontWeight: '600' },
});
