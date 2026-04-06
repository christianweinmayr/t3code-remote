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

const CS = 28;
const CW = 2;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000",
    padding: 40,
  },
  text: { color: "#666", fontSize: 15, textAlign: "center", marginBottom: 24 },
  button: {
    backgroundColor: "#fff",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
  },
  buttonText: { color: "#000", fontSize: 15, fontWeight: "600" },
  camera: { flex: 1 },
  overlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  scanArea: {
    width: 240,
    height: 240,
    position: "relative",
  },
  corner: {
    position: "absolute",
    width: CS,
    height: CS,
  },
  topLeft: {
    top: 0, left: 0,
    borderTopWidth: CW, borderLeftWidth: CW,
    borderColor: "#fff",
  },
  topRight: {
    top: 0, right: 0,
    borderTopWidth: CW, borderRightWidth: CW,
    borderColor: "#fff",
  },
  bottomLeft: {
    bottom: 0, left: 0,
    borderBottomWidth: CW, borderLeftWidth: CW,
    borderColor: "#fff",
  },
  bottomRight: {
    bottom: 0, right: 0,
    borderBottomWidth: CW, borderRightWidth: CW,
    borderColor: "#fff",
  },
  instruction: {
    color: "#fff",
    fontSize: 14,
    textAlign: "center",
    marginTop: 28,
    paddingHorizontal: 40,
    opacity: 0.6,
  },
  pairingBox: {
    backgroundColor: "rgba(0,0,0,0.85)",
    borderRadius: 12,
    padding: 32,
    alignItems: "center",
  },
  pairingText: {
    color: "#fff",
    fontSize: 15,
    marginTop: 12,
  },
});
