/**
 * Remote filesystem browsing API.
 * Provides directory listing so the iPad app can pick project folders.
 */

import { readdir, stat, access, constants, realpath, readFile, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname, sep } from "node:path";
import { homedir } from "node:os";

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  modified: string;
  isProject: boolean;
}

export interface DirectoryListing {
  path: string;
  parent: string | null;
  entries: DirectoryEntry[];
}

/** Files/dirs that indicate a directory is a project root */
const PROJECT_MARKERS = [
  "package.json", ".git", "Cargo.toml", "go.mod", "pyproject.toml",
  "Makefile", "CMakeLists.txt", ".xcodeproj", ".xcworkspace",
  "pubspec.yaml", "build.gradle", "pom.xml",
];

/** Directories to hide from browsing */
const HIDDEN_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg", "__pycache__",
  ".cache", ".Trash", "Library",
]);

/** Allowed root directories for filesystem access */
const ALLOWED_ROOTS = [homedir(), "/tmp", "/var/tmp"];

/**
 * Validate that a resolved path is within an allowed root directory.
 * Uses path segment boundary checking to prevent prefix bypass attacks.
 */
export function assertAllowedPath(resolvedPath: string): void {
  const normalized = resolve(resolvedPath);
  const isAllowed = ALLOWED_ROOTS.some((root) => {
    const normalizedRoot = resolve(root);
    return (
      normalized === normalizedRoot ||
      normalized.startsWith(normalizedRoot + sep)
    );
  });
  if (!isAllowed) {
    throw new Error(`Access denied: path is outside allowed directories`);
  }
}

/**
 * Validate a path after resolving symlinks.
 * Prevents symlink traversal outside allowed roots.
 */
async function assertRealPath(path: string): Promise<string> {
  const real = await realpath(path);
  assertAllowedPath(real);
  return real;
}

/**
 * List directory contents for remote browsing.
 */
export async function listDirectory(
  dirPath: string,
  options: { showHidden?: boolean } = {}
): Promise<DirectoryListing> {
  const resolvedPath = resolve(dirPath.replace(/^~/, homedir()));
  assertAllowedPath(resolvedPath);

  // Resolve symlinks to prevent traversal
  const realDir = await assertRealPath(resolvedPath);

  await access(realDir, constants.R_OK);

  const entries = await readdir(realDir, { withFileTypes: true });
  const results: DirectoryEntry[] = [];

  // Process entries in parallel for performance
  const entryPromises = entries
    .filter((entry) => {
      if (!options.showHidden && entry.name.startsWith(".")) return false;
      if (HIDDEN_DIRS.has(entry.name)) return false;
      return true;
    })
    .map(async (entry): Promise<DirectoryEntry | null> => {
      const fullPath = join(realDir, entry.name);
      const isSymlink = entry.isSymbolicLink();

      try {
        // For symlinks, resolve and validate the real target
        if (isSymlink) {
          try {
            await assertRealPath(fullPath);
          } catch {
            // Symlink points outside allowed roots — skip it
            return null;
          }
        }

        const stats = await stat(fullPath);
        const isDir = stats.isDirectory();

        const isProject = isDir ? await checkIsProject(fullPath) : false;

        return {
          name: entry.name,
          path: fullPath,
          isDirectory: isDir,
          isSymlink,
          size: stats.size,
          modified: stats.mtime.toISOString(),
          isProject,
        };
      } catch {
        return null;
      }
    });

  const resolved = await Promise.all(entryPromises);
  for (const entry of resolved) {
    if (entry) results.push(entry);
  }

  // Sort: directories first, then alphabetically
  results.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const parent = realDir === homedir() ? null : dirname(realDir);

  return { path: realDir, parent, entries: results };
}

