// Start page logic. This runs inside a tab webview, so the reporter script is
// present and window.__SB_CFG carries the active theme + search engine from
// Rust. No IPC needed: submitting just navigates this tab.

interface SbCfg {
  engine?: string;
  theme?: Record<string, string> | null;
}

const CFG: SbCfg = (window as unknown as { __SB_CFG?: SbCfg }).__SB_CFG ?? {};

const ENGINES: Record<string, string> = {
  duckduckgo: "https://duckduckgo.com/?q=%s",
  google: "https://www.google.com/search?q=%s",
  bing: "https://www.bing.com/search?q=%s",
  brave: "https://search.brave.com/search?q=%s",
  startpage: "https://www.startpage.com/sp/search?query=%s",
};

// Match the chrome's theme.
const t = CFG.theme;
if (t && typeof t === "object") {
  const root = document.documentElement.style;
  if (t.accent) root.setProperty("--accent", t.accent);
  if (t.text) root.setProperty("--text", t.text);
  if (t.textDim) root.setProperty("--text-dim", t.textDim);
  if (t.field) root.setProperty("--field", t.field);
  if (t.border) root.setProperty("--border", t.border);
  if (t.page) root.setProperty("--page", t.page);
}

const clock = document.getElementById("clock")!;
function tick() {
  clock.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
tick();
setInterval(tick, 10_000);

const form = document.getElementById("search") as HTMLFormElement;
const q = document.getElementById("q") as HTMLInputElement;
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = q.value.trim();
  if (!text) return;
  if (/^https?:\/\//i.test(text)) {
    location.href = text;
  } else if (!/\s/.test(text) && (text.includes(".") || text.startsWith("localhost"))) {
    location.href = "https://" + text;
  } else {
    const tpl = ENGINES[CFG.engine ?? "duckduckgo"] ?? ENGINES.duckduckgo;
    location.href = tpl.replace("%s", encodeURIComponent(text));
  }
});
