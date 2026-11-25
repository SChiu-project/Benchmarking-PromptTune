// Seeded brushwork in the garden / Brabant / Clichy palette, ported from
// UI_DESIGN_WORKBOOK.html. It is decoration only: static, never animated, and
// never drawn under text, tables or figures.

export type PaintMode = "hero" | "foot";
export type PaintPalette = { d1: string; d2: string; d3: string; d4: string };

export const defaultPalette: PaintPalette = {
  d1: "#d1a93a",
  d2: "#9690c4",
  d3: "#7f9a7a",
  d4: "#a2432a",
};

/** mulberry32: a small deterministic generator, so a seed paints the same. */
export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit seed for a string such as a route path. */
export function seedFor(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(r: () => number, list: [T, number][]) {
  const total = list.reduce((n, [, w]) => n + w, 0);
  let x = r() * total;
  for (const [value, weight] of list) {
    x -= weight;
    if (x <= 0) return value;
  }
  return list[0][0];
}

function stroke(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  a: number,
  len: number,
  w: number,
  col: string,
) {
  ctx.strokeStyle = col;
  ctx.lineWidth = w;
  ctx.beginPath();
  const dx = (Math.cos(a) * len) / 2,
    dy = (Math.sin(a) * len) / 2,
    bend = len * 0.18;
  ctx.moveTo(x - dx, y - dy);
  ctx.quadraticCurveTo(
    x - ((dy * bend) / len) * 2,
    y + ((dx * bend) / len) * 2,
    x + dx,
    y + dy,
  );
  ctx.stroke();
}

/** Paint a field of width × height CSS pixels into ctx. */
export function paintField(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mode: PaintMode,
  seed: number,
  palette: PaintPalette = defaultPalette,
) {
  const W = width,
    H = height,
    r = rng(seed),
    { d1: D1, d2: D2, d3: D3, d4: D4 } = palette;
  ctx.lineCap = "round";
  const hero = mode === "hero";
  const horizon = hero ? H * 0.72 : H * 0.18;

  // Underpaint: Brabant sage sky over the garden's red earth.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  if (hero) {
    g.addColorStop(0, "#a9b49c");
    g.addColorStop(0.7, "#97a38a");
    g.addColorStop(0.74, "#8a5a3c");
    g.addColorStop(1, "#7a3d27");
  } else {
    g.addColorStop(0, "#97a38a");
    g.addColorStop(0.2, "#8a5a3c");
    g.addColorStop(1, "#6f3522");
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Brabant sky: swirling strokes along a flow field.
  const sky: [string, number][] = [
    ["#b9c3a8", 5],
    ["#8fa08a", 5],
    [D3, 4],
    ["#a7b6b0", 3],
    ["#c9ccb2", 3],
    ["#6f8578", 2],
    [D2, 1.4],
    ["#e3dcb8", 1.2],
  ];
  const n = Math.round((W * horizon) / 34);
  for (let i = 0; i < n; i++) {
    const x = r() * W,
      y = r() * horizon;
    const a =
      Math.sin(x * 0.012 + Math.cos(y * 0.03) * 1.6) * 1.4 +
      Math.cos(y * 0.02 + x * 0.004) * 1.1;
    stroke(ctx, x, y, a, 10 + r() * 16, 3 + r() * 3.2, pick(r, sky));
  }

  // Ochre contours over the clouds.
  const lines = hero ? Math.max(2, Math.round(H / 70)) : 1;
  for (let k = 0; k < lines; k++) {
    const y0 = hero ? ((k + 0.6) * horizon) / (lines + 0.3) : horizon * 0.55,
      amp = hero ? 4 + r() * 7 : 3,
      f = 0.012 + r() * 0.01,
      ph = r() * 6,
      x0 = r() * W * 0.4 - W * 0.1,
      x1 = x0 + W * (0.4 + r() * 0.7);
    ctx.strokeStyle = D1;
    ctx.lineWidth = 3.4 + r() * 1.4;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    for (let xx = x0; xx < x1; xx += 4) {
      const yy =
        y0 + Math.sin(xx * f + ph) * amp + Math.sin(xx * f * 2.7) * amp * 0.35;
      if (xx === x0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
    ctx.strokeStyle = "#ecd98a";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Brabant's low sun, hero only, placed at the right where no plaque sits.
  if (hero) {
    const sx = W * 0.9,
      sy = horizon * 0.98;
    ctx.fillStyle = D1;
    ctx.beginPath();
    ctx.arc(sx, sy, 16, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = D4;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sx, sy, 17, Math.PI * 1.05, Math.PI * 1.6);
    ctx.stroke();
  }

  // Horizon: the garden's lavender and yellow band.
  ctx.globalAlpha = 0.9;
  for (let j = 0; j < W / 5; j++) {
    stroke(
      ctx,
      r() * W,
      horizon - 6 + r() * 10,
      (r() - 0.5) * 0.3,
      12 + r() * 14,
      3 + r() * 2,
      pick(r, [
        [D1, 3],
        [D2, 3],
        ["#e8dfa6", 2],
      ]),
    );
  }
  ctx.globalAlpha = 1;

  // Garden earth: slanting dashes.
  const earth: [string, number][] = [
    [D4, 5],
    ["#8e3a22", 4],
    ["#b5653c", 3],
    ["#6e5a3a", 2],
    ["#9a7a3e", 1.5],
    ["#5f6e4a", 1.2],
    [D1, 0.6],
  ];
  const m = Math.round((W * (H - horizon)) / 26);
  for (let e = 0; e < m; e++) {
    stroke(
      ctx,
      r() * W,
      horizon + r() * (H - horizon),
      -0.35 + (r() - 0.5) * 0.6,
      8 + r() * 12,
      3 + r() * 2.5,
      pick(r, earth),
    );
  }

  // Clichy ticks: a light scatter of broken colour.
  const ticks: [string, number][] = [
    ["#cdbfdc", 3],
    [D2, 2],
    [D1, 2],
    ["#6d84a8", 1.5],
    ["#f4efdc", 2],
  ];
  const count = Math.round((W * H) / 2600);
  ctx.globalAlpha = 0.85;
  for (let t = 0; t < count; t++) {
    stroke(
      ctx,
      r() * W,
      r() * H,
      -0.5 + r() * 0.4,
      5 + r() * 5,
      1.8 + r() * 1.2,
      pick(r, ticks),
    );
  }
  ctx.globalAlpha = 1;
}
