// 11-11 v4：顶栏 / 侧栏 / 手机底栏与奶油内容区交界的粒子渐变（呈现层，不参与业务）
import { useEffect, useRef, useState, type CSSProperties } from "react";

export type EdgeBand = "top" | "left" | "bottom";

type Particle = {
  along: number;
  depth: number;
  r: number;
  phase: number;
  spin: number;
  vDepth: number;
  vAlong: number;
  base: number;
};

type Host = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  band: EdgeBand;
  particles: Particle[];
  w: number;
  h: number;
  dpr: number;
};

const hosts = new Set<Host>();
let sprite: HTMLCanvasElement | null = null;
let raf = 0;
let last = 0;
let visBound = false;
let reduceMq: MediaQueryList | null = null;

function makeSprite() {
  const s = document.createElement("canvas");
  s.width = s.height = 64;
  const c = s.getContext("2d")!;
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.22, "rgba(255,253,248,0.88)");
  g.addColorStop(0.55, "rgba(255,248,236,0.32)");
  g.addColorStop(1, "rgba(251,243,228,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  return s;
}

function countFor(band: EdgeBand, w: number, h: number) {
  // v5：大约减到 v4 的一半，能看出单颗在飘、不成片
  if (band === "top") return Math.round(Math.min(36, Math.max(16, w / 36)));
  if (band === "left") return Math.round(Math.min(32, Math.max(14, h / 32)));
  return Math.round(Math.min(22, Math.max(10, w / 28)));
}

function seed(n: number): Particle[] {
  return Array.from({ length: n }, () => ({
    along: Math.random(),
    depth: Math.pow(Math.random(), 1.7),
    r: 3.6 + Math.random() * 6.4,
    phase: Math.random() * Math.PI * 2,
    spin: 1.2 + Math.random() * 1.0,
    vDepth: 0.08 + Math.random() * 0.06,
    vAlong: (Math.random() - 0.5) * 0.03,
    base: 0.58 + Math.random() * 0.38,
  }));
}

function layout(host: Host) {
  const rect = host.canvas.getBoundingClientRect();
  const w = Math.max(0, Math.round(rect.width));
  const h = Math.max(0, Math.round(rect.height));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (w === 0 || h === 0) {
    host.w = 0;
    host.h = 0;
    return;
  }
  if (host.w === w && host.h === h && host.dpr === dpr) return;
  host.w = w;
  host.h = h;
  host.dpr = dpr;
  host.canvas.width = Math.round(w * dpr);
  host.canvas.height = Math.round(h * dpr);
  const n = countFor(host.band, w, h);
  if (host.particles.length !== n) host.particles = seed(n);
}

function syncClass() {
  const on = hosts.size > 0 && !reduceMq?.matches;
  document.documentElement.classList.toggle("edge-particles-on", on);
}

function tick(now: number) {
  raf = requestAnimationFrame(tick);
  if (document.visibilityState !== "visible" || reduceMq?.matches) {
    last = 0;
    return;
  }
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
  last = now;
  const t = now / 1000;
  if (!sprite) sprite = makeSprite();
  for (const host of hosts) {
    layout(host);
    if (!host.w) continue;
    const { ctx, w, h, dpr, particles, band } = host;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const wash =
      band === "top"
        ? ctx.createLinearGradient(0, 0, 0, h)
        : band === "left"
          ? ctx.createLinearGradient(0, 0, w, 0)
          : ctx.createLinearGradient(0, h, 0, 0);
    wash.addColorStop(0, "rgba(255,255,255,0.7)");
    wash.addColorStop(0.32, "rgba(255,255,255,0.16)");
    wash.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalAlpha = 1;
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);
    for (const p of particles) {
      p.depth += p.vDepth * dt;
      p.along += p.vAlong * dt;
      if (p.depth > 1) {
        p.depth -= 1;
        p.along = Math.random();
      }
      if (p.along < 0 || p.along > 1) p.along = (p.along + 1) % 1;
      const along =
        (p.along + Math.sin(t * p.spin * 0.35 + p.phase) * 0.025 + 1) % 1;
      const tw = 0.48 + 0.52 * Math.sin(t * p.spin + p.phase);
      const alpha = p.base * (1 - p.depth * 0.88) * tw;
      if (alpha < 0.03) continue;
      const size = p.r * (1.2 - p.depth * 0.45);
      let x: number;
      let y: number;
      if (band === "top") {
        x = along * w;
        y = p.depth * h;
      } else if (band === "left") {
        x = p.depth * w;
        y = along * h;
      } else {
        x = along * w;
        y = h - p.depth * h;
      }
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, x - size, y - size, size * 2, size * 2);
    }
    ctx.globalAlpha = 1;
  }
}

function ensureLoop() {
  if (!raf) {
    last = 0;
    raf = requestAnimationFrame(tick);
  }
}

function stopLoop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  last = 0;
}

function onVisibility() {
  if (document.visibilityState === "visible") ensureLoop();
  else stopLoop();
}

function onReduceChange() {
  syncClass();
  if (reduceMq?.matches) {
    for (const host of hosts) {
      host.ctx.setTransform(1, 0, 0, 1, 0, 0);
      host.ctx.clearRect(0, 0, host.canvas.width, host.canvas.height);
    }
    stopLoop();
  } else if (hosts.size) ensureLoop();
}

function bindGlobal() {
  if (!visBound) {
    visBound = true;
    document.addEventListener("visibilitychange", onVisibility);
    reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceMq.addEventListener("change", onReduceChange);
  }
}

function unbindGlobal() {
  if (hosts.size || !visBound) return;
  document.removeEventListener("visibilitychange", onVisibility);
  reduceMq?.removeEventListener("change", onReduceChange);
  reduceMq = null;
  visBound = false;
  stopLoop();
  sprite = null;
  document.documentElement.classList.remove("edge-particles-on");
}

function attach(canvas: HTMLCanvasElement, band: EdgeBand) {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return () => {};
  const host: Host = {
    canvas,
    ctx,
    band,
    particles: [],
    w: 0,
    h: 0,
    dpr: 1,
  };
  hosts.add(host);
  bindGlobal();
  syncClass();
  const ro = new ResizeObserver(() => layout(host));
  ro.observe(canvas);
  layout(host);
  if (!reduceMq?.matches && document.visibilityState === "visible") ensureLoop();
  return () => {
    ro.disconnect();
    hosts.delete(host);
    syncClass();
    unbindGlobal();
  };
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function EdgeFade({ band }: { band: EdgeBand }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const canvas = ref.current;
    if (!canvas) return;
    return attach(canvas, band);
  }, [band, reduced]);
  if (reduced) return null;
  return (
    <canvas
      ref={ref}
      className={`edge-fade edge-fade-${band}`}
      data-edge={band}
      aria-hidden="true"
      style={{ pointerEvents: "none" } as CSSProperties}
    />
  );
}
