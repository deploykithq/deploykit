import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./src/shared"),
      "@lib": path.resolve(__dirname, "./src/lib"),
      "@auth": path.resolve(__dirname, "./src/features/auth"),
      "@layout": path.resolve(__dirname, "./src/features/layout"),
      "@settings": path.resolve(__dirname, "./src/features/settings"),
      "@project": path.resolve(__dirname, "./src/features/project"),
      "@server": path.resolve(__dirname, "./src/features/server"),
      "@users": path.resolve(__dirname, "./src/features/users"),
      "@database": path.resolve(__dirname, "./src/features/database"),
      "@audit": path.resolve(__dirname, "./src/features/audit"),
      "@metrics": path.resolve(__dirname, "./src/features/metrics"),
      "@application": path.resolve(__dirname, "./src/features/application"),
      "@dashboard": path.resolve(__dirname, "./src/features/dashboard"),
      "@templates": path.resolve(__dirname, "./src/features/templates"),
      "@status": path.resolve(__dirname, "./src/features/status"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-charts": ["recharts"],
          "vendor-terminal": ["@xterm/xterm"],
          "vendor-tanstack": ["@tanstack/react-query", "@tanstack/react-router"],
          "vendor-socket": ["socket.io-client"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/trpc": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/ws": {
        target: "http://localhost:3001",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
