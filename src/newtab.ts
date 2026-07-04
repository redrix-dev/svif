// Start page logic. This runs inside a tab webview, so the reporter script is
// present and window.__SB_CFG carries the active theme + search engine from
// Rust. No IPC needed: submitting just navigates this tab.

interface SbCfg {
  engine?: string;
  theme?: Record<string, string> | null;
  festive?: boolean;
}

const CFG: SbCfg = (window as unknown as { __SB_CFG?: SbCfg }).__SB_CFG ?? {};

const ENGINES: Record<string, string> = {
  duckduckgo: "https://duckduckgo.com/?q=%s",
  google: "https://www.google.com/search?q=%s",
  bing: "https://www.bing.com/search?q=%s",
  brave: "https://search.brave.com/search?q=%s",
  startpage: "https://www.startpage.com/sp/search?query=%s",
};

// Apply a theme palette to the page's CSS variables. Runs once at load, and
// again live via window.__SB_APPLY_THEME when the user switches themes.
function applyThemeVars(theme: Record<string, string> | null | undefined) {
  if (!theme || typeof theme !== "object") return;
  const root = document.documentElement.style;
  if (theme.accent) root.setProperty("--accent", theme.accent);
  if (theme.text) root.setProperty("--text", theme.text);
  if (theme.textDim) root.setProperty("--text-dim", theme.textDim);
  if (theme.field) root.setProperty("--field", theme.field);
  if (theme.border) root.setProperty("--border", theme.border);
  if (theme.page) root.setProperty("--page", theme.page);
}
applyThemeVars(CFG.theme);

