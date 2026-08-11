import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname, "desktop"),
  base: "./",
  publicDir: resolve(__dirname, "public"),
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname),
      "next/image": resolve(__dirname, "desktop/next-image-shim.tsx")
    }
  },
  build: {
    outDir: resolve(__dirname, "desktop-dist"),
    emptyOutDir: true
  },
  server: {
    strictPort: true
  }
});
