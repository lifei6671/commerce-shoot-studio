import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "vendor-react",
              test: /node_modules[\\/](react|react-dom)[\\/]/,
              priority: 60,
            },
            {
              name: "vendor-react-flow",
              test: /node_modules[\\/](@xyflow|d3-|d3)[\\/]/,
              priority: 50,
            },
            {
              name: "vendor-dnd",
              test: /node_modules[\\/]@dnd-kit[\\/]/,
              priority: 45,
            },
            {
              name: "vendor-table",
              test: /node_modules[\\/]@tanstack[\\/]react-table[\\/]/,
              priority: 45,
            },
            {
              name: "vendor-uppy",
              test: /node_modules[\\/]@uppy[\\/]/,
              priority: 45,
            },
            {
              name: "vendor-tauri",
              test: /node_modules[\\/]@tauri-apps[\\/]/,
              priority: 40,
            },
            {
              name: "vendor-ui",
              test: /node_modules[\\/](@radix-ui|lucide-react|react-resizable-panels|class-variance-authority|clsx|tailwind-merge)[\\/]/,
              priority: 35,
            },
            {
              name: "vendor",
              test: /node_modules[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
});
