import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "esnext",
    minify: "terser",
    rollupOptions: {
      input: {
        main: "index.html",
      },
      output: {
        entryFileNames: "index.js",
        chunkFileNames: "index.js",
        assetFileNames: "index[extname]",
      },
    },
  },
});
