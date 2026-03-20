import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Solana/Anchor dependencies rely on Node built-ins (Buffer, process, global).
// Vite does not polyfill these by default — the define + alias below restore them.
export default defineConfig({
  plugins: [react()],
  define: {
    "process.env": {},
    global: "globalThis",
  },
  resolve: {
    alias: {
      buffer: "buffer",
    },
  },
});
