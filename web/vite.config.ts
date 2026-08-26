import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type PluginOption } from "vite";

export default defineConfig({
  // pnpm may resolve a second vite copy for @tailwindcss/vite's peer dep;
  // the plugin is runtime-compatible, silence the duplicate-package typing.
  plugins: [react(), tailwindcss() as unknown as PluginOption],
  clearScreen: false,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
