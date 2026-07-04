// Navigation row (top, Safari-style): room for the traffic lights, back /
// forward, a window-centered compact address field with reload tucked into the
// pill, then the … menu. The field shows the page URL until you focus it;
// Escape restores, Enter resolves (URL vs. search) and navigates the active tab.
//
// Layout is a 3-column grid (1fr | address | 1fr) so the pill stays centered on
// the window no matter how wide the button groups get.

import { Show, createEffect, createSignal } from "solid-js";
import * as ipc from "../ipc";
import {
  activeTab,
  displayUrl,
  env,
  focusAddressSignal,
  resolveInput,
  settings,
  setUi,
  toast,
  ui,
} from "../state";
import {
  IconBack,
  IconEllipsis,
  IconForward,
  IconLock,
  IconReload,
  IconSearch,
  IconStop,
} from "./icons";
import { WindowButtons } from "./WindowButtons";

export function Toolbar() {
  let input!: HTMLInputElement;
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const mac = () => env().platform === "macos";

  const value = () => (editing() ? draft() : displayUrl(activeTab()?.url ?? ""));
  const secure = () => (activeTab()?.url ?? "").startsWith("https://");

  // ⌘L (from anywhere) lands here.
  createEffect(() => {
    if (focusAddressSignal[0]() > 0) {
      input.focus();
      input.select();
    }
  });

  const navigate = () => {
    const tab = activeTab();
    const url = resolveInput(draft(), settings()?.searchEngine ?? "duckduckgo");
    if (tab && url) {
      void ipc.tabNavigate(tab.id, url);
      input.blur();
    }
  };

  return (
    <div class="toolbar" data-tauri-drag-region>
      <div class="toolbar-side left" data-tauri-drag-region>
        <Show when={mac()}>
          <div class="traffic-spacer" data-tauri-drag-region />
        </Show>
        <button class="icon-btn" title="Back (⌘[)" onClick={() => void ipc.browserAction("back")}>
          <IconBack />
        </button>
        <button class="icon-btn" title="Forward (⌘])" onClick={() => void ipc.browserAction("forward")}>
          <IconForward />
        </button>
      </div>

      <div class="address" classList={{ editing: editing() }}>
        <span class="address-icon" classList={{ secure: secure() }}>
          {secure() && !editing() ? <IconLock /> : <IconSearch />}
        </span>
        <input
          ref={input}
          type="text"
          spellcheck={false}
          placeholder="Search or enter address"
          value={value()}
          onFocus={(e) => {
            setDraft(displayUrl(activeTab()?.url ?? ""));
            setEditing(true);
            e.currentTarget.select();
          }}
          onBlur={() => setEditing(false)}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") navigate();
            else if (e.key === "Escape") input.blur();
          }}
        />
        {/* Live zoom stepper — appears in the toolbar (over the visible page,
            Chrome-style) when zoom ≠ 100%, so adjustments preview in real time
            without opening the menu. −  125%  + , where the % resets to 100%. */}
        <Show when={(activeTab()?.zoom ?? 100) !== 100}>
          <div class="zoom-stepper">
            <button title="Zoom out (⌘−)" onClick={() => void ipc.browserAction("zoom_out")}>
              −
            </button>
            <button
              class="zoom-level"
              title="Reset zoom (⌘0)"
              onClick={() => void ipc.browserAction("zoom_reset")}
            >
              {activeTab()!.zoom}%
            </button>
            <button title="Zoom in (⌘+)" onClick={() => void ipc.browserAction("zoom_in")}>
              +
            </button>
          </div>
        </Show>
        <button
          class="icon-btn reload-btn"
          title={activeTab()?.loading ? "Stop loading" : "Reload (⌘R)"}
          onClick={() => void ipc.browserAction(activeTab()?.loading ? "stop" : "reload")}
        >
          {activeTab()?.loading ? <IconStop /> : <IconReload />}
        </button>
      </div>

      <div class="toolbar-side right" data-tauri-drag-region>
        <button
          class="icon-btn"
          title="Menu"
          onClick={() => setUi(ui() === "menu" ? "none" : "menu")}
        >
          <IconEllipsis />
        </button>
        <Show when={!mac()}>
          <WindowButtons />
        </Show>
      </div>

      <Show when={activeTab()?.loading}>
        <div class="progress" />
      </Show>
      <Show when={toast()}>
        <div class="toast">{toast()}</div>
      </Show>
    </div>
  );
}
