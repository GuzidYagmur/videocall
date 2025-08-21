import React, { useState } from 'react';
import {
  Button,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { mediaDevices, RTCView, MediaStream } from 'react-native-webrtc';

export default function CameraTest() {
  const [local, setLocal] = useState<MediaStream | null>(null);

  async function openCam() {
    if (Platform.OS === 'android') {
      await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.CAMERA,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      ]);
    }
    const stream = (await mediaDevices.getUserMedia({
      audio: true,
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 24, max: 30 },
      },
    })) as MediaStream;
    setLocal(stream);
  }

  function closeCam() {
    try {
      local?.getTracks().forEach(t => t.stop());
    } catch {}
    setLocal(null);
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>WebRTC Kamera Testi</Text>
      <View style={styles.btns}>
        <Button title="Kamerayı Aç" onPress={openCam} />
        <Button title="Kapat" onPress={closeCam} />
      </View>

      {local ? (
        <RTCView
          style={styles.video}
          streamURL={local.toURL()}
          objectFit="cover"
        />
      ) : (
        <View style={styles.placeholder}>
          <Text>Kamera kapalı</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 12 },
  btns: { gap: 8, marginVertical: 12 },
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
});
