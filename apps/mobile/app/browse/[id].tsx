/**
 * Remote file browser.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
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
  addBookmark,
  removeBookmark,
  type DirectoryEntry,
  type DirectoryListing,
  type QuickPath,
} from "../../src/lib/api";

type SortMode = "name" | "modified";

function formatDate(iso: string): string {
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
  if (days < 365) return d.toLocaleDateString([], { month: "short", day: "numeric" });
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function sortEntries(entries: DirectoryEntry[], mode: SortMode): DirectoryEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    if (mode === "modified")
      return new Date(b.modified).getTime() - new Date(a.modified).getTime();
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
  const [creating, setCreating] = useState(false);

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
        } catch {
          setError("Could not connect to companion server");
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

  const handleOpenFolder = useCallback(
    (entry: DirectoryEntry) => {
      if (!conn) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      Alert.alert("Open as Project", `Open "${entry.name}" in T3 Code?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Open",
          onPress: async () => {
            setCreating(true);
            try {
              await createProject(conn, entry.path, entry.name);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              router.push({ pathname: "/connect/[id]", params: { id: conn.id } });
            } catch (err) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert("Error", `${err}`);
            }
            setCreating(false);
          },
        },
      ]);
    },
    [conn, router]
  );

  const handleEntryPress = useCallback(
    (entry: DirectoryEntry) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (entry.isDirectory) navigateTo(entry.path);
    },
    [navigateTo]
  );

  const toggleSort = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSortMode((prev) => (prev === "name" ? "modified" : "name"));
  };

  const handleToggleBookmark = useCallback(
    async (entry: DirectoryEntry) => {
      if (!conn) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const isBookmarked = quickPaths.some((q) => q.path === entry.path);
      try {
        if (isBookmarked) {
          await removeBookmark(conn, entry.path);
          setQuickPaths((prev) => prev.filter((q) => q.path !== entry.path));
        } else {
          await addBookmark(conn, entry.path, entry.name);
          setQuickPaths((prev) => [...prev, { name: entry.name, path: entry.path, exists: true }]);
        }
      } catch {}
    },
    [conn, quickPaths]
  );

  const handleRemoveBookmark = useCallback(
    (qp: QuickPath) => {
      if (!conn) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      Alert.alert("Remove Shortcut", `Remove "${qp.name}"?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await removeBookmark(conn, qp.path);
              setQuickPaths((prev) => prev.filter((q) => q.path !== qp.path));
            } catch {}
          },
        },
      ]);
    },
    [conn]
  );

  const handleNewFolder = () => {
    if (!conn || !listing) return;
    Alert.prompt(
      "New Folder",
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Create",
          onPress: async (name?: string) => {
            if (!name?.trim()) return;
            try {
              await createFolder(conn, listing.path, name.trim());
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              navigateTo(listing.path);
            } catch (err) {
              Alert.alert("Error", `${err}`);
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
        <Stack.Screen options={{ title: "Files" }} />
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
          headerRight: () => (
            <View style={styles.headerRight}>
              <TouchableOpacity onPress={handleNewFolder} style={styles.headerBtn}>
                <SymbolView name="folder.badge.plus" size={18} tintColor="#fff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={toggleSort} style={styles.sortBtn}>
                <SymbolView name="arrow.up.arrow.down" size={14} tintColor="#fff" />
                <Text style={styles.sortBtnText}>{sortMode === "name" ? "A-Z" : "Date"}</Text>
              </TouchableOpacity>
              {listing && (
                <TouchableOpacity
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
                  style={styles.openBtn}
                >
                  <Text style={styles.openBtnText}>Open</Text>
                </TouchableOpacity>
              )}
            </View>
          ),
        }}
      />
      <View style={styles.container}>
        {/* Quick paths */}
        {quickPaths.length > 0 && (
          <View style={styles.quickBar}>
            <FlatList
              horizontal
              data={quickPaths}
              keyExtractor={(item) => item.path}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickBarInner}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.quickChip,
                    listing?.path === item.path && styles.quickChipActive,
                  ]}
                  onPress={() => navigateTo(item.path)}
                  onLongPress={() => handleRemoveBookmark(item)}
                >
                  <Text
                    style={[
                      styles.quickChipText,
                      listing?.path === item.path && styles.quickChipTextActive,
                    ]}
                  >
                    {item.name}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        )}

        {/* Path breadcrumb */}
        {listing && (
          <View style={styles.breadcrumb}>
            {listing.parent && (
              <TouchableOpacity onPress={() => navigateTo(listing.parent!)}>
                <Text style={styles.breadcrumbBack}>
                  {"< "}{listing.parent.split("/").pop() || "/"}
                </Text>
              </TouchableOpacity>
            )}
            <Text style={styles.breadcrumbPath} numberOfLines={1}>
              {listing.path}
            </Text>
            <Text style={styles.breadcrumbCount}>
              {listing.entries.length} items
            </Text>
          </View>
        )}

        {/* Error */}
        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{error}</Text>
          </View>
        )}

        {/* Loading */}
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator size="small" color="#555" />
          </View>
        )}

        {/* File list */}
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
                activeOpacity={item.isDirectory ? 0.6 : 1}
              >
                <View style={styles.entryLeft}>
                  <Text style={styles.entryName} numberOfLines={1}>
                    {item.isDirectory ? (item.isProject ? "+" : "+") : " "}{" "}
                    <Text style={item.isDirectory ? styles.entryNameDir : styles.entryNameFile}>
                      {item.name}
                    </Text>
                  </Text>
                  <View style={styles.entryMeta}>
                    <Text style={styles.entryDate}>{formatDate(item.modified)}</Text>
                    {!item.isDirectory && item.size > 0 && (
                      <Text style={styles.entrySize}>{formatSize(item.size)}</Text>
                    )}
                    {item.isProject && (
                      <View style={styles.projectBadge}>
                        <Text style={styles.projectBadgeText}>PROJECT</Text>
                      </View>
                    )}
                  </View>
                </View>
                {item.isDirectory && (
                  <View style={styles.entryActions}>
                    <TouchableOpacity
                      style={styles.starBtn}
                      onPress={() => handleToggleBookmark(item)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={[
                        styles.starIcon,
                        quickPaths.some((q) => q.path === item.path) && styles.starIconActive,
                      ]}>
                        {quickPaths.some((q) => q.path === item.path) ? "*" : "*"}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.entryOpenBtn}
                      onPress={() => handleOpenFolder(item)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.entryOpenText}>Open</Text>
                    </TouchableOpacity>
                    <Text style={styles.chevron}>{">"}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={styles.emptyText}>Empty</Text>
              </View>
            }
          />
        )}

        {/* Creating overlay */}
        {creating && (
          <View style={styles.overlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.overlayText}>Opening project...</Text>
          </View>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  errorText: { color: "#f87171", fontSize: 14, textAlign: "center" },

  // Header
  headerRight: { flexDirection: "row", alignItems: "center", gap: 24, paddingRight: 8 },
  headerBtn: { padding: 10 },
  sortBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    padding: 10,
  },
  sortBtnText: { color: "#fff", fontSize: 12, fontWeight: "500" },
  openBtn: {
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 14,
  },
  openBtnText: { color: "#000", fontSize: 13, fontWeight: "600" },

  // Quick paths
  quickBar: {
    borderBottomWidth: 1,
    borderBottomColor: "#111",
  },
  quickBarInner: { paddingHorizontal: 16, paddingVertical: 10, gap: 6 },
  quickChip: {
    backgroundColor: "#111",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
  },
  quickChipActive: {
    backgroundColor: "#fff",
  },
  quickChipText: { color: "#666", fontSize: 13 },
  quickChipTextActive: { color: "#000" },

  // Breadcrumb
  breadcrumb: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#111",
    gap: 8,
  },
  breadcrumbBack: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "500",
  },
  breadcrumbPath: {
    flex: 1,
    color: "#444",
    fontSize: 11,
    fontFamily: "monospace",
  },
  breadcrumbCount: {
    color: "#333",
    fontSize: 11,
  },

  // Error
  errorBanner: {
    backgroundColor: "#1a0000",
    borderBottomWidth: 1,
    borderBottomColor: "#2d0a0a",
    padding: 10,
  },
  errorBannerText: { color: "#f87171", fontSize: 13, textAlign: "center" },

  // List
  list: { paddingBottom: 100 },

  // Entry
  entry: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: "#0d0d0d",
  },
  entryLeft: { flex: 1 },
  entryName: {
    fontSize: 15,
    color: "#fff",
    marginBottom: 2,
  },
  entryNameDir: { color: "#fff", fontWeight: "400" },
  entryNameFile: { color: "#555" },
  entryMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  entryDate: { fontSize: 11, color: "#333" },
  entrySize: { fontSize: 11, color: "#333" },
  projectBadge: {
    backgroundColor: "#052e1c",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  projectBadgeText: {
    fontSize: 9,
    color: "#34d399",
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  entryActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  starBtn: { padding: 2 },
  starIcon: { fontSize: 18, color: "#333" },
  starIconActive: { color: "#fbbf24" },
  entryOpenBtn: {
    borderWidth: 1,
    borderColor: "#222",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  entryOpenText: { color: "#666", fontSize: 11, fontWeight: "500" },
  chevron: { color: "#333", fontSize: 16, fontWeight: "300" },
  emptyText: { color: "#333", fontSize: 14 },
  overlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  overlayText: { color: "#fff", marginTop: 12, fontSize: 15 },
});
