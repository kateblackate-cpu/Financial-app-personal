import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" keeps every asset reference relative, so the built `dist/`
// folder works when served from a domain root (Vercel) or a sub-path (Replit).
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", assetsDir: "assets" },
  server: { host: true },
});
