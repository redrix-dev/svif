// The classic "…" menu. Every row is a browser action; destructive ones
// confirm in place instead of spawning dialogs.

import { createSignal } from "solid-js";
import * as ipc from "../ipc";
import { activeTab, canReopen, env, openFindSignal, setUi, showToast, tabs } from "../state";

function keys(mac: boolean, combo: string) {
  return mac ? combo : combo.replace("⌘", "Ctrl+").replace("⇧", "Shift+");
}

export function MenuPopover() {
  const mac = () => env().platform === "macos";
  const [confirmClear, setConfirmClear] = createSignal(false);

  const act = (action: string) => {
    void ipc.browserAction(action);
    setUi("none");
  };

  return (
    <div class="popover menu" role="menu">
      <button class="menu-item" onClick={() => act("new_tab")}>
        <span>New Tab</span>
        <kbd>{keys(mac(), "⌘T")}</kbd>
      </button>
      <button class="menu-item" disabled={!canReopen()} onClick={() => act("reopen_tab")}>
        <span>Reopen Closed Tab</span>
        <kbd>{keys(mac(), "⇧⌘T")}</kbd>
      </button>

      <div class="menu-sep" />

      <div class="menu-item static">
        <span>Zoom</span>
        <span class="zoom-controls">
          <button class="chip" onClick={() => void ipc.browserAction("zoom_out")}>−</button>
          <button class="chip pct" onClick={() => void ipc.browserAction("zoom_reset")}>
            {activeTab()?.zoom ?? 100}%
          </button>
          <button class="chip" onClick={() => void ipc.browserAction("zoom_in")}>+</button>
        </span>
      </div>

      <div class="menu-sep" />

      <button
        class="menu-item"
        onClick={() => {
          setUi("find");
          openFindSignal[1]((n) => n + 1);
        }}
      >
        <span>Find in Page…</span>
        <kbd>{keys(mac(), "⌘F")}</kbd>
      </button>
      <button class="menu-item" onClick={() => act("toggle_mute")}>
        <span>{activeTab()?.muted ? "Unmute Tab" : "Mute Tab"}</span>
        <kbd>{keys(mac(), "⇧⌘M")}</kbd>
      </button>
      <button class="menu-item" disabled={tabs().length < 2} onClick={() => act("sleep_now")}>
        <span>Sleep This Tab</span>
      </button>

      <div class="menu-sep" />

      <button
        class="menu-item"
        classList={{ danger: confirmClear() }}
        onClick={() => {
          if (!confirmClear()) {
            setConfirmClear(true);
            return;
          }
          ipc
            .clearBrowsingData()
            .then(() => showToast("Browsing data cleared"))
            .catch(() => showToast("Could not clear data on this platform"));
          setUi("none");
        }}
      >
        <span>{confirmClear() ? "Really clear all browsing data?" : "Clear Browsing Data"}</span>
      </button>
      <button
        class="menu-item"
        onClick={() => {
          void ipc.openDevtools();
          setUi("none");
        }}
      >
        <span>Page Inspector</span>
      </button>

      <div class="menu-sep" />

      <button class="menu-item" onClick={() => setUi("settings")}>
        <span>Settings…</span>
      </button>

      <div class="menu-footer">Svif {env().version} · Surf, swiftly.</div>
    </div>
  );
}
