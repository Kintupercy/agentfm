import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // VITE_* vars live in the repo-root .env alongside the server's config
  envDir: "../../",
  server: { port: 5180 },
});
