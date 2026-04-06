/**
 * Add / Edit connection screen.
 * Allows entering host, ports, auth token, and connection name.
 */

import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter, useLocalSearchParams, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import { addConnection, updateConnection } from "../src/lib/connections";
import { checkT3Health, checkCompanionHealth } from "../src/lib/api";

export default function AddConnection() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    editId?: string;
    editName?: string;
    editHost?: string;
    editT3Port?: string;
    editCompanionPort?: string;
    editAuthToken?: string;
  }>();

  const isEditing = !!params.editId;

  const [name, setName] = useState(params.editName || "");
  const [host, setHost] = useState(params.editHost || "");
  const [t3Port, setT3Port] = useState(params.editT3Port || "3773");
  const [companionPort, setCompanionPort] = useState(
    params.editCompanionPort || "3774"
  );
  const [authToken, setAuthToken] = useState(params.editAuthToken || "");
  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
    if (!host.trim()) {
      Alert.alert("Error", "Please enter a hostname or IP address.");
      return;
    }

    setTesting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const testConn = {
      id: "test",
      name: "test",
      host: host.trim(),
      t3Port: parseInt(t3Port, 10) || 3773,
      companionPort: parseInt(companionPort, 10) || 3774,
      authToken: authToken.trim() || null,
      companionToken: null as string | null,
      color: "#fff",
      createdAt: "",
      lastConnectedAt: null,
    };

    try {
      const t3Online = await checkT3Health(testConn);
      let companionOnline = false;
      try {
        await checkCompanionHealth(testConn);
        companionOnline = true;
      } catch {}

      if (t3Online && companionOnline) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Connection OK", "Both t3code and companion are reachable.");
      } else if (t3Online) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert(
          "Partial",
          "t3code server is reachable but companion server is not.\nYou can still connect but won't be able to browse files remotely."
        );
      } else if (companionOnline) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert(
          "Partial",
          "Companion is reachable but t3code server is not."
        );
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert(
          "Unreachable",
          "Could not connect to either server. Check the hostname, ports, and network."
        );
      }
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Error", String(err));
    }

    setTesting(false);
  };

  const handleSave = async () => {
    if (!name.trim() || !host.trim()) {
      Alert.alert("Error", "Name and host are required.");
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (isEditing) {
      await updateConnection(params.editId!, {
        name: name.trim(),
        host: host.trim(),
        t3Port: parseInt(t3Port, 10) || 3773,
        companionPort: parseInt(companionPort, 10) || 3774,
        authToken: authToken.trim() || null,
      });
    } else {
      await addConnection({
        name: name.trim(),
        host: host.trim(),
        t3Port: parseInt(t3Port, 10) || 3773,
        companionPort: parseInt(companionPort, 10) || 3774,
        authToken: authToken.trim() || null,
      });
    }

    router.back();
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: isEditing ? "Edit Connection" : "Add Connection",
          headerBackTitle: "Back",
        }}
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.form}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.field}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. MacBook Pro, Work Server"
              placeholderTextColor="#4b5563"
              autoFocus
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Host</Text>
            <TextInput
              style={styles.input}
              value={host}
              onChangeText={setHost}
              placeholder="e.g. 192.168.1.100 or my-mac.tail12345.ts.net"
              placeholderTextColor="#4b5563"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.label}>t3code Port</Text>
              <TextInput
                style={styles.input}
                value={t3Port}
                onChangeText={setT3Port}
                placeholder="3773"
                placeholderTextColor="#4b5563"
                keyboardType="number-pad"
              />
            </View>
            <View style={{ width: 12 }} />
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.label}>Companion Port</Text>
              <TextInput
                style={styles.input}
                value={companionPort}
                onChangeText={setCompanionPort}
                placeholder="3774"
                placeholderTextColor="#4b5563"
                keyboardType="number-pad"
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Auth Token</Text>
            <TextInput
              style={styles.input}
              value={authToken}
              onChangeText={setAuthToken}
              placeholder="Optional — from t3code --auth-token"
              placeholderTextColor="#4b5563"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <Text style={styles.hint}>
              Required if t3code was started with --auth-token
            </Text>
          </View>

          {!isEditing && (
            <TouchableOpacity
              style={[styles.button, styles.scanButton]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push("/scan");
              }}
            >
              <Text style={styles.buttonText}>Scan QR Code Instead</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.button, styles.testButton]}
            onPress={handleTest}
            disabled={testing}
          >
            <Text style={styles.buttonText}>
              {testing ? "Testing..." : "Test Connection"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.saveButton]}
            onPress={handleSave}
          >
            <Text style={styles.buttonText}>
              {isEditing ? "Save Changes" : "Add Connection"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  form: { padding: 20, paddingBottom: 100 },
  field: { marginBottom: 20 },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#9ca3af",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: "#1a1a1a",
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: "#fff",
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  hint: {
    fontSize: 12,
    color: "#4b5563",
    marginTop: 4,
  },
  row: { flexDirection: "row" },
  button: {
    borderRadius: 10,
    padding: 16,
    alignItems: "center",
    marginTop: 8,
  },
  scanButton: {
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#10b981",
    marginBottom: 24,
  },
  testButton: {
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#3b82f6",
  },
  saveButton: { backgroundColor: "#3b82f6" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
