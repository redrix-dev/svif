// Theming. A theme is eight colors — nothing else. Bundled themes live here;
// custom themes are the same JSON shape, validated on import and persisted in
// settings. The template below is what "Copy template" hands the user.

import type { Theme, ThemeColors } from "./types";

export const BUNDLED_THEMES: Theme[] = [
  {
    id: "glass-dark",
    name: "Glass Dark",
    dark: true,
    colors: {
      accent: "#6aa5ff",
      text: "rgba(255,255,255,0.92)",
      textDim: "rgba(255,255,255,0.55)",
      glass: "rgba(22,24,32,0.42)",
      surface: "rgba(30,32,42,0.88)",
      border: "rgba(255,255,255,0.10)",
      field: "rgba(255,255,255,0.08)",
      page: "linear-gradient(160deg,#1b1d27 0%,#12131b 100%)",
    },
  },
  {
    id: "glass-light",
    name: "Glass Light",
    dark: false,
    colors: {
      accent: "#2f6fed",
      text: "rgba(20,22,30,0.92)",
      textDim: "rgba(20,22,30,0.55)",
      glass: "rgba(255,255,255,0.45)",
      surface: "rgba(250,250,253,0.90)",
      border: "rgba(0,0,0,0.10)",
      field: "rgba(0,0,0,0.06)",
      page: "linear-gradient(160deg,#f2f3f7 0%,#e7e9f0 100%)",
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    dark: true,
    colors: {
      accent: "#7c8cff",
      text: "rgba(226,232,255,0.93)",
      textDim: "rgba(226,232,255,0.52)",
      glass: "rgba(9,12,28,0.55)",
      surface: "rgba(14,17,36,0.92)",
      border: "rgba(124,140,255,0.16)",
      field: "rgba(124,140,255,0.10)",
      page: "linear-gradient(160deg,#0c0f22 0%,#070912 100%)",
    },
  },
  {
    id: "aurora",
    name: "Aurora",
    dark: true,
    colors: {
      accent: "#4fd8b8",
      text: "rgba(230,255,248,0.92)",
      textDim: "rgba(230,255,248,0.52)",
      glass: "rgba(10,26,26,0.48)",
      surface: "rgba(13,32,32,0.90)",
      border: "rgba(79,216,184,0.18)",
      field: "rgba(79,216,184,0.10)",
      page: "linear-gradient(160deg,#0b1f1e 0%,#081312 100%)",
    },
  },
  {
    id: "rose",
    name: "Rosé",
    dark: false,
    colors: {
      accent: "#d5486f",
      text: "rgba(46,20,30,0.92)",
      textDim: "rgba(46,20,30,0.55)",
      glass: "rgba(255,241,245,0.50)",
      surface: "rgba(255,248,250,0.92)",
      border: "rgba(213,72,111,0.16)",
      field: "rgba(213,72,111,0.08)",
      page: "linear-gradient(160deg,#f9edf1 0%,#f2dfe6 100%)",
    },
  },
];

export const THEME_TEMPLATE = `{
  "id": "my-theme",
  "name": "My Theme",
  "dark": true,
  "colors": {
    "accent":  "#6aa5ff",
    "text":    "rgba(255,255,255,0.92)",
    "textDim": "rgba(255,255,255,0.55)",
    "glass":   "rgba(22,24,32,0.42)",
    "surface": "rgba(30,32,42,0.88)",
    "border":  "rgba(255,255,255,0.10)",
    "field":   "rgba(255,255,255,0.08)",
    "page":    "linear-gradient(160deg,#1b1d27 0%,#12131b 100%)"
  }
}`;

const COLOR_KEYS: (keyof ThemeColors)[] = [
  "accent", "text", "textDim", "glass", "surface", "border", "field", "page",
];

/** Parses and validates custom-theme JSON. Returns a Theme or a human error. */
export function parseTheme(json: string): Theme | string {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return "That isn't valid JSON.";
  }
  const t = raw as Partial<Theme>;
  if (typeof t.id !== "string" || !/^[a-z0-9-]{2,40}$/.test(t.id))
    return `"id" must be 2-40 chars of a-z, 0-9, dashes.`;
  if (typeof t.name !== "string" || !t.name.trim() || t.name.length > 40)
    return `"name" must be a short string.`;
  if (typeof t.dark !== "boolean") return `"dark" must be true or false.`;
  if (typeof t.colors !== "object" || t.colors === null) return `"colors" is missing.`;
  const colors = t.colors as unknown as Record<string, string>;
  for (const key of COLOR_KEYS) {
    const v = colors[key];
    if (typeof v !== "string" || v.length > 200 || /[;{}<>]/.test(v))
      return `colors.${key} must be a CSS color (or gradient for "page").`;
  }
  return {
    id: t.id,
    name: t.name.trim(),
    dark: t.dark,
    colors: Object.fromEntries(
      COLOR_KEYS.map((k) => [k, colors[k]])
    ) as unknown as ThemeColors,
  };
}

export function resolveTheme(id: string, custom: Theme[]): Theme {
  return (
    custom.find((t) => t.id === id) ??
    BUNDLED_THEMES.find((t) => t.id === id) ??
    BUNDLED_THEMES[0]
  );
}

export const FONT_STACKS: Record<string, string> = {
  system:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable', 'Segoe UI', system-ui, 'Ubuntu', 'Cantarell', sans-serif",
  rounded:
    "ui-rounded, 'SF Pro Rounded', 'Hiragino Maru Gothic ProN', 'Quicksand', 'Comfortaa', sans-serif",
  serif: "'New York', ui-serif, 'Georgia', 'Times New Roman', serif",
  mono: "ui-monospace, 'SF Mono', 'Menlo', 'Consolas', 'Liberation Mono', monospace",
};

export function applyTheme(theme: Theme, uiFont: string) {
  const root = document.documentElement;
  const c = theme.colors;
  root.style.setProperty("--accent", c.accent);
  root.style.setProperty("--text", c.text);
  root.style.setProperty("--text-dim", c.textDim);
  root.style.setProperty("--glass", c.glass);
  root.style.setProperty("--surface", c.surface);
  root.style.setProperty("--border", c.border);
  root.style.setProperty("--field", c.field);
  root.style.setProperty("--page", c.page);
  root.style.setProperty("--ui-font", FONT_STACKS[uiFont] ?? FONT_STACKS.system);
  root.dataset.dark = String(theme.dark);
}
