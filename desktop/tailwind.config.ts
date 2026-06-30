import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: {
          bg: "hsl(var(--app-bg))",
          panel: "hsl(var(--app-panel))",
          canvas: "hsl(var(--app-canvas))",
          line: "hsl(var(--app-line))",
          muted: "hsl(var(--app-muted))",
          text: "hsl(var(--app-text))",
          blue: "hsl(var(--app-blue))",
        },
      },
      borderRadius: {
        shell: "24px",
        panel: "18px",
        control: "12px",
      },
      boxShadow: {
        panel: "0 18px 55px rgba(15, 23, 42, 0.08)",
        control: "0 1px 2px rgba(15, 23, 42, 0.08)",
        inset: "inset 0 1px 0 rgba(255, 255, 255, 0.75)",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "PingFang SC",
          "Microsoft YaHei",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
