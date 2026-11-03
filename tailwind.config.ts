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
        canvas: "#f6f7f6",
        surface: "#ffffff",
        sidebar: "#f0f1f0",
        "sidebar-active": "#e4e6e4",
        ink: "#151715",
        muted: "#6a706b",
        line: "#e6e8e6",
        "line-strong": "#d5d8d5",
        mint: {
          DEFAULT: "#cfead6",
          strong: "#b5dcc0",
          text: "#1a4a2e",
          soft: "#e5f5ea",
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
        soft: "0 1px 2px rgba(21, 23, 21, 0.04)",
      },
      borderRadius: {
        slate: "8px",
        pill: "999px",
      },
    },
  },
  plugins: [],
};
export default config;