const clock = document.getElementById("clock")!;
const dateEl = document.getElementById("date")!;
function tick() {
  const now = new Date();
  clock.textContent = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  dateEl.textContent = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
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

// ---- ambient background canvas ----
// Two modes, both cursor-reactive:
//   • constellation — a drifting field in the theme accent (default)
//   • fireworks     — festive red/white/blue bursts (July 4th toggle); a click
//                     launches one at the cursor.
// Toggled live by window.__SB_SET_FESTIVE (Rust evals it when the setting flips).
const canvas = document.getElementById("bg") as HTMLCanvasElement | null;
const ctx = canvas ? canvas.getContext("2d") : null;
if (canvas && ctx) {
  let W = 0;
  let H = 0;
  let DPR = 1;
  const mouse = { x: -9999, y: -9999, active: false };
  let festive = !!CFG.festive;
  (window as unknown as { __SB_SET_FESTIVE?: (on: boolean) => void }).__SB_SET_FESTIVE = (on) => {
    festive = on;
  };

  // Resolve the accent (hex or rgb) to raw channels for alpha compositing.
  const toRGB = (color: string): [number, number, number] => {
    const probe = document.createElement("div");
    probe.style.color = color;
    document.body.appendChild(probe);
    const parsed = getComputedStyle(probe).color.match(/\d+/g);
    probe.remove();
    return parsed
      ? [Number(parsed[0]), Number(parsed[1]), Number(parsed[2])]
      : [106, 165, 255];
  };
  const readAccent = (): [number, number, number] =>
    toRGB(
      getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() ||
        "#6aa5ff",
    );
  let accent = readAccent();
  const rgba = (a: number) => `rgba(${accent[0]},${accent[1]},${accent[2]},${a})`;
  (window as unknown as { __SB_REFRESH_ACCENT?: () => void }).__SB_REFRESH_ACCENT = () => {
    accent = readAccent();
  };

  // ---- constellation mode ----
  interface Dot {
    x: number;
    y: number;
    vx: number;
    vy: number;
    r: number;
  }
  const dots: Dot[] = [];
  let LINK = 0;
  let PULL = 0;

  const seedDots = () => {
    LINK = 130 * DPR;
    PULL = 170 * DPR;
    const count = Math.min(110, Math.floor((window.innerWidth * window.innerHeight) / 15000));
    dots.length = 0;
    for (let i = 0; i < count; i++) {
      dots.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.18 * DPR,
        vy: (Math.random() - 0.5) * 0.18 * DPR,
        r: (Math.random() * 1.5 + 0.6) * DPR,
      });
    }
  };

  const drawConstellation = () => {
    for (const d of dots) {
      d.x += d.vx;
      d.y += d.vy;
      if (d.x < 0) d.x += W;
      else if (d.x > W) d.x -= W;
      if (d.y < 0) d.y += H;
      else if (d.y > H) d.y -= H;

      if (mouse.active) {
        const dx = d.x - mouse.x;
        const dy = d.y - mouse.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < PULL * PULL && dist2 > 1) {
          const dist = Math.sqrt(dist2);
          const force = ((PULL - dist) / PULL) * 0.8 * DPR;
          d.x += (dx / dist) * force;
          d.y += (dy / dist) * force;
        }
      }

      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fillStyle = rgba(0.5);
      ctx.fill();
    }

    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const a = dots[i];
        const b = dots[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < LINK * LINK) {
          ctx.strokeStyle = rgba((1 - Math.sqrt(dist2) / LINK) * 0.2);
          ctx.lineWidth = DPR;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    if (mouse.active) {
      for (const d of dots) {
        const dx = d.x - mouse.x;
        const dy = d.y - mouse.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < PULL * PULL) {
          ctx.strokeStyle = rgba((1 - Math.sqrt(dist2) / PULL) * 0.32);
          ctx.lineWidth = DPR;
          ctx.beginPath();
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
        }
      }
    }
  };

  // ---- fireworks mode (festive) ----
  const FESTIVE = ["#e23b4e", "#ffffff", "#4d7fd6"]; // red · white · blue
  const hexA = (hex: string, a: number) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  interface Rocket {
    x: number;
    y: number;
    vy: number;
    burstY: number;
    color: string;
  }
  interface Spark {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    max: number;
    color: string;
  }
  const rockets: Rocket[] = [];
  const sparks: Spark[] = [];
  let cooldown = 0;
  const pick = () => FESTIVE[(Math.random() * FESTIVE.length) | 0];

  const burst = (x: number, y: number, color: string) => {
    const n = 48 + ((Math.random() * 28) | 0);
    for (let i = 0; i < n; i++) {
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.3;
      const spd = (1.5 + Math.random() * 4.5) * DPR;
      const max = 55 + ((Math.random() * 45) | 0);
      sparks.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: max,
        max,
        // mostly the shell colour, a scatter of white sparks
        color: Math.random() < 0.22 ? "#ffffff" : color,
      });
    }
  };

  const launch = (x?: number) => {
    const px = x ?? Math.random() * W;
    rockets.push({
      x: px,
      y: H,
      vy: -(7.5 + Math.random() * 3) * DPR,
      burstY: H * (0.14 + Math.random() * 0.32),
      color: pick(),
    });
  };

  const drawFireworks = () => {
    if (--cooldown <= 0 && rockets.length < 4) {
      launch();
      cooldown = 34 + ((Math.random() * 46) | 0);
    }

    ctx.save();
    ctx.globalCompositeOperation = "lighter"; // additive glow
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.y += r.vy;
      r.vy += 0.09 * DPR; // gravity slows the ascent
      ctx.fillStyle = hexA(r.color, 0.95);
      ctx.beginPath();
      ctx.arc(r.x, r.y, 2 * DPR, 0, Math.PI * 2);
      ctx.fill();
      if (r.y <= r.burstY || r.vy >= 0) {
        burst(r.x, r.y, r.color);
        rockets.splice(i, 1);
      }
    }

    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.045 * DPR; // gravity
      s.vx *= 0.985; // drag
      s.vy *= 0.985;
      s.life--;
      if (s.life <= 0) {
        sparks.splice(i, 1);
        continue;
      }
      const a = s.life / s.max;
      ctx.fillStyle = hexA(s.color, a);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.7 * DPR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  const resize = () => {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.width = Math.floor(window.innerWidth * DPR);
    H = canvas.height = Math.floor(window.innerHeight * DPR);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    seedDots();
  };
  resize();
  window.addEventListener("resize", resize);

  window.addEventListener("pointermove", (e) => {
    mouse.x = e.clientX * DPR;
    mouse.y = e.clientY * DPR;
    mouse.active = true;
  });
  window.addEventListener("pointerleave", () => (mouse.active = false));
  // Click launches a firework toward the cursor (festive only).
  window.addEventListener("pointerdown", (e) => {
    if (!festive) return;
    const tx = e.clientX * DPR;
    rockets.push({
      x: tx,
      y: H,
      vy: -(8 + Math.random() * 2) * DPR,
      burstY: e.clientY * DPR,
      color: pick(),
    });
  });

  const frame = () => {
    ctx.clearRect(0, 0, W, H);
    if (festive) drawFireworks();
    else drawConstellation();
  };

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    frame(); // honour reduced motion: one static frame, no loop
  } else {
    const loop = () => {
      frame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

// Live theme swap: Rust evals this into open start pages when the user changes
// theme, so they re-skin (page + particle field) without a reload.
(
  window as unknown as { __SB_APPLY_THEME?: (theme: Record<string, string>) => void }
).__SB_APPLY_THEME = (theme) => {
  applyThemeVars(theme);
  (window as unknown as { __SB_REFRESH_ACCENT?: () => void }).__SB_REFRESH_ACCENT?.();
};
