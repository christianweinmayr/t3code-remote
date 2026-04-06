/**
 * Connection list — the home screen.
 */

import { useCallback, useState } from "react";
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
import { checkT3Health, checkCompanionHealth, validateSession } from "../src/lib/api";

type ConnectionStatus = "checking" | "online" | "offline" | "partial" | "expired";

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
    setConnections(
      conns.map((c) => ({ ...c, status: "checking", companionOnline: false }))
    );

    const checked = await Promise.all(
      conns.map(async (conn) => {
        let companionOnline = false;
        let t3Online = false;
        let sessionValid = true;

        try {
          await checkCompanionHealth(conn);
          companionOnline = true;
        } catch {}

        if (companionOnline && conn.companionToken) {
          sessionValid = await validateSession(conn);
        }

        try {
          t3Online = await checkT3Health(conn);
        } catch {}

        const status: ConnectionStatus = !sessionValid
          ? "expired"
          : companionOnline && t3Online
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
      "Remove Server",
      `Remove "${conn.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
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

    if (conn.status === "expired") {
      Alert.alert(
        "Session Expired",
        "Re-pair this device to reconnect.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Re-pair", onPress: () => router.push("/scan") },
        ]
      );
      return;
    }

    if (conn.status === "offline") {
      Alert.alert(
        "Server Offline",
        `${conn.name} is not reachable.`,
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

  const statusConfig: Record<ConnectionStatus, { color: string; label: string; bg: string }> = {
    checking: { color: "#6b7280", label: "Checking", bg: "#1c1c1e" },
    online: { color: "#34d399", label: "Online", bg: "#052e1c" },
    partial: { color: "#fbbf24", label: "Partial", bg: "#2d2305" },
    offline: { color: "#f87171", label: "Offline", bg: "#2d0a0a" },
    expired: { color: "#f87171", label: "Expired", bg: "#2d0a0a" },
  };

  const formatLastSeen = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "Yesterday";
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Servers</Text>
        <TouchableOpacity
          style={styles.pairButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/scan");
          }}
        >
          <Text style={styles.pairButtonText}>+ Pair</Text>
        </TouchableOpacity>
      </View>

      {connections.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>T3</Text>
          <Text style={styles.emptyTitle}>No servers paired</Text>
          <Text style={styles.emptyBody}>
            Run the companion server on your dev machine, then tap Pair to scan the QR code.
          </Text>
          <TouchableOpacity
            style={styles.emptyButton}
            onPress={() => router.push("/scan")}
          >
            <Text style={styles.emptyButtonText}>Pair a Server</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={connections}
          keyExtractor={(item) => item.id}
          numColumns={2}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#555"
            />
          }
          contentContainerStyle={styles.list}
          columnWrapperStyle={styles.row}
          renderItem={({ item }) => {
            const sc = statusConfig[item.status];
            const lastSeen = formatLastSeen(item.lastConnectedAt);

            return (
              <TouchableOpacity
                style={styles.card}
                onPress={() => handleConnect(item)}
                onLongPress={() => handleDelete(item)}
                activeOpacity={0.7}
              >
                {/* Top row: name + delete */}
                <View style={styles.cardTop}>
                  <Text style={styles.cardName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <TouchableOpacity
                    onPress={() => handleDelete(item)}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    style={styles.deleteHit}
                  >
                    <Text style={styles.deleteIcon}>x</Text>
                  </TouchableOpacity>
                </View>

                {/* Host */}
                <Text style={styles.cardHost}>
                  {item.host}:{item.t3Port}
                </Text>

                {/* Bottom row: status + last seen */}
                <View style={styles.cardBottom}>
                  <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                    <View style={[styles.statusDot, { backgroundColor: sc.color }]} />
                    <Text style={[styles.statusLabel, { color: sc.color }]}>
                      {sc.label}
                    </Text>
                  </View>
                  {lastSeen && (
                    <Text style={styles.lastSeen}>{lastSeen}</Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 64,
    paddingBottom: 12,
  },
  title: {
    fontSize: 34,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: -0.5,
  },
  pairButton: {
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  pairButtonText: {
    color: "#000",
    fontSize: 14,
    fontWeight: "600",
  },

  // Empty state
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 48,
  },
  emptyIcon: {
    fontSize: 32,
    fontWeight: "800",
    color: "#333",
    marginBottom: 16,
    letterSpacing: -1,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
    marginBottom: 8,
  },
  emptyBody: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 28,
  },
  emptyButton: {
    backgroundColor: "#fff",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
  },
  emptyButtonText: {
    color: "#000",
    fontSize: 15,
    fontWeight: "600",
  },

  // List
  list: { padding: 12, paddingBottom: 100 },
  row: { gap: 10, marginBottom: 10 },

  // Card
  card: {
    flex: 1,
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#1c1c1e",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  cardName: {
    fontSize: 16,
    fontWeight: "500",
    color: "#fff",
    flex: 1,
    marginRight: 12,
  },
  deleteHit: {
    padding: 4,
  },
  deleteIcon: {
    color: "#444",
    fontSize: 13,
    fontWeight: "400",
  },
  cardHost: {
    fontSize: 12,
    color: "#555",
    fontFamily: "monospace",
    marginBottom: 12,
  },
  cardBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    fontSize: 11,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  lastSeen: {
    fontSize: 11,
    color: "#444",
  },
});
