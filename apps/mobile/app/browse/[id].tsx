/**
 * Remote file browser — browse the remote filesystem via the companion server.
 * Lets users pick a folder and open it in t3code.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import {
  loadConnections,
  type ServerConnection,
} from "../../src/lib/connections";
import {
  listDirectory,
  getQuickPaths,
  createProject,
  createFolder,
  type DirectoryEntry,
  type DirectoryListing,
  type QuickPath,
} from "../../src/lib/api";

type SortMode = "name" | "modified";

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else if (diffDays < 365) {
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function sortEntries(
  entries: DirectoryEntry[],
  mode: SortMode
): DirectoryEntry[] {
  return [...entries].sort((a, b) => {
    // Directories always first
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    if (mode === "modified") {
      return new Date(b.modified).getTime() - new Date(a.modified).getTime();
    }
    return a.name.localeCompare(b.name);
  });
}

export default function FileBrowser() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [conn, setConn] = useState<ServerConnection | null>(null);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [quickPaths, setQuickPaths] = useState<QuickPath[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("modified");

  useEffect(() => {
    (async () => {
      const conns = await loadConnections();
      const found = conns.find((c) => c.id === id);
      if (found) {
        setConn(found);
        try {
          const [dir, paths] = await Promise.all([
            listDirectory(found, "~"),
            getQuickPaths(found),
          ]);
          setListing(dir);
          setQuickPaths(paths.paths);
        } catch (err) {
          setError(
            `Could not connect to companion server at ${found.host}:${found.companionPort}`
          );
        }
      } else {
        setError("Connection not found");
      }
      setLoading(false);
    })();
  }, [id]);

  const navigateTo = useCallback(
    async (path: string) => {
      if (!conn) return;
      setLoading(true);
      setError(null);
      try {
        const dir = await listDirectory(conn, path);
        setListing(dir);
      } catch (err) {
        setError(`Failed to list: ${err}`);
      }
      setLoading(false);
    },
    [conn]
  );

  const [creating, setCreating] = useState(false);

  const handleOpenFolder = useCallback(
    (entry: DirectoryEntry) => {
      if (!conn) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      Alert.alert(
        "Open in t3code",
        `Open "${entry.name}" as a project?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Open",
            onPress: async () => {
              setCreating(true);
              try {
                await createProject(conn, entry.path, entry.name);
                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Success
                );
                router.push({
                  pathname: "/connect/[id]",
                  params: { id: conn.id },
                });
              } catch (err) {
                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Error
                );
                Alert.alert("Error", `Failed to create project: ${err}`);
              }
              setCreating(false);
            },
          },
        ]
      );
    },
    [conn, router]
  );

  const handleEntryPress = useCallback(
    (entry: DirectoryEntry) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (entry.isDirectory) {
        navigateTo(entry.path);
      }
    },
    [navigateTo]
  );

  const toggleSort = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSortMode((prev) => (prev === "name" ? "modified" : "name"));
  };

  const handleNewFolder = () => {
    if (!conn || !listing) return;
    Alert.prompt(
      "New Folder",
      `Create a folder in ${listing.path.split("/").pop()}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Create",
          onPress: async (name?: string) => {
            if (!name?.trim()) return;
            try {
              await createFolder(conn, listing.path, name.trim());
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              navigateTo(listing.path); // refresh
            } catch (err) {
              Alert.alert("Error", `Failed to create folder: ${err}`);
            }
          },
        },
      ],
      "plain-text",
      "",
      "default"
    );
  };

  if (error && !conn) {
    return (
      <>
        <Stack.Screen options={{ title: "File Browser" }} />
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      </>
    );
  }

  const currentDir = listing?.path.split("/").pop() || "~";
  const sortedEntries = useMemo(
    () => (listing ? sortEntries(listing.entries, sortMode) : []),
    [listing, sortMode]
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: currentDir,
          headerBackTitle: "Back",
        }}
      />
      <View style={styles.container}>
        {/* Quick paths bar */}
        {quickPaths.length > 0 && (
          <View style={styles.quickBar}>
            <FlatList
              horizontal
              data={quickPaths}
              keyExtractor={(item) => item.path}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickBarContent}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.quickChip}
                  onPress={() => navigateTo(item.path)}
                >
                  <Text style={styles.quickChipText}>{item.name}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        )}

        {/* Path bar + actions */}
        {listing && (
          <View style={styles.pathBar}>
            {listing.parent && (
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => navigateTo(listing.parent!)}
              >
                <SymbolView name="chevron.left" size={16} tintColor="#9ca3af" />
              </TouchableOpacity>
            )}
            <Text style={styles.pathText} numberOfLines={1}>
              {listing.path}
            </Text>
            <TouchableOpacity style={styles.iconButton} onPress={handleNewFolder}>
              <SymbolView name="folder.badge.plus" size={16} tintColor="#9ca3af" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.sortButton} onPress={toggleSort}>
              <SymbolView name="arrow.up.arrow.down" size={14} tintColor="#9ca3af" />
              <Text style={styles.sortLabel}>
                {sortMode === "name" ? "A-Z" : "Date"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.iconButton, styles.openButton]}
              onPress={() =>
                handleOpenFolder({
                  name: currentDir,
                  path: listing.path,
                  isDirectory: true,
                  isSymlink: false,
                  size: 0,
                  modified: new Date().toISOString(),
                  isProject: false,
                })
              }
            >
              <SymbolView name="arrow.right.doc.on.clipboard" size={16} tintColor="#fff" />
            </TouchableOpacity>
          </View>
        )}

        {/* Error banner */}
        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{error}</Text>
          </View>
        )}

        {/* Loading */}
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#3b82f6" />
          </View>
        )}

        {/* Directory listing */}
        {listing && !loading && (
          <FlatList
            data={sortedEntries}
            keyExtractor={(item) => item.path}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.entry}
                onPress={() => handleEntryPress(item)}
                onLongPress={() => {
                  if (item.isDirectory) handleOpenFolder(item);
                }}
                disabled={!item.isDirectory}
              >
                <View style={styles.entryIcon}>
                  <Text style={styles.entryIconText}>
                    {item.isDirectory
                      ? item.isProject
                        ? "📦"
                        : "📁"
                      : "📄"}
                  </Text>
                </View>
                <View style={styles.entryInfo}>
                  <View style={styles.entryNameRow}>
                    <Text
                      style={[
                        styles.entryName,
                        !item.isDirectory && styles.entryNameFile,
                      ]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    {item.isProject && (
                      <Text style={styles.projectBadge}>project</Text>
                    )}
                  </View>
                  <Text style={styles.entryMeta}>
                    {formatDate(item.modified)}
                    {!item.isDirectory && item.size > 0
                      ? `  ${(item.size / 1024).toFixed(1)} KB`
                      : ""}
                  </Text>
                </View>
                {item.isDirectory && (
                  <Text style={styles.chevron}>›</Text>
                )}
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={styles.emptyText}>Empty directory</Text>
              </View>
            }
          />
        )}

        {/* Creating project overlay */}
        {creating && (
          <View style={styles.overlay}>
            <ActivityIndicator size="large" color="#3b82f6" />
            <Text style={styles.overlayText}>Creating project...</Text>
          </View>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  errorText: { color: "#ef4444", fontSize: 15, textAlign: "center" },
  quickBar: {
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  quickBarContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  quickChip: {
    backgroundColor: "#1a1a1a",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  quickChipText: { color: "#9ca3af", fontSize: 13 },
  pathBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
    gap: 8,
  },
  pathText: {
    flex: 1,
    color: "#6b7280",
    fontSize: 12,
    fontFamily: "monospace",
  },
  iconButton: {
    backgroundColor: "#1a1a1a",
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonText: { color: "#9ca3af", fontSize: 14, fontWeight: "600" },
  sortButton: {
    backgroundColor: "#1a1a1a",
    height: 32,
    borderRadius: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    gap: 4,
  },
  sortLabel: { color: "#9ca3af", fontSize: 11, fontWeight: "600" },
  openButton: {
    backgroundColor: "#3b82f6",
  },
  errorBanner: {
    backgroundColor: "#7f1d1d",
    padding: 10,
  },
  errorBannerText: { color: "#fca5a5", fontSize: 13, textAlign: "center" },
  list: { paddingBottom: 100 },
  entry: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#111",
  },
  entryIcon: { width: 32, alignItems: "center" },
  entryIconText: { fontSize: 18 },
  entryInfo: {
    flex: 1,
    marginLeft: 8,
  },
  entryNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  entryName: { fontSize: 15, color: "#fff", flexShrink: 1 },
  entryNameFile: { color: "#6b7280" },
  entryMeta: {
    fontSize: 11,
    color: "#4b5563",
    marginTop: 2,
  },
  projectBadge: {
    fontSize: 10,
    color: "#10b981",
    backgroundColor: "#064e3b",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
    textTransform: "uppercase",
    fontWeight: "600",
  },
  chevron: { color: "#4b5563", fontSize: 20, fontWeight: "300" },
  emptyText: { color: "#4b5563", fontSize: 14 },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.8)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  overlayText: { color: "#fff", marginTop: 12, fontSize: 15 },
});
