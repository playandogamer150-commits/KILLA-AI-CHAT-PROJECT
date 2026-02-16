import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Allow Next.js-style `NEXT_PUBLIC_` envs in Vite (needed for Clerk publishable key naming).
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  server: {
    allowedHosts: [".trycloudflare.com", "localhost"],
    proxy: {
      // Local backend (ModelsLab/xAI) to keep API keys off the client.
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
