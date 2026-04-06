#!/usr/bin/env node
const { execSync, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

let bunPath;
try {
  bunPath = execSync("which bun", { encoding: "utf-8" }).trim();
} catch {
  const paths = [
    (process.env.HOME || "") + "/.bun/bin/bun",
    "/usr/local/bin/bun",
    "/opt/homebrew/bin/bun",
  ];
  for (const p of paths) {
    try { fs.accessSync(p); bunPath = p; break; } catch {}
  }
}

if (!bunPath) {
  console.error("Error: Bun is required. Install it: https://bun.sh");
  process.exit(1);
}

const serverPath = path.join(__dirname, "..", "src", "index.ts");
const child = spawn(bunPath, ["run", serverPath, ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: path.join(__dirname, ".."),
});

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
