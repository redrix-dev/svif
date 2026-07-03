// Thin, typed wrappers over Tauri IPC. Every mutation goes through Rust;
// the chrome never keeps authoritative state of its own.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { DownloadEvent, Settings, TabsState } from "./types";

export const tabsSnapshot = () => invoke<TabsState & { env: import("./types").Env }>("tabs_snapshot");
export const tabNew = (url?: string, background = false) => invoke("tab_new", { url, background });
export const tabClose = (id: number) => invoke("tab_close", { id });
export const tabSelect = (id: number) => invoke("tab_select", { id });
export const tabNavigate = (id: number, url: string) => invoke("tab_navigate", { id, url });
export const tabMute = (id: number, muted: boolean) => invoke("tab_mute", { id, muted });
export const tabZoom = (id: number, pct: number) => invoke("tab_zoom", { id, pct });
export const tabSleep = (id: number) => invoke("tab_sleep", { id });
export const browserAction = (action: string) => invoke("browser_action", { action });
export const setOverlay = (mode: "none" | "find" | "full") => invoke("set_overlay", { mode });
export const findInPage = (text: string, backwards = false) =>
  invoke("find_in_page", { text, backwards });
export const findClear = () => invoke("find_in_page", { text: "", clear: true });
export const clearBrowsingData = () => invoke<void>("clear_browsing_data");
export const openDevtools = () => invoke("open_devtools");
export const settingsGet = () => invoke<Settings>("settings_get");
export const settingsSet = (patch: Partial<Settings>) =>
  invoke<Settings>("settings_set", { patch });

export const onTabsState = (cb: (s: TabsState) => void): Promise<UnlistenFn> =>
  listen<TabsState>("tabs-state", (e) => cb(e.payload));
export const onSettingsChanged = (cb: (s: Settings) => void): Promise<UnlistenFn> =>
  listen<Settings>("settings-changed", (e) => cb(e.payload));
export const onChromeCommand = (cb: (action: string) => void): Promise<UnlistenFn> =>
  listen<{ action: string }>("chrome-command", (e) => cb(e.payload.action));
export const onDownload = (cb: (d: DownloadEvent) => void): Promise<UnlistenFn> =>
  listen<DownloadEvent>("download", (e) => cb(e.payload));
