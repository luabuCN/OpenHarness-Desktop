import { spawn } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

// `pnpm dev` runs the tsx API server on the same port the sidecar would bind,
// so tell the Tauri process (see src-tauri/src/main.rs) never to spawn its own
// sidecar — the two race for the port at startup and either side may lose.
const child = spawn("pnpm exec tauri dev", {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, OPENHARNESS_SKIP_SIDECAR: "1" },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(`failed to launch tauri dev: ${error.message}`);
  process.exit(1);
});

child.on("close", (code) => process.exit(code ?? 1));
