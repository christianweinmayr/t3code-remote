/**
 * Connection list — the home screen.
 * Shows saved server connections with status indicators.
 */

import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  RefreshControl,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  loadConnections,
  deleteConnection,
  type ServerConnection,
} from "../src/lib/connections";
import { checkT3Health, checkCompanionHealth } from "../src/lib/api";

type ConnectionStatus = "checking" | "online" | "offline" | "partial";

interface ConnectionWithStatus extends ServerConnection {
  status: ConnectionStatus;
  companionOnline: boolean;
}

export default function ConnectionList() {
  const router = useRouter();
  const [connections, setConnections] = useState<ConnectionWithStatus[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadAndCheck = useCallback(async () => {
    const conns = await loadConnections();
    // Show immediately with "checking" status
    setConnections(
      conns.map((c) => ({ ...c, status: "checking", companionOnline: false }))
    );

    // Check health in parallel
    const checked = await Promise.all(
      conns.map(async (conn) => {
        let companionOnline = false;
        let t3Online = false;

        // Check companion and t3code independently with short timeouts
        try {
          await checkCompanionHealth(conn);
          companionOnline = true;
        } catch {}

        try {
          t3Online = await checkT3Health(conn);
        } catch {}

        const status: ConnectionStatus =
          companionOnline && t3Online
            ? "online"
            : companionOnline || t3Online
              ? "partial"
              : "offline";

        return { ...conn, status, companionOnline };
      })
    );

    setConnections(checked);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAndCheck();
    }, [loadAndCheck])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAndCheck();
    setRefreshing(false);
  }, [loadAndCheck]);

  const handleDelete = (conn: ConnectionWithStatus) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Delete Connection",
      `Remove "${conn.name}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteConnection(conn.id);
            loadAndCheck();
          },
        },
      ]
    );
  };

  const handleConnect = (conn: ConnectionWithStatus) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (conn.status === "offline") {
      Alert.alert(
        "Server Offline",
        `${conn.name} is not reachable. Check that the companion server and t3code are running on ${conn.host}.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Retry", onPress: () => loadAndCheck() },
          {
            text: "Connect Anyway",
            onPress: () =>
              router.push({
                pathname: "/connect/[id]",
                params: { id: conn.id },
              }),
          },
        ]
      );
      return;
    }

    router.push({
      pathname: "/connect/[id]",
      params: { id: conn.id },
    });
  };

  const statusDot = (status: ConnectionStatus) => {
    const colors = {
      checking: "#6b7280",
      online: "#10b981",
      partial: "#f59e0b",
      offline: "#ef4444",
    };
    return (
      <View
        style={[styles.statusDot, { backgroundColor: colors[status] }]}
      />
    );
  };

  const statusLabel = (status: ConnectionStatus, companionOnline: boolean) => {
    if (status === "checking") return "Checking...";
    if (status === "online") return "Online";
    if (status === "partial")
      return companionOnline ? "t3 offline" : "No companion";
    return "Offline";
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>T3 Code Remote</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/scan");
          }}
        >
          <Text style={styles.addButtonText}>+ Pair</Text>
        </TouchableOpacity>
      </View>

      {connections.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No connections yet</Text>
          <Text style={styles.emptySubtitle}>
            Pair with a machine running t3code to get started.
          </Text>
          <Text style={styles.emptyHint}>
            On your dev machine, run:{"\n"}
            <Text style={styles.code}>bun run start</Text>{"\n"}
            in the companion directory, then scan the QR code.
          </Text>
        </View>
      ) : (
        <FlatList
          data={connections}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#fff"
            />
          }
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.card,
                { borderLeftColor: item.color, borderLeftWidth: 4 },
              ]}
              onPress={() => handleConnect(item)}
              onLongPress={() => handleDelete(item)}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.cardName} numberOfLines={1}>
                  {item.name}
                </Text>
                <View style={styles.cardActions}>
                  <View style={styles.statusRow}>
                    {statusDot(item.status)}
                    <Text style={styles.statusText}>
                      {statusLabel(item.status, item.companionOnline)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleDelete(item)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Text style={styles.deleteButton}>X</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={styles.cardHost}>
                {item.host}:{item.t3Port}
              </Text>
              {item.lastConnectedAt && (
                <Text style={styles.cardMeta}>
                  Last connected:{" "}
                  {new Date(item.lastConnectedAt).toLocaleDateString()}
                </Text>
              )}
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
  },
  title: { fontSize: 28, fontWeight: "700", color: "#fff" },
  addButton: {
    backgroundColor: "#3b82f6",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#fff",
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: "#9ca3af",
    textAlign: "center",
    marginBottom: 24,
  },
  emptyHint: {
    fontSize: 13,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 20,
  },
  code: {
    fontFamily: "monospace",
    color: "#3b82f6",
    fontSize: 14,
  },
  list: { padding: 16, paddingBottom: 100 },
  card: {
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  cardName: { fontSize: 17, fontWeight: "600", color: "#fff" },
  cardActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  deleteButton: {
    color: "#6b7280",
    fontSize: 14,
    fontWeight: "700",
    paddingHorizontal: 4,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, color: "#9ca3af" },
  cardHost: { fontSize: 13, color: "#6b7280", fontFamily: "monospace" },
  cardMeta: { fontSize: 11, color: "#4b5563", marginTop: 4 },
});
