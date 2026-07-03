// Settings. One glass sheet, five sections, zero accounts. Every control
// writes straight through to the Rust settings store; the store broadcasts
// back and the UI re-renders from that echo.

import { For, Show, createSignal } from "solid-js";
import * as ipc from "../ipc";
import { env, settings, showToast } from "../state";
import { BUNDLED_THEMES, THEME_TEMPLATE, parseTheme, resolveTheme } from "../themes";
import type { Settings, Theme } from "../types";
import { IconClose } from "./icons";
import { setUi } from "../state";

function Section(props: { title: string; children: any }) {
  return (
    <section class="settings-section">
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}

function Row(props: { label: string; hint?: string; children: any }) {
  return (
    <div class="settings-row">
      <div class="settings-label">
        <span>{props.label}</span>
        <Show when={props.hint}>
          <small>{props.hint}</small>
        </Show>
      </div>
      <div class="settings-control">{props.children}</div>
    </div>
  );
}

function ThemeCard(props: { theme: Theme; custom?: boolean }) {
  const active = () => settings()?.theme === props.theme.id;
  const pick = () =>
    void ipc.settingsSet({ theme: props.theme.id, themeColors: props.theme.colors });
  return (
    <button class="theme-card" classList={{ active: active() }} onClick={pick}>
      <span class="theme-dots" style={{ background: props.theme.colors.page }}>
        <i style={{ background: props.theme.colors.accent }} />
        <i style={{ background: props.theme.colors.surface }} />
        <i style={{ background: props.theme.colors.field }} />
      </span>
      <span class="theme-name">{props.theme.name}</span>
      <Show when={props.custom}>
        <span
          class="theme-delete"
          title="Delete theme"
          onClick={(e) => {
            e.stopPropagation();
            const s = settings();
            if (!s) return;
            const rest = s.customThemes.filter((t) => t.id !== props.theme.id);
            const patch: Partial<Settings> = { customThemes: rest };
            if (s.theme === props.theme.id) {
              patch.theme = "glass-dark";
              patch.themeColors = resolveTheme("glass-dark", []).colors;
            }
            void ipc.settingsSet(patch);
          }}
        >
          <IconClose />
        </span>
      </Show>
    </button>
  );
}

export function SettingsPanel() {
  const s = () => settings();
  const [importText, setImportText] = createSignal("");
  const [importError, setImportError] = createSignal<string | null>(null);

  const set = (patch: Partial<Settings>) => void ipc.settingsSet(patch);

  const importTheme = () => {
    const parsed = parseTheme(importText());
    if (typeof parsed === "string") {
      setImportError(parsed);
      return;
    }
    if (BUNDLED_THEMES.some((t) => t.id === parsed.id)) {
      setImportError(`"${parsed.id}" is a built-in theme id — pick another.`);
      return;
    }
    const cur = s()?.customThemes ?? [];
    set({
      customThemes: [...cur.filter((t) => t.id !== parsed.id), parsed],
      theme: parsed.id,
      themeColors: parsed.colors,
    });
    setImportText("");
    setImportError(null);
    showToast(`Theme "${parsed.name}" imported`);
  };

  return (
    <div class="popover settings-panel">
      <header class="settings-header">
        <h1>Settings</h1>
        <button class="icon-btn" title="Close (Esc)" onClick={() => setUi("none")}>
          <IconClose />
        </button>
      </header>

      <div class="settings-body">
        <Show when={s()} keyed>
          {(cfg) => (
            <>
              <Section title="Appearance">
                <div class="theme-grid">
                  <For each={BUNDLED_THEMES}>{(t) => <ThemeCard theme={t} />}</For>
                  <For each={cfg.customThemes}>{(t) => <ThemeCard theme={t} custom />}</For>
                </div>
                <details class="theme-import">
                  <summary>Import a custom theme</summary>
                  <p class="settings-hint">
                    A theme is a small JSON file: eight CSS colors and a name.
                    Paste one below, or start from the template.
                  </p>
                  <textarea
                    rows={6}
                    spellcheck={false}
                    placeholder={'{ "id": "my-theme", ... }'}
                    value={importText()}
                    onInput={(e) => {
                      setImportText(e.currentTarget.value);
                      setImportError(null);
                    }}
                  />
                  <Show when={importError()}>
                    <p class="settings-error">{importError()}</p>
                  </Show>
                  <div class="settings-actions">
                    <button class="btn" onClick={importTheme} disabled={!importText().trim()}>
                      Import
                    </button>
                    <button
                      class="btn ghost"
                      onClick={() => {
                        setImportText(THEME_TEMPLATE);
                        setImportError(null);
                      }}
                    >
                      Paste template
                    </button>
                    <button
                      class="btn ghost"
                      onClick={() => {
                        void navigator.clipboard.writeText(THEME_TEMPLATE);
                        showToast("Template copied to clipboard");
                      }}
                    >
                      Copy template
                    </button>
                  </div>
                </details>
                <Row label="Interface font">
                  <select
                    value={cfg.uiFont}
                    onChange={(e) => set({ uiFont: e.currentTarget.value })}
                  >
                    <option value="system">System</option>
                    <option value="rounded">Rounded</option>
                    <option value="serif">Serif</option>
                    <option value="mono">Mono</option>
                  </select>
                </Row>
              </Section>

              <Section title="Browsing">
                <Row label="Search engine">
                  <select
                    value={cfg.searchEngine}
                    onChange={(e) => set({ searchEngine: e.currentTarget.value })}
                  >
                    <option value="duckduckgo">DuckDuckGo</option>
                    <option value="google">Google</option>
                    <option value="bing">Bing</option>
                    <option value="brave">Brave Search</option>
                    <option value="startpage">Startpage</option>
                  </select>
                </Row>
                <Row label="New tabs open" hint="A URL, or the built-in start page.">
                  <input
                    type="text"
                    class="text-input"
                    value={cfg.homepage === "about:newtab" ? "" : cfg.homepage}
                    placeholder="Start page"
                    onChange={(e) => {
                      const v = e.currentTarget.value.trim();
                      set({
                        homepage:
                          v && /^https?:\/\//.test(v)
                            ? v
                            : v && !v.includes(" ")
                              ? "https://" + v
                              : "about:newtab",
                      });
                    }}
                  />
                </Row>
                <Row label="Default zoom">
                  <select
                    value={String(cfg.defaultZoom)}
                    onChange={(e) => set({ defaultZoom: Number(e.currentTarget.value) })}
                  >
                    <For each={[75, 90, 100, 110, 125, 150]}>
                      {(z) => <option value={String(z)}>{z}%</option>}
                    </For>
                  </select>
                </Row>
              </Section>

              <Section title="Tab Sleep">
                <Row
                  label="Sleep inactive tabs"
                  hint="Sleeping tabs free their memory and restore on click."
                >
                  <input
                    type="checkbox"
                    class="switch"
                    checked={cfg.sleepEnabled}
                    onChange={(e) => set({ sleepEnabled: e.currentTarget.checked })}
                  />
                </Row>
                <Row label={`Sleep after ${cfg.sleepAfterMins} min`}>
                  <input
                    type="range"
                    min={1}
                    max={120}
                    value={cfg.sleepAfterMins}
                    disabled={!cfg.sleepEnabled}
                    onChange={(e) => set({ sleepAfterMins: Number(e.currentTarget.value) })}
                  />
                </Row>
                <Row
                  label="Keep media tabs awake"
                  hint="Tabs playing audio or video are never put to sleep."
                >
                  <input
                    type="checkbox"
                    class="switch"
                    checked={cfg.sleepKeepMedia}
                    disabled={!cfg.sleepEnabled}
                    onChange={(e) => set({ sleepKeepMedia: e.currentTarget.checked })}
                  />
                </Row>
              </Section>

              <Section title="Session">
                <Row
                  label="Restore tabs on launch"
                  hint="Background tabs come back asleep — startup stays instant."
                >
                  <input
                    type="checkbox"
                    class="switch"
                    checked={cfg.restoreSession}
                    onChange={(e) => set({ restoreSession: e.currentTarget.checked })}
                  />
                </Row>
              </Section>

              <Section title="Data">
                <Row
                  label="Clear browsing data"
                  hint="Cookies, cache and storage for all open tabs."
                >
                  <button
                    class="btn"
                    onClick={() =>
                      ipc
                        .clearBrowsingData()
                        .then(() => showToast("Browsing data cleared"))
                        .catch(() => showToast("Could not clear data on this platform"))
                    }
                  >
                    Clear…
                  </button>
                </Row>
              </Section>

              <footer class="settings-footer">
                Svif {env().version} · Tauri + Solid · glide, simply.
              </footer>
            </>
          )}
        </Show>
      </div>
    </div>
  );
}
