import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // API_PORT=3101 aponta o front-end para outra instância (ex.: a demo).
    proxy: { "/api": `http://127.0.0.1:${process.env.API_PORT ?? 3001}` },
  },
});
