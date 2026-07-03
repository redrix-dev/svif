// Navigation row: back / forward / reload-or-stop, the address field, and
// the … menu. The address field shows the page URL until you focus it, then
// becomes a draft; Escape restores, Enter resolves (URL vs. search) and
// navigates the active tab.

import { Show, createEffect, createSignal } from "solid-js";
import * as ipc from "../ipc";
import {
  activeTab,
  displayUrl,
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

export function Toolbar() {
  let input!: HTMLInputElement;
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");

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
    <div class="toolbar">
      <button class="icon-btn" title="Back (⌘[)" onClick={() => void ipc.browserAction("back")}>
        <IconBack />
      </button>
      <button class="icon-btn" title="Forward (⌘])" onClick={() => void ipc.browserAction("forward")}>
        <IconForward />
      </button>
      <button
        class="icon-btn"
        title={activeTab()?.loading ? "Stop loading" : "Reload (⌘R)"}
        onClick={() => void ipc.browserAction(activeTab()?.loading ? "stop" : "reload")}
      >
        {activeTab()?.loading ? <IconStop /> : <IconReload />}
      </button>

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
        <Show when={(activeTab()?.zoom ?? 100) !== 100}>
          <button
            class="zoom-chip"
            title="Reset zoom (⌘0)"
            onClick={() => void ipc.browserAction("zoom_reset")}
          >
            {activeTab()!.zoom}%
          </button>
        </Show>
      </div>

      <button
        class="icon-btn"
        title="Menu"
        onClick={() => setUi(ui() === "menu" ? "none" : "menu")}
      >
        <IconEllipsis />
      </button>

      <Show when={activeTab()?.loading}>
        <div class="progress" />
      </Show>
      <Show when={toast()}>
        <div class="toast">{toast()}</div>
      </Show>
    </div>
  );
}
