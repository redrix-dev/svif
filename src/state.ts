// Chrome-side state. Rust is the source of truth; these signals mirror its
// broadcasts. The only chrome-owned state is which UI layer (menu, settings,
// find bar) is open, because that also drives the native overlay bounds.

import { createSignal } from "solid-js";
import * as ipc from "./ipc";
import type { DownloadEvent, Env, Settings, TabInfo, TabsState, UiLayer } from "./types";

export const [tabs, setTabs] = createSignal<TabInfo[]>([]);
export const [activeId, setActiveId] = createSignal<number | null>(null);
export const [canReopen, setCanReopen] = createSignal(false);
export const [settings, setSettings] = createSignal<Settings | null>(null);
export const [env, setEnv] = createSignal<Env>({
  platform: "macos",
  version: "0.1.0",
  chromeHeight: 86,
});
export const [ui, setUiRaw] = createSignal<UiLayer>("none");
export const [toast, setToast] = createSignal<string | null>(null);

export const activeTab = (): TabInfo | undefined =>
  tabs().find((t) => t.id === activeId());

/** Opens/closes a chrome layer and keeps the native overlay bounds in sync
 *  (menus and settings need the whole window; the find bar only a strip). */
export function setUi(layer: UiLayer) {
  setUiRaw(layer);
  void ipc.setOverlay(layer === "menu" || layer === "settings" ? "full" : layer === "find" ? "find" : "none");
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(text: string) {
  setToast(text);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setToast(null), 4000);
}

function applyTabsState(s: TabsState) {
  setTabs(s.tabs);
  setActiveId(s.activeId);
  setCanReopen(s.canReopen);
}

export const focusAddressSignal = createSignal(0);
export const openFindSignal = createSignal(0);

export async function initState() {
  const snap = await ipc.tabsSnapshot();
  setEnv(snap.env);
  applyTabsState(snap);
  setSettings(await ipc.settingsGet());

  void ipc.onTabsState(applyTabsState);
  void ipc.onSettingsChanged(setSettings);
  void ipc.onChromeCommand((action) => {
    if (action === "find") {
      setUi("find");
      openFindSignal[1]((n) => n + 1);
    } else if (action === "focus_address") {
      focusAddressSignal[1]((n) => n + 1);
    }
  });
  void ipc.onDownload((d: DownloadEvent) => {
    if (d.state === "started") showToast(`Downloading ${d.name ?? "file"}…`);
    else if (d.state === "done") showToast(`Saved to ${shortPath(d.path)}`);
    else showToast("Download failed");
  });
}

function shortPath(p?: string) {
  if (!p) return "Downloads";
  const parts = p.split(/[\\/]/);
  return parts.slice(-2).join("/");
}

// ---- address input -> URL or search ----

const ENGINES: Record<string, string> = {
  duckduckgo: "https://duckduckgo.com/?q=%s",
  google: "https://www.google.com/search?q=%s",
  bing: "https://www.bing.com/search?q=%s",
  brave: "https://search.brave.com/search?q=%s",
  startpage: "https://www.startpage.com/sp/search?query=%s",
};

export function resolveInput(raw: string, engine: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (text === "about:newtab") return text;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return null; // no exotic schemes
  const wordLike = !/\s/.test(text);
  if (wordLike && (text.includes(".") || text.startsWith("localhost"))) {
    return "https://" + text;
  }
  const template = ENGINES[engine] ?? ENGINES.duckduckgo;
  return template.replace("%s", encodeURIComponent(text));
}

/** What the address bar should display for a tab. Internal pages show empty. */
export function displayUrl(url: string): string {
  if (url === "about:newtab" || url.includes("newtab.html") || !/^https?:/.test(url)) return "";
  return url;
}
