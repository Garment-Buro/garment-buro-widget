import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        archive: {
          paper: "#F3F3F3",
          ink: "#151515",
          muted: "#676767",
          line: "#D8D8D4",
          steel: "#A9B0B3",
          glass: "rgba(255,255,255,0.68)"
        }
      },
      boxShadow: {
        archive: "0 18px 50px rgba(22, 24, 24, 0.08)",
        fine: "0 1px 0 rgba(255,255,255,0.8) inset, 0 1px 16px rgba(0,0,0,0.05)"
      }
    }
  },
  plugins: []
};

export default config;
