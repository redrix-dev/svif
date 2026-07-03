// Simple Browse — tab reporter.
// Injected into every tab webview at document start. wry gives us no native
// APIs for page title, favicon, SPA URL changes, audio state, mute, zoom or
// find-in-page — this script implements all of them in-page and reports back
// over Tauri IPC. The Rust side only trusts these calls from `tab-*` labels.
(() => {
  "use strict";
  if (window.__SB_REPORTER__) return;
  window.__SB_REPORTER__ = true;

  const CFG = __SB_CONFIG__; // injected by Rust: { mac, muted, zoom, theme }
  window.__SB_CFG = CFG;

  function invoke(cmd, args) {
    try {
      const internals = window.__TAURI_INTERNALS__;
      if (internals && internals.invoke) return internals.invoke(cmd, args);
    } catch (_) {}
    return Promise.resolve();
  }

  // ---- page state reporting (title / url / favicon / audio) ----
  const last = {};
  function report(patch) {
    const out = {};
    for (const k in patch) {
      if (last[k] !== patch[k]) {
        last[k] = patch[k];
        out[k] = patch[k];
      }
    }
    if (Object.keys(out).length) invoke("report_page_state", { patch: out });
  }

  function faviconUrl() {
    const links = document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]');
    const href = links.length ? links[links.length - 1].getAttribute("href") : "/favicon.ico";
    try {
      return new URL(href, location.href).href;
    } catch (_) {
      return null;
    }
  }

  function snapshot() {
    report({
      url: location.href,
      title: document.title || location.hostname || location.href,
      favicon: faviconUrl(),
    });
  }

  // SPA navigations don't hit the native navigation hooks; patch history.
  for (const fn of ["pushState", "replaceState"]) {
    const orig = history[fn].bind(history);
    history[fn] = (...args) => {
      const r = orig(...args);
      queueMicrotask(snapshot);
      return r;
    };
  }
  addEventListener("popstate", snapshot);
  addEventListener("hashchange", snapshot);
  addEventListener("DOMContentLoaded", snapshot);
  addEventListener("load", snapshot);
  setInterval(snapshot, 1500); // safety net for anything the events miss

  // ---- audio: detection + mute enforcement ----
  const media = new Set();

  function updateAudio() {
    let playing = false;
    let audible = false;
    for (const el of media) {
      if (!el.paused && !el.ended && el.readyState > 0) {
        playing = true;
        if (!el.muted && el.volume > 0) audible = true;
      }
    }
    report({ playing, audible });
  }

  function track(el) {
    if (media.has(el)) return;
    media.add(el);
    if (CFG.muted) el.muted = true;
  }

  for (const ev of ["play", "playing", "pause", "ended", "emptied", "volumechange"]) {
    document.addEventListener(
      ev,
      (e) => {
        const el = e.target;
        if (!(el instanceof HTMLMediaElement)) return;
        track(el);
        if (CFG.muted && !el.muted) el.muted = true; // re-assert against site JS
        updateAudio();
      },
      true
    );
  }
  setInterval(() => {
    document.querySelectorAll("video, audio").forEach(track);
    updateAudio();
  }, 3000);

  window.__SB_SET_MUTED = (muted) => {
    CFG.muted = muted;
    document.querySelectorAll("video, audio").forEach(track);
    for (const el of media) el.muted = muted;
    updateAudio();
  };

  // ---- zoom (CSS zoom keeps behavior identical on all three platforms) ----
  window.__SB_SET_ZOOM = (pct) => {
    CFG.zoom = pct;
    document.documentElement.style.zoom = pct === 100 ? "" : pct + "%";
  };
  addEventListener("DOMContentLoaded", () => {
    if (CFG.zoom && CFG.zoom !== 100) window.__SB_SET_ZOOM(CFG.zoom);
  });

  // ---- find in page ----
  window.__SB_FIND = (text, backwards) => {
    if (!text) return;
    try {
      window.find(text, false, !!backwards, true, false, true, false);
    } catch (_) {}
  };
  window.__SB_FIND_CLEAR = () => {
    try {
      getSelection().removeAllRanges();
    } catch (_) {}
  };

  // ---- popups become tabs ----
  const openTab = (url) => {
    try {
      invoke("open_tab_from_page", { url: new URL(url, location.href).href });
    } catch (_) {}
  };
  const origOpen = window.open ? window.open.bind(window) : null;
  window.open = (url) => {
    if (url) openTab(String(url));
    return null;
  };
  document.addEventListener(
    "click",
    (e) => {
      const a = e.target && e.target.closest ? e.target.closest("a[target=_blank]") : null;
      if (a && a.href) {
        e.preventDefault();
        openTab(a.href);
      }
    },
    true
  );

  // ---- browser keyboard shortcuts while a page has focus ----
  addEventListener(
    "keydown",
    (e) => {
      let action = null;
      if (e.ctrlKey && !e.metaKey && e.key === "Tab") {
        action = e.shiftKey ? "prev_tab" : "next_tab";
      } else {
        const mod = CFG.mac ? e.metaKey && !e.ctrlKey : e.ctrlKey;
        if (!mod || e.altKey) return;
        const k = e.key.toLowerCase();
        if (k === "t") action = e.shiftKey ? "reopen_tab" : "new_tab";
        else if (k === "w" && !e.shiftKey) action = "close_tab";
        else if (k === "l" && !e.shiftKey) action = "focus_address";
        else if (k === "r" && !e.shiftKey) action = "reload";
        else if (k === "f" && !e.shiftKey) action = "find";
        else if (k === "[") action = "back";
        else if (k === "]") action = "forward";
        else if (k === "=" || k === "+") action = "zoom_in";
        else if (k === "-") action = "zoom_out";
        else if (k === "0") action = "zoom_reset";
        else if (k === "m" && e.shiftKey) action = "toggle_mute";
        else if (/^[1-9]$/.test(k) && !e.shiftKey) action = "tab_" + k;
      }
      if (action) {
        e.preventDefault();
        e.stopPropagation();
        invoke("page_shortcut", { action });
      }
    },
    true
  );
})();
