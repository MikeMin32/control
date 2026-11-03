import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#f7f7f5",
        surface: "#ffffff",
        sidebar: "#eef0ee",
        "sidebar-active": "#e3e7e4",
        ink: "#1a1c1a",
        muted: "#6b716c",
        line: "#e2e4e1",
        "line-strong": "#d0d4d0",
        mint: {
          DEFAULT: "#c8e6d0",
          strong: "#9fd0ad",
          text: "#1f4d32",
        },
      },
      fontFamily: {
        sans: [
          "IBM Plex Sans",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(26, 28, 26, 0.04)",
      },
      borderRadius: {
        slate: "8px",
      },
    },
  },
  plugins: [],
};
export default config;