async function checkIsProject(dirPath: string): Promise<boolean> {
  // Check all markers in parallel
  const checks = PROJECT_MARKERS.map(async (marker) => {
    try {
      await access(join(dirPath, marker), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  });
  const results = await Promise.all(checks);
  return results.some(Boolean);
}

// --- Bookmarks (persisted to disk) ---

const BOOKMARKS_FILE = join(homedir(), ".t3code-remote", "bookmarks.json");

interface Bookmark {
  name: string;
  path: string;
}

function loadBookmarks(): Bookmark[] {
  try {
    const raw = readFileSync(BOOKMARKS_FILE, "utf-8");
    return JSON.parse(raw) as Bookmark[];
  } catch {
    return [];
  }
}

function saveBookmarks(bookmarks: Bookmark[]): void {
  try {
    mkdirSync(dirname(BOOKMARKS_FILE), { recursive: true });
    writeFileSync(BOOKMARKS_FILE, JSON.stringify(bookmarks, null, 2));
  } catch {}
}

export function addBookmarkPath(path: string, name: string): void {
  const bookmarks = loadBookmarks();
  if (!bookmarks.some((b) => b.path === path)) {
    bookmarks.push({ name, path });
    saveBookmarks(bookmarks);
  }
}

export function removeBookmarkPath(path: string): void {
  const bookmarks = loadBookmarks();
  saveBookmarks(bookmarks.filter((b) => b.path !== path));
}

/**
 * Get quick-access bookmarks: defaults + custom.
 */
export function getQuickPaths(): Array<{ name: string; path: string }> {
  const home = homedir();
  const defaults = [
    { name: "Home", path: home },
    { name: "Desktop", path: join(home, "Desktop") },
    { name: "Documents", path: join(home, "Documents") },
    { name: "Projects", path: join(home, "Projects") },
    { name: "Developer", path: join(home, "Developer") },
    { name: "Code", path: join(home, "Code") },
    { name: "repos", path: join(home, "repos") },
    { name: "src", path: join(home, "src") },
    { name: "GIT", path: join(home, "GIT") },
    { name: "GitHub", path: join(home, "GitHub") },
    { name: "workspace", path: join(home, "workspace") },
    { name: "tmp", path: "/tmp" },
  ];

  const custom = loadBookmarks();
  const allPaths = new Set(defaults.map((d) => d.path));
  const merged = [...defaults];

  for (const b of custom) {
    if (!allPaths.has(b.path)) {
      merged.push(b);
      allPaths.add(b.path);
    }
  }

  return merged;
}

/**
 * Quick-scan a directory for project subdirectories.
 */
export async function scanForProjects(
  rootPath: string,
  maxDepth: number = 2
): Promise<DirectoryEntry[]> {
  const resolvedPath = resolve(rootPath.replace(/^~/, homedir()));
  assertAllowedPath(resolvedPath);

  const realRoot = await assertRealPath(resolvedPath);
  const projects: DirectoryEntry[] = [];
  let dirsScanned = 0;
  const MAX_DIRS = 500;

  async function scan(dir: string, depth: number) {
    if (depth > maxDepth || projects.length > 50 || dirsScanned > MAX_DIRS) return;
    dirsScanned++;

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        if (HIDDEN_DIRS.has(entry.name)) continue;
        if (projects.length > 50 || dirsScanned > MAX_DIRS) break;

        const fullPath = join(dir, entry.name);

        // Validate symlink targets
        if (entry.isSymbolicLink()) {
          try {
            await assertRealPath(fullPath);
          } catch {
            continue;
          }
        }

        const isProj = await checkIsProject(fullPath);

        if (isProj) {
          const stats = await stat(fullPath);
          projects.push({
            name: entry.name,
            path: fullPath,
            isDirectory: true,
            isSymlink: entry.isSymbolicLink(),
            size: 0,
            modified: stats.mtime.toISOString(),
            isProject: true,
          });
        } else if (depth < maxDepth) {
          await scan(fullPath, depth + 1);
        }
      }
    } catch {
      // skip inaccessible directories
    }
  }

  await scan(realRoot, 0);
  return projects;
}
