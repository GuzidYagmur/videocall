// @ts-nocheck
import { pushLog } from './debug/CrashGuard';

export function installPcInstrumentation(pc: RTCPeerConnection, name = 'pc') {
  if (!pc) return;
  const L = (...a: any[]) => pushLog('log', `[${name}]`, ...a);

  L('installPcInstrumentation');

  pc.addEventListener('negotiationneeded', () => L('event: negotiationneeded'));
  pc.addEventListener('icegatheringstatechange', () =>
    L('icegatheringstate:', pc.iceGatheringState),
  );
  pc.addEventListener('iceconnectionstatechange', () =>
    L('iceconnectionstate:', pc.iceConnectionState),
  );
  pc.addEventListener('connectionstatechange', () =>
    L('connectionstate:', pc.connectionState),
  );
  pc.addEventListener('signalingstatechange', () =>
    L('signalingstate:', pc.signalingState),
  );
  pc.addEventListener('track', (ev: any) =>
    L('event: track', ev?.track?.kind, Boolean(ev?.streams?.[0])),
  );

  // Sender/Receiver snapshot
  const snap = () => {
    try {
      const send = pc
        .getSenders()
        .map(s => s.track?.kind + ':' + (s.track?.readyState || 'n/a'));
      const recv = pc
        .getReceivers()
        .map(r => r.track?.kind + ':' + (r.track?.readyState || 'n/a'));
      L('snapshot', { send, recv });
    } catch (e) {
      L('snapshot err', e?.message);
    }
  };
  L('before snapshot');
  snap();

  return { snap };
}
