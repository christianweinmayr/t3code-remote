/**
 * QR Code scanner screen.
 * Scans the pairing QR code from the companion server's /pair page.
 * Redeems the one-time code for a session token.
 */

import { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useRouter, Stack } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import * as Device from "expo-device";
import { parsePairPayload, redeemPairCode } from "../src/lib/api";
import { addConnection } from "../src/lib/connections";

export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [pairing, setPairing] = useState(false);
  const processingRef = useRef(false);

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, [permission]);

  const handleBarCodeScanned = async ({
    data,
  }: {
    type: string;
    data: string;
  }) => {
    // Prevent multiple simultaneous scans
    if (processingRef.current) return;
    processingRef.current = true;
    setScanned(true);
    setPairing(true);

    const payload = parsePairPayload(data);
    if (!payload || !payload.pairCode) {
      processingRef.current = false;
      setPairing(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        "Invalid QR Code",
        "This doesn't look like a T3 Code Remote pairing code.",
        [{
          text: "Try Again",
          onPress: () => {
            setScanned(false);
          },
        }]
      );
      return;
    }

    try {
      const deviceName = Device.modelName || Device.deviceName || "Device";
      const result = await redeemPairCode(
        payload.host,
        payload.companionPort,
        payload.pairCode,
        deviceName
      );

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      await addConnection({
        name: result.hostname || payload.hostname,
        host: payload.host,
        t3Port: result.t3Port || 3773,
        companionPort: payload.companionPort,
        companionToken: result.sessionToken,
        authToken: null,
      });

      setPairing(false);
      Alert.alert(
        "Paired Successfully",
        `Connected to ${payload.hostname} at ${payload.host}`,
        [{ text: "Done", onPress: () => router.replace("/") }]
      );
    } catch (err) {
      setPairing(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert(
        "Pairing Failed",
        msg,
        [{
          text: "Try Again",
          onPress: () => {
            processingRef.current = false;
            setScanned(false);
          },
        }]
      );
      return;
    }

    processingRef.current = false;
  };

  if (!permission) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <>
        <Stack.Screen options={{ title: "Scan QR Code" }} />
        <View style={styles.center}>
          <Text style={styles.text}>Camera permission is required to scan QR codes.</Text>
          <TouchableOpacity style={styles.button} onPress={requestPermission}>
            <Text style={styles.buttonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: "Scan QR Code",
          headerBackTitle: "Cancel",
        }}
      />
      <View style={styles.container}>
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{
            barcodeTypes: ["qr"],
          }}
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        />
        <View style={styles.overlay}>
          {pairing ? (
            <View style={styles.pairingBox}>
              <ActivityIndicator size="large" color="#3b82f6" />
              <Text style={styles.pairingText}>Pairing...</Text>
            </View>
          ) : (
            <>
              <View style={styles.scanArea}>
                <View style={[styles.corner, styles.topLeft]} />
                <View style={[styles.corner, styles.topRight]} />
                <View style={[styles.corner, styles.bottomLeft]} />
                <View style={[styles.corner, styles.bottomRight]} />
              </View>
              <Text style={styles.instruction}>
                Point at the QR code on your companion server
              </Text>
            </>
          )}
        </View>
      </View>
    </>
  );
}

const CORNER_SIZE = 24;
const CORNER_WIDTH = 3;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0a0a0a",
    padding: 40,
  },
  text: { color: "#9ca3af", fontSize: 15, textAlign: "center", marginBottom: 20 },
  button: {
    backgroundColor: "#3b82f6",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  camera: { flex: 1 },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  scanArea: {
    width: 260,
    height: 260,
    position: "relative",
  },
  corner: {
    position: "absolute",
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
  topLeft: {
    top: 0, left: 0,
    borderTopWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH,
    borderColor: "#3b82f6",
  },
  topRight: {
    top: 0, right: 0,
    borderTopWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH,
    borderColor: "#3b82f6",
  },
  bottomLeft: {
    bottom: 0, left: 0,
    borderBottomWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH,
    borderColor: "#3b82f6",
  },
  bottomRight: {
    bottom: 0, right: 0,
    borderBottomWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH,
    borderColor: "#3b82f6",
  },
  instruction: {
    color: "#fff",
    fontSize: 14,
    textAlign: "center",
    marginTop: 32,
    paddingHorizontal: 40,
    opacity: 0.8,
  },
  pairingBox: {
    backgroundColor: "rgba(0,0,0,0.8)",
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
  },
  pairingText: {
    color: "#fff",
    fontSize: 16,
    marginTop: 12,
  },
});
