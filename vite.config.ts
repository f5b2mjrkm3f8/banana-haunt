import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

export default defineConfig(({ mode }) => ({
server: {
host: "::",
port: 8080,
},
plugins: [
react(),
mode === "development" && componentTagger(),
].filter(Boolean),
build: {
cssCodeSplit: false,
assetsInlineLimit: 0, // 画像は外部ファイルとして出力（後で Actions が埋め込む）
},
resolve: {
alias: {
"@": path.resolve(__dirname, "./src"),
},
},
}));
