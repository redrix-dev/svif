// Shared shapes of the Rust <-> chrome contract. The Rust side serializes
// with camelCase to match these exactly.

export interface TabInfo {
  id: number;
  url: string;
  title: string;
  favicon: string | null;
  loading: boolean;
  playing: boolean;
  audible: boolean;
  muted: boolean;
  asleep: boolean;
  zoom: number;
  active: boolean;
}

export interface TabsState {
  tabs: TabInfo[];
  activeId: number | null;
  canReopen: boolean;
}

export interface Env {
  platform: string; // "macos" | "windows" | "linux"
  version: string;
  chromeHeight: number;
}

export interface ThemeColors {
  accent: string;
  text: string;
  textDim: string;
  /** translucent tint layered over the native window blur (chrome strip) */
  glass: string;
  /** near-opaque glass for popovers and modals */
  surface: string;
  border: string;
  /** address field / input backgrounds */
  field: string;
  /** opaque fallback backdrop where no native blur exists (Linux) */
  page: string;
}

export interface Theme {
  id: string;
  name: string;
  dark: boolean;
  colors: ThemeColors;
}

export interface Settings {
  theme: string;
  uiFont: string;
  searchEngine: string;
  homepage: string;
  sleepEnabled: boolean;
  sleepAfterMins: number;
  sleepKeepMedia: boolean;
  restoreSession: boolean;
  defaultZoom: number;
  themeColors: ThemeColors | null;
  customThemes: Theme[];
}

export type UiLayer = "none" | "menu" | "settings" | "find";

export interface DownloadEvent {
  state: "started" | "done" | "failed";
  name?: string;
  path?: string;
}
