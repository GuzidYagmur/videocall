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
    console.log('Socket başlatılıyor');

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

          console.log('[SDP] setLocalDescription(answer)', answer);
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
      console.log('[startCall] Starting...');

      // Detaylı validation
      if (!pcReady || !localReady || status !== 'joined') {
        console.warn('[startCall] Conditions not met:', {
          pcReady,
          localReady,
          status,
        });
        return;
      }

      if (!socket.connected) {
        console.warn('[startCall] Socket not connected');
        await waitForSocketConnected();
      }

      const s = stateRef.current;

      if (!s.pc) {
        throw new Error('Peer connection is null');
      }

      if (s.pc.signalingState !== 'stable') {
        console.warn(
          `[startCall] Invalid signaling state: ${s.pc.signalingState}`,
        );
        return;
      }

      if (flags.current.makingOffer) {
        console.log('[startCall] Already making offer');
        return;
      }

      flags.current.makingOffer = true;

      // Offer oluştur
      const offer = await s.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });

      if (!offer || !offer.sdp) {
        throw new Error('Invalid offer created');
      }

      console.log('[startCall] Setting local description...');
      await s.pc.setLocalDescription(offer);

      console.log('[startCall] Sending offer...');
      socket.emit('offer', {
        roomId: s.roomId,
        sdp: {
          type: offer.type,
          sdp: offer.sdp,
        },
      });

      setStatus('calling');
      console.log('[startCall] Offer sent successfully');
    } catch (error) {
      console.error('[startCall] Error:', error);
      Alert.alert(
        'Arama Hatası',
        `Arama başlatılamadı: ${(error as Error).message}`,
      );

      // Hata durumunda state'i temizle
      flags.current.makingOffer = false;

      // Peer connection'ı yeniden başlat
      if (stateRef.current.pc) {
        try {
          await initAndJoin();
        } catch (reinitError) {
          console.error('[startCall] Reinit failed:', reinitError);
        }
      }
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
  scroll: {
    flexGrow: 1,
    padding: 16,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  debug: {
    fontSize: 11,
    color: '#666',
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  label: {
    fontSize: 16,
    marginRight: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    backgroundColor: 'white',
  },
  btns: {
    gap: 8,
    marginBottom: 24,
  },
  btnBase: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnPrimary: {
    backgroundColor: '#007AFF',
  },
  btnDanger: {
    backgroundColor: '#FF3B30',
  },
  btnDisabled: {
    backgroundColor: '#C7C7CC',
  },
  btnPressed: {
    opacity: 0.8,
  },
  btnText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  sub: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  video: {
    width: '100%',
    height: 200,
    backgroundColor: 'black',
    borderRadius: 8,
  },
  placeholder: {
    width: '100%',
    height: 200,
    backgroundColor: '#E5E5EA',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
