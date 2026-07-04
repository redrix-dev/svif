// The tab strip (bottom row, Safari-style). Tabs shrink to fit (10+
// comfortably), the empty area drags the window, and per-tab audio/sleep
// state renders inline. Middle-click closes, like every browser since 2001.

import { For, Show } from "solid-js";
import * as ipc from "../ipc";
import { tabs } from "../state";
import type { TabInfo } from "../types";
import {
  IconClose,
  IconGlobe,
  IconMoon,
  IconPlus,
  IconSpeaker,
  IconSpeakerMuted,
} from "./icons";

function Tab(props: { tab: TabInfo }) {
  const t = () => props.tab;
  return (
    <div
      class="tab"
      classList={{ active: t().active, asleep: t().asleep, loading: t().loading }}
      title={t().title}
      onMouseDown={(e) => {
        if (e.button === 0) void ipc.tabSelect(t().id);
      }}
      onAuxClick={(e) => {
        if (e.button === 1) void ipc.tabClose(t().id);
      }}
    >
      <span class="tab-icon">
        <Show
          when={!t().asleep && t().favicon}
          fallback={t().asleep ? <IconMoon /> : <IconGlobe />}
        >
          <img src={t().favicon!} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
        </Show>
      </span>
      <span class="tab-title">{t().title}</span>
      <Show when={t().audible || t().muted}>
        <button
          class="tab-audio"
          classList={{ muted: t().muted }}
          title={t().muted ? "Unmute tab" : "Mute tab"}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            void ipc.tabMute(t().id, !t().muted);
          }}
        >
          {t().muted ? <IconSpeakerMuted /> : <IconSpeaker />}
        </button>
      </Show>
      <button
        class="tab-close"
        title="Close tab"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          void ipc.tabClose(t().id);
        }}
      >
        <IconClose />
      </button>
    </div>
  );
}

export function TabStrip() {
  return (
    <div class="tabstrip" data-tauri-drag-region>
      <div class="tabs">
        <For each={tabs()}>{(tab) => <Tab tab={tab} />}</For>
      </div>
      <button class="icon-btn new-tab" title="New tab (⌘T)" onClick={() => void ipc.tabNew()}>
        <IconPlus />
      </button>
      <div class="drag-fill" data-tauri-drag-region />
    </div>
  );
}
