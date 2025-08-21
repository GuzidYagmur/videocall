import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DevSettings,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type LogItem = { ts: number; level: 'log' | 'warn' | 'error'; msg: string };
const ring: LogItem[] = [];
const MAX = 1000;
export function pushLog(level: LogItem['level'], ...args: any[]) {
  const msg = args
    .map(a => {
      try {
        return typeof a === 'string' ? a : JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
  ring.push({ ts: Date.now(), level, msg });
  if (ring.length > MAX) ring.splice(0, ring.length - MAX);
}

export function CrashGuard({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);
  const timer = useRef<any>(null);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    // Console’ı zenginleştir
    const orig = { log: console.log, warn: console.warn, error: console.error };
    console.log = (...a) => {
      pushLog('log', ...a);
      orig.log(...a);
    };
    console.warn = (...a) => {
      pushLog('warn', ...a);
      orig.warn(...a);
    };
    console.error = (...a) => {
      pushLog('error', ...a);
      orig.error(...a);
    };

    // Global JS hata yakalayıcılar
    if (
      typeof ErrorUtils !== 'undefined' &&
      (ErrorUtils as any).setGlobalHandler
    ) {
      (ErrorUtils as any).setGlobalHandler((err: any, isFatal?: boolean) => {
        pushLog(
          'error',
          '[GlobalError]',
          isFatal ? 'FATAL' : 'NONFATAL',
          err?.message,
          err?.stack,
        );
      });
    }
    (globalThis as any).onunhandledrejection = (e: any) => {
      pushLog(
        'error',
        '[UnhandledRejection]',
        e?.reason?.message || e?.message || String(e),
      );
    };

    // Dev menüye kısa yol
    if (__DEV__ && DevSettings?.addMenuItem) {
      DevSettings.addMenuItem('🧪 Toggle Debug HUD', () => setOpen(v => !v));
    }

    // HUD içeriğini taze tut
    timer.current = setInterval(() => force(x => x + 1), 500);
    return () => {
      clearInterval(timer.current);
      console.log = orig.log;
      console.warn = orig.warn;
      console.error = orig.error;
    };
  }, []);

  const items = useMemo(
    () => [...ring].slice(-300).reverse(),
    [ring.length, open],
  );

  return (
    <View style={{ flex: 1 }} pointerEvents="box-none">
      {children}
      {__DEV__ && (
        <>
          {/* Sağ üstte minik bir nokta: 3 kez hızlı dokun -> HUD aç/kapat */}
          <Pressable
            onPress={() => setOpen(o => !o)}
            style={[styles.fab, { top: (insets.top || 0) + 12 }]}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          />
          <Modal
            visible={open}
            animationType="slide"
            onRequestClose={() => setOpen(false)}
            transparent
          >
            <View style={styles.modalWrap}>
              <View style={styles.panel}>
                <Text style={styles.title}>🔎 Debug HUD</Text>
                <ScrollView style={{ maxHeight: 420 }}>
                  {items.map((it, i) => (
                    <Text
                      key={i}
                      style={[
                        styles.row,
                        it.level === 'error'
                          ? styles.err
                          : it.level === 'warn'
                          ? styles.warn
                          : null,
                      ]}
                    >
                      {new Date(it.ts).toLocaleTimeString()} —{' '}
                      {it.level.toUpperCase()} — {it.msg}
                    </Text>
                  ))}
                </ScrollView>
                <View style={{ height: 8 }} />
                <Pressable onPress={() => setOpen(false)} style={styles.btn}>
                  <Text style={styles.btnText}>Kapat</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 12,
    width: 2800,
    height: 2800,

    backgroundColor: 'rgba(35, 197, 86, 0.35)',
    zIndex: 9999,
    elevation: 50,
    marginTop: 100,
  },
  modalWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  panel: {
    backgroundColor: '#101114',
    padding: 12,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  title: { color: '#fff', fontWeight: '700', marginBottom: 8, fontSize: 16 },
  row: { color: '#ddd', fontSize: 12, marginBottom: 6 },
  warn: { color: '#ffdd88' },
  err: { color: '#ff8a8a' },
  btn: {
    alignSelf: 'flex-end',
    backgroundColor: '#2e7d32',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  btnText: { color: '#fff', fontWeight: '600' },
});
