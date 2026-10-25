import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Camera, CommonResolutions, useCameraDevice, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';
import type { MediaSource } from '../composition/types';
import { importPhoto } from '../import';

const PREVIEW = 280;

/**
 * The Selfie sticker's camera: the front camera in a circle, and a shutter.
 * The photo is placed on the story as a round photo sticker.
 */
export function SelfieCapture({ onCaptured, onCancel }: { onCaptured: (photo: MediaSource) => void; onCancel: () => void }) {
  const device = useCameraDevice('front');
  const permission = useCameraPermission();
  const photoOutput = usePhotoOutput({ targetResolution: CommonResolutions.FHD_16_9, qualityPrioritization: 'quality', quality: 1 });
  const outputs = useMemo(() => [photoOutput], [photoOutput]);
  // The shutter works once the camera is running.
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!permission.hasPermission && permission.canRequestPermission) void permission.requestPermission();
    // Once, when the camera opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capture = async () => {
    if (busy || !ready) return;
    setBusy(true);
    try {
      // The camera stays active until the photo is saved: stopping it mid-capture cancels the photo.
      const photo = await photoOutput.capturePhoto({ flashMode: 'off', enableShutterSound: false }, {});
      const path = await photo.saveToTemporaryFileAsync();
      (photo as unknown as { dispose?: () => void }).dispose?.();
      onCaptured(await importPhoto(path.startsWith('file://') ? path : `file://${path}`));
    } catch {
      setBusy(false);
      Alert.alert('Selfie', 'The photo could not be taken. Try again.');
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onCancel} style={styles.icon}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </Pressable>
        <Text style={styles.title}>Selfie</Text>
        <View style={styles.icon} />
      </View>
      <View style={styles.body}>
        {!permission.hasPermission ? (
          <>
            <Text style={styles.note}>Allow camera access to take a selfie sticker.</Text>
            <Pressable onPress={() => (permission.canRequestPermission ? void permission.requestPermission() : void Linking.openSettings())}>
              <Text style={styles.link}>{permission.canRequestPermission ? 'Allow camera' : 'Open settings'}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.circle}>
              {device ? (
                <Camera
                  style={StyleSheet.absoluteFill}
                  device={device}
                  isActive
                  outputs={outputs}
                  resizeMode="cover"
                  // A TextureView, so the preview is clipped to the circle.
                  implementationMode="compatible"
                  onStarted={() => setReady(true)}
                  onStopped={() => setReady(false)}
                  onError={(error) => {
                    if (/not active|OperationCanceled/i.test(error.message)) return;
                    console.warn('[SelfieCapture]', error.message);
                  }}
                />
              ) : null}
              {!ready ? <ActivityIndicator color="#fff" style={StyleSheet.absoluteFill} /> : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Take selfie" onPress={() => void capture()} disabled={busy || !ready} style={[styles.shutter, !ready && { opacity: 0.4 }]}>
              {busy ? <ActivityIndicator color="#fff" /> : <View style={styles.shutterInner} />}
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: '#fff', fontSize: 17, fontWeight: '700', textAlign: 'center' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 40 },
  circle: { width: PREVIEW, height: PREVIEW, borderRadius: PREVIEW / 2, overflow: 'hidden', borderWidth: 4, borderColor: '#fff', backgroundColor: '#222' },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  note: { color: '#ddd', fontSize: 15, textAlign: 'center', marginHorizontal: 32 },
  link: { color: '#3897F0', fontSize: 15, fontWeight: '600' },
});
