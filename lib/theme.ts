import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
  globalCss: {
    "html, body": {
      background: "rink.bg",
      color: "rink.text",
      fontFamily:
        'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    },
    "html.dark": { colorScheme: "dark" },
    "html.light": { colorScheme: "light" },
    "::-webkit-scrollbar": { width: "8px", height: "8px" },
    "::-webkit-scrollbar-thumb": { background: "rink.border", borderRadius: "4px" },
    "::-webkit-scrollbar-track": { background: "transparent" },
  },
  theme: {
    tokens: {
      radii: {
        sm: { value: "6px" },
        md: { value: "8px" },
        lg: { value: "10px" },
      },
      fonts: {
        mono: {
          value:
            'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
        },
      },
    },
    semanticTokens: {
      colors: {
        rink: {
          bg: { value: { base: "#F3F5F8", _dark: "#0E1116" } },
          surface: { value: { base: "#FFFFFF", _dark: "#151A21" } },
          surface2: { value: { base: "#EAEEF3", _dark: "#1B222B" } },
          hover: { value: { base: "#E1E7EE", _dark: "#222A35" } },
          border: { value: { base: "#DCE2EA", _dark: "#252D38" } },
          text: { value: { base: "#141A21", _dark: "#EEF2F6" } },
          sub: { value: { base: "#3F4A57", _dark: "#AAB4C0" } },
          muted: { value: { base: "#5E6978", _dark: "#7D8896" } },
          accent: { value: { base: "#1467A8", _dark: "#5BB8F0" } },
          accentFg: { value: { base: "#FFFFFF", _dark: "#0E1116" } },
          pos: { value: { base: "#0E7A4F", _dark: "#3FCF8E" } },
          neg: { value: { base: "#B3352C", _dark: "#EF6F6C" } },
          warn: { value: { base: "#8A6218", _dark: "#E0A93B" } },
        },
        // Letter-grade chips: tinted surface, saturated ink, by tier.
        grade: {
          aBg: { value: { base: "#D9F0E3", _dark: "#10301F" } },
          aFg: { value: { base: "#0B6B3A", _dark: "#5FD69A" } },
          bBg: { value: { base: "#DCEBF7", _dark: "#132A3F" } },
          bFg: { value: { base: "#1A5A8F", _dark: "#7DB9EE" } },
          cBg: { value: { base: "#F4EAD1", _dark: "#332811" } },
          cFg: { value: { base: "#7E5814", _dark: "#E0B45A" } },
          dBg: { value: { base: "#F6E0DC", _dark: "#3A1B18" } },
          dFg: { value: { base: "#9E3327", _dark: "#EF8A7E" } },
        },
        // Chart series (validated: CVD-safe as a set of three on both surfaces) and chrome.
        chart: {
          s1: { value: { base: "#2a78d6", _dark: "#3987e5" } },
          s2: { value: { base: "#eb6834", _dark: "#d95926" } },
          s3: { value: { base: "#1baf7a", _dark: "#199e70" } },
          grid: { value: { base: "#E6EAF0", _dark: "#222A35" } },
          axis: { value: { base: "#C3CAD4", _dark: "#39424F" } },
        },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
