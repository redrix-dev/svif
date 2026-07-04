import { Show, createEffect, onMount } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles.css";
import * as ipc from "./ipc";
import {
  env,
  initState,
  openFindSignal,
  setUi,
  settings,
  ui,
} from "./state";
import { applyTheme, resolveTheme } from "./themes";
import { FindBar } from "./components/FindBar";
import { MenuPopover } from "./components/MenuPopover";
import { SettingsPanel } from "./components/SettingsPanel";
import { TabStrip } from "./components/TabStrip";
import { Toolbar } from "./components/Toolbar";

export default function App() {
  onMount(() => void initState());

  createEffect(() => {
    const s = settings();
    if (!s) return;
    const theme = resolveTheme(s.theme, s.customThemes);
    applyTheme(theme, s.uiFont);
    // Match the native window appearance (and thus the macOS vibrancy / Windows
    // acrylic material) to the theme, so a light theme doesn't show dark system
    // vibrancy through the translucent chrome — the "dark topper".
    void getCurrentWindow().setTheme(theme.dark ? "dark" : "light");
  });

  // Linux gets an opaque painted backdrop; macOS/Windows show native blur
  // through the transparent chrome.
  createEffect(() => {
    document.documentElement.dataset.material =
      env().platform === "linux" ? "painted" : "native";
  });

  // Shortcuts while focus is in the chrome itself (address bar etc.).
  // The same map lives in the reporter for when focus is in a page.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && ui() !== "none") {
      setUi("none");
      return;
    }
    const mac = env().platform === "macos";
    let action: string | null = null;
    if (e.ctrlKey && !e.metaKey && e.key === "Tab") {
      action = e.shiftKey ? "prev_tab" : "next_tab";
    } else {
      const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey;
      if (!mod || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "t") action = e.shiftKey ? "reopen_tab" : "new_tab";
      else if (k === "w" && !e.shiftKey) action = "close_tab";
      else if (k === "r" && !e.shiftKey) action = "reload";
      else if (k === "l" && !e.shiftKey) action = "focus_address";
      else if (k === "[") action = "back";
      else if (k === "]") action = "forward";
      else if (k === "m" && e.shiftKey) action = "toggle_mute";
      else if (k === "f" && !e.shiftKey) {
        e.preventDefault();
        setUi("find");
        openFindSignal[1]((n) => n + 1);
        return;
      } else if (k === "=" || k === "+") action = "zoom_in";
      else if (k === "-") action = "zoom_out";
      else if (k === "0") action = "zoom_reset";
      else if (/^[1-9]$/.test(k) && !e.shiftKey) action = "tab_" + k;
    }
    if (action) {
      e.preventDefault();
      void ipc.browserAction(action);
    }
  };

  return (
    <div class="chrome" onKeyDown={onKeyDown} tabIndex={-1}>
      <Toolbar />
      <TabStrip />
      <Show when={ui() === "find"}>
        <FindBar />
      </Show>
      <Show when={ui() === "menu" || ui() === "settings"}>
        <div class="backdrop" onMouseDown={() => setUi("none")} />
      </Show>
      <Show when={ui() === "menu"}>
        <MenuPopover />
      </Show>
      <Show when={ui() === "settings"}>
        <SettingsPanel />
      </Show>
    </div>
  );
}
