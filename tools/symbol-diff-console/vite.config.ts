import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = Number(process.env.SYMBOL_DIFF_API_PORT ?? 5174);

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`
    }
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true
  }
});
