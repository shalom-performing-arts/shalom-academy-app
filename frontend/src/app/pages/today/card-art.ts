/*
  The birthday card, drawn on a canvas: 1080 × 1350 px, the shape WhatsApp shows best.

  One design for every month of the year. Each takes its colours from the month's birthstone,
  its flowers from the month's birth flower, and adds a touch of the season (snow in January,
  hearts in February, fireworks in July …). An ivory card with a gold-foil frame sits on the
  month's colour; the lettering is set in Great Vibes, Cinzel and Lato.
*/

type FlowerStyle = 'daisy' | 'blossom' | 'rose' | 'star' | 'bell';
type Accent = 'snow' | 'hearts' | 'sparkles' | 'dew' | 'leaves' | 'pearls' | 'fireworks' | 'rays' | 'stars' | 'autumn' | 'holly';

export interface CardTheme {
  id: string;
  /** "January" */
  month: string;
  flower: string;
  stone: string;
  /** the colour behind the card, top to bottom */
  bg: [string, string, string];
  /** lettering */
  ink: string;
  /** the month's own colour, for the medallion and small touches */
  gem: [string, string];
  petals: [string, string];
  centre: string;
  leaf: string;
  style: FlowerStyle;
  accent: Accent;
}

export const THEMES: CardTheme[] = [
  { id: 'jan', month: 'January', flower: 'Carnation', stone: 'Garnet', bg: ['#0e2340', '#1f4f7a', '#0b1a30'], ink: '#1b2f4f',
    gem: ['#b1243f', '#6e0f22'], petals: ['#e2566f', '#a3152f'], centre: '#7a0f24', leaf: '#3f6b5a', style: 'rose', accent: 'snow' },
  { id: 'feb', month: 'February', flower: 'Violet', stone: 'Amethyst', bg: ['#2a0f45', '#5b2b8f', '#1d0a31'], ink: '#38194f',
    gem: ['#8e5bd0', '#4b2378'], petals: ['#b48ae8', '#6b3fb0'], centre: '#f4d35e', leaf: '#4f7a4a', style: 'blossom', accent: 'hearts' },
  { id: 'mar', month: 'March', flower: 'Daffodil', stone: 'Aquamarine', bg: ['#0b4650', '#2c9c9f', '#08343c'], ink: '#0f3d45',
    gem: ['#4fc3c4', '#16757a'], petals: ['#fbe38a', '#f2b632'], centre: '#e8892a', leaf: '#4c8a3f', style: 'star', accent: 'dew' },
  { id: 'apr', month: 'April', flower: 'Daisy', stone: 'Diamond', bg: ['#2f3c4f', '#7f93ab', '#1f2836'], ink: '#26324a',
    gem: ['#cfd9e6', '#7d8ea6'], petals: ['#ffffff', '#e6ebf2'], centre: '#f2c230', leaf: '#5b8c4f', style: 'daisy', accent: 'sparkles' },
  { id: 'may', month: 'May', flower: 'Lily of the valley', stone: 'Emerald', bg: ['#053d2e', '#0f8a62', '#032a20'], ink: '#0b3b2c',
    gem: ['#1fb57f', '#0a6a49'], petals: ['#ffffff', '#e8f3ec'], centre: '#cfe8d8', leaf: '#2f7d4f', style: 'bell', accent: 'leaves' },
  { id: 'jun', month: 'June', flower: 'Rose', stone: 'Pearl', bg: ['#6e1d3d', '#c9718f', '#4f1129'], ink: '#5a1631',
    gem: ['#f1e4e8', '#c9a7b4'], petals: ['#f4a3bb', '#c8466d'], centre: '#9c2a4c', leaf: '#4f7a52', style: 'rose', accent: 'pearls' },
  { id: 'jul', month: 'July', flower: 'Larkspur', stone: 'Ruby', bg: ['#4a0614', '#a3132f', '#33030d'], ink: '#4d0a18',
    gem: ['#d42a4a', '#7a0b1f'], petals: ['#8fa8ff', '#4c64d6'], centre: '#f4f1ff', leaf: '#3f7a52', style: 'star', accent: 'fireworks' },
  { id: 'aug', month: 'August', flower: 'Gladiolus', stone: 'Peridot', bg: ['#2b4209', '#7aa51f', '#1d2f05'], ink: '#2c3f0c',
    gem: ['#a6d13c', '#5f8a12'], petals: ['#ff9a7a', '#e2553a'], centre: '#ffe08a', leaf: '#4f8a2a', style: 'blossom', accent: 'rays' },
  { id: 'sep', month: 'September', flower: 'Aster', stone: 'Sapphire', bg: ['#0a1a52', '#2449b8', '#06103a'], ink: '#14245a',
    gem: ['#3d6ee0', '#162f8f'], petals: ['#b79cf0', '#7a56cf'], centre: '#f4c534', leaf: '#4c7a5a', style: 'daisy', accent: 'stars' },
  { id: 'oct', month: 'October', flower: 'Marigold', stone: 'Opal', bg: ['#3a1747', '#c4562a', '#2a0f35'], ink: '#3d1a3f',
    gem: ['#f7c6a8', '#9b6bc7'], petals: ['#ffb43a', '#e2701a'], centre: '#b8410f', leaf: '#5d7a3a', style: 'rose', accent: 'autumn' },
  { id: 'nov', month: 'November', flower: 'Chrysanthemum', stone: 'Topaz', bg: ['#4f1a0c', '#c47a17', '#381206'], ink: '#4a1d0c',
    gem: ['#f0a72e', '#a8600b'], petals: ['#ffd36b', '#e59a1c'], centre: '#9a4f0c', leaf: '#5f6f2f', style: 'daisy', accent: 'autumn' },
  { id: 'dec', month: 'December', flower: 'Holly', stone: 'Turquoise', bg: ['#073a2c', '#117566', '#04281e'], ink: '#0b3a2e',
    gem: ['#3cc7c0', '#0f7d78'], petals: ['#ffffff', '#f2efe6'], centre: '#f2c230', leaf: '#1f6b45', style: 'star', accent: 'holly' },
];

export function themeFor(month: number): CardTheme {
  return THEMES[((month % 12) + 12) % 12];
}

export interface CardContent {
  name: string;
  turning: number | null;
  wish: string;
  academy: string;
  /** who signs it: "Teacher Rebeccah" */
  from: string;
  motto: string;
  logo: string;
  theme: CardTheme;
}

export const CARD_W = 1080;
export const CARD_H = 1350;
const PANEL = { x: 64, y: 64, w: CARD_W - 128, h: CARD_H - 128 };

/* ============================== drawing helpers ============================== */

type Ctx = CanvasRenderingContext2D;

/** the same scatter every time for the same name, so the preview and the copy match */
function seeded(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function fontsReady() {
  await Promise.race([
    Promise.all(['130px "Great Vibes"', '600 60px Cinzel', '700 60px Cinzel', '34px Lato', 'italic 34px Lato', '700 20px Lato']
      .map(f => document.fonts.load(f))),
    new Promise(r => setTimeout(r, 2500)),
  ]);
}

/** gold foil: a metallic sweep, across the given span */
function foil(ctx: Ctx, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, '#9c6b1c');
  g.addColorStop(.2, '#e9c766');
  g.addColorStop(.38, '#fff0b3');
  g.addColorStop(.55, '#c8952f');
  g.addColorStop(.75, '#f3d77c');
  g.addColorStop(1, '#8f6018');
  return g;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function wrap(ctx: Ctx, text: string, width: number, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > width && line) { out.push(line); line = w; } else line = t;
    }
    if (line) out.push(line);
  }
  return out.slice(0, max);
}

function fit(ctx: Ctx, text: string, font: (px: number) => string, start: number, min: number, width: number): number {
  let px = start;
  ctx.font = font(px);
  while (px > min && ctx.measureText(text).width > width) ctx.font = font(--px);
  return px;
}

function ordinalParts(n: number): [string, string] {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return [String(n), s[(v - 20) % 10] || s[v] || s[0]];
}

/* ============================== botanicals ============================== */

function leaf(ctx: Ctx, x: number, y: number, len: number, angle: number, colour: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const g = ctx.createLinearGradient(0, -len * .2, len, len * .2);
  g.addColorStop(0, shade(colour, .15));
  g.addColorStop(1, shade(colour, -.25));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(len * .3, -len * .32, len * .75, -len * .28, len, 0);
  ctx.bezierCurveTo(len * .75, len * .28, len * .3, len * .32, 0, 0);
  ctx.fill();
  ctx.strokeStyle = alpha('#ffffff', .35);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(len * .06, 0);
  ctx.quadraticCurveTo(len * .5, -len * .04, len * .94, 0);
  ctx.stroke();
  ctx.restore();
}

function flower(ctx: Ctx, t: CardTheme, x: number, y: number, r: number, rot: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const [p1, p2] = t.petals;
  const petalFill = (len: number) => {
    const g = ctx.createRadialGradient(0, 0, len * .1, 0, 0, len);
    g.addColorStop(0, shade(p2, -.1));
    g.addColorStop(.45, p2);
    g.addColorStop(1, p1);
    return g;
  };
  ctx.shadowColor = 'rgba(40, 10, 20, .22)';
  ctx.shadowBlur = r * .25;
  ctx.shadowOffsetY = r * .06;
  switch (t.style) {
    case 'daisy': {
      ctx.fillStyle = petalFill(r);
      for (let layer = 0; layer < 2; layer++) {
        const n = 16, len = r * (layer ? .78 : 1);
        for (let i = 0; i < n; i++) {
          ctx.save();
          ctx.rotate((i + layer * .5) * Math.PI * 2 / n);
          ctx.beginPath();
          ctx.ellipse(len * .52, 0, len * .5, r * .11, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
      ctx.shadowColor = 'transparent';
      centre(ctx, t, r * .28);
      break;
    }
    case 'blossom': {
      for (let i = 0; i < 5; i++) {
        ctx.save();
        ctx.rotate(i * Math.PI * 2 / 5);
        ctx.fillStyle = petalFill(r);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(r * .55, -r * .55, r * 1.15, -r * .3, r * .98, 0);
        ctx.bezierCurveTo(r * 1.15, r * .3, r * .55, r * .55, 0, 0);
        ctx.fill();
        ctx.restore();
      }
      ctx.shadowColor = 'transparent';
      centre(ctx, t, r * .22);
      break;
    }
    case 'star': {
      for (let i = 0; i < 6; i++) {
        ctx.save();
        ctx.rotate(i * Math.PI / 3);
        ctx.fillStyle = petalFill(r);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(r * .55, -r * .32, r, 0);
        ctx.quadraticCurveTo(r * .55, r * .32, 0, 0);
        ctx.fill();
        ctx.restore();
      }
      ctx.shadowColor = 'transparent';
      // a little cup in the middle, as a daffodil or narcissus has
      ctx.fillStyle = t.centre;
      ctx.beginPath();
      ctx.arc(0, 0, r * .3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = shade(t.centre, -.3);
      ctx.lineWidth = r * .05;
      ctx.stroke();
      ctx.fillStyle = shade(t.centre, -.35);
      ctx.beginPath();
      ctx.arc(0, 0, r * .12, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'rose': {
      // rings of rounded petals, each ring smaller, deeper in colour and turned a little,
      // closing to a tight bud: a rose, carnation or marigold seen from above
      const rings = 4;
      for (let k = 0; k < rings; k++) {
        const rk = r * (1 - k * .22), n = 5 + (k % 2);
        const tone = k / (rings - 1);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + k * .55;
          const pxl = Math.cos(a) * rk * .42, pyl = Math.sin(a) * rk * .42;
          const g = ctx.createRadialGradient(pxl * .4, pyl * .4, rk * .05, pxl, pyl, rk * .62);
          g.addColorStop(0, shade(p2, -.15 - tone * .1));
          g.addColorStop(.7, k ? shade(p1, -tone * .18) : p1);
          g.addColorStop(1, shade(p1, .25 - tone * .1));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.ellipse(pxl, pyl, rk * .58, rk * .5, a, 0, Math.PI * 2);
          ctx.fill();
          // the turned-back edge of the petal
          ctx.strokeStyle = 'rgba(255,255,255,.35)';
          ctx.lineWidth = Math.max(1, r * .025);
          ctx.beginPath();
          ctx.ellipse(pxl, pyl, rk * .58, rk * .5, a, a - .9, a + .9);
          ctx.stroke();
        }
        if (k === 0) ctx.shadowColor = 'transparent';
      }
      // the bud
      ctx.fillStyle = shade(p2, -.3);
      ctx.beginPath();
      ctx.arc(0, 0, r * .16, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.4)';
      ctx.lineWidth = Math.max(1, r * .03);
      ctx.beginPath();
      ctx.arc(r * .02, 0, r * .09, .4, Math.PI * 1.6);
      ctx.stroke();
      break;
    }
    case 'bell': {
      // lily of the valley: a curved stem of little bells
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = t.leaf;
      ctx.lineWidth = r * .06;
      ctx.beginPath();
      ctx.moveTo(-r, r * .2);
      ctx.quadraticCurveTo(0, -r * .9, r * 1.1, -r * .1);
      ctx.stroke();
      for (let i = 0; i < 5; i++) {
        const s = (i + .6) / 5.6;
        const bx = -r + 2.1 * r * s, by = r * .2 - 1.1 * r * Math.sin(Math.PI * s) * .82;
        ctx.strokeStyle = t.leaf;
        ctx.lineWidth = r * .03;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx, by + r * .2);
        ctx.stroke();
        const g = ctx.createRadialGradient(bx - r * .05, by + r * .25, 1, bx, by + r * .3, r * .22);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(1, p2);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(bx - r * .17, by + r * .42);
        ctx.quadraticCurveTo(bx - r * .2, by + r * .16, bx, by + r * .16);
        ctx.quadraticCurveTo(bx + r * .2, by + r * .16, bx + r * .17, by + r * .42);
        ctx.quadraticCurveTo(bx + r * .08, by + r * .34, bx, by + r * .44);
        ctx.quadraticCurveTo(bx - r * .08, by + r * .34, bx - r * .17, by + r * .42);
        ctx.fill();
      }
      break;
    }
  }
  ctx.restore();
}

function centre(ctx: Ctx, t: CardTheme, r: number) {
  const g = ctx.createRadialGradient(-r * .3, -r * .3, r * .1, 0, 0, r);
  g.addColorStop(0, shade(t.centre, .4));
  g.addColorStop(1, shade(t.centre, -.2));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = alpha('#000000', .18);
  for (let i = 0; i < 10; i++) {
    const a = i * 2.4, d = r * .55 * Math.sqrt(i / 10);
    ctx.beginPath();
    ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * .09, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * A spray of flowers and leaves in a corner. {@code dir} turns it: 0 grows down and right from
 * the top-left corner, Math.PI up and left from the bottom-right.
 */
function spray(ctx: Ctx, t: CardTheme, x: number, y: number, dir: number, scale: number, rnd: () => number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(dir);
  const s = scale;
  // leaves fanning out
  const leaves: [number, number, number, number][] = [
    [30, 10, 150, .05], [10, 30, 150, 1.5], [70, 40, 120, .45], [40, 80, 120, 1.15],
    [120, 20, 105, -.2], [20, 125, 105, 1.75], [105, 95, 95, .8], [150, 60, 85, .25], [60, 150, 85, 1.3],
  ];
  for (const [lx, ly, len, a] of leaves) leaf(ctx, lx * s, ly * s, len * s * (.9 + rnd() * .2), a + (rnd() - .5) * .15, t.leaf);
  // flowers, the largest in the corner
  const blooms: [number, number, number][] = [[62, 62, 58], [150, 30, 40], [30, 150, 40], [135, 128, 32], [205, 75, 24], [75, 205, 24]];
  for (const [fx, fy, fr] of blooms) flower(ctx, t, fx * s, fy * s, fr * s, rnd() * Math.PI);
  // buds and berries
  for (const [bx, by] of [[200, 20], [20, 200], [185, 140], [140, 185]] as const) {
    ctx.fillStyle = t.accent === 'holly' ? '#c8102e' : t.petals[1];
    ctx.beginPath();
    ctx.arc(bx * s, by * s, 7 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath();
    ctx.arc(bx * s - 2.2 * s, by * s - 2.2 * s, 2.4 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ============================== the season ============================== */

function snowflake(ctx: Ctx, x: number, y: number, r: number, colour: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(1.2, r * .09);
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, -r);
    ctx.moveTo(0, -r * .55); ctx.lineTo(-r * .25, -r * .78);
    ctx.moveTo(0, -r * .55); ctx.lineTo(r * .25, -r * .78);
    ctx.stroke();
  }
  ctx.restore();
}

function heart(ctx: Ctx, x: number, y: number, s: number, colour: string, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(0, s * .3);
  ctx.bezierCurveTo(-s * .9, -s * .35, -s * .45, -s * 1, 0, -s * .45);
  ctx.bezierCurveTo(s * .45, -s * 1, s * .9, -s * .35, 0, s * .3);
  ctx.fill();
  ctx.restore();
}

function sparkle(ctx: Ctx, x: number, y: number, s: number, colour: string | CanvasGradient) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = colour;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 ? s * .22 : s;
    const a = (i * Math.PI) / 4;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function star5(ctx: Ctx, x: number, y: number, s: number, colour: string | CanvasGradient) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = colour;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? s * .42 : s;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function burst(ctx: Ctx, x: number, y: number, r: number, colour: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = colour;
  ctx.lineCap = 'round';
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    ctx.lineWidth = i % 2 ? 2 : 3;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * .3, Math.sin(a) * r * .3);
    ctx.lineTo(Math.cos(a) * r * (i % 2 ? .78 : 1), Math.sin(a) * r * (i % 2 ? .78 : 1));
    ctx.stroke();
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function hollyLeaf(ctx: Ctx, x: number, y: number, len: number, a: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.fillStyle = '#1f6b45';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  const n = 4;
  for (let i = 1; i <= n; i++) ctx.quadraticCurveTo(len * (i - .5) / n, -len * .32, len * i / n, -len * .12);
  for (let i = n; i >= 1; i--) ctx.quadraticCurveTo(len * (i - .5) / n, len * .32, len * (i - 1) / n, len * .12 * (i > 1 ? 1 : 0));
  ctx.fill();
  ctx.restore();
}

/** small touches of the month, scattered over the coloured border */
function season(ctx: Ctx, t: CardTheme, rnd: () => number) {
  const spots: [number, number][] = [];
  for (let i = 0; i < 46; i++) {
    // only the coloured border around the card, never under the lettering
    const side = Math.floor(rnd() * 4);
    const along = rnd();
    const depth = 10 + rnd() * 44;
    spots.push(side === 0 ? [along * CARD_W, depth] : side === 1 ? [CARD_W - depth, along * CARD_H]
      : side === 2 ? [along * CARD_W, CARD_H - depth] : [depth, along * CARD_H]);
  }
  ctx.save();
  ctx.globalAlpha = .8;
  for (const [x, y] of spots) {
    const s = 8 + rnd() * 12;
    switch (t.accent) {
      case 'snow': snowflake(ctx, x, y, s, 'rgba(255,255,255,.85)'); break;
      case 'hearts': heart(ctx, x, y, s * 1.3, rnd() < .5 ? '#f4a6c8' : '#ffffff', (rnd() - .5) * .8); break;
      case 'holly': rnd() < .5 ? snowflake(ctx, x, y, s, 'rgba(255,255,255,.8)') : star5(ctx, x, y, s * .8, foil(ctx, x - s, y - s, x + s, y + s)); break;
      case 'fireworks': rnd() < .3 ? burst(ctx, x, y, s * 1.4, rnd() < .5 ? '#ffd27a' : '#ffffff') : sparkle(ctx, x, y, s * .7, '#ffe7a3'); break;
      case 'stars': star5(ctx, x, y, s * .7, rnd() < .5 ? '#ffe7a3' : '#ffffff'); break;
      case 'pearls': pearl(ctx, x, y, s * .45); break;
      case 'autumn': leaf(ctx, x, y, s * 2.2, rnd() * Math.PI * 2, rnd() < .5 ? '#e0892a' : '#b5481c'); break;
      case 'leaves': leaf(ctx, x, y, s * 2.2, rnd() * Math.PI * 2, rnd() < .5 ? '#5fc48f' : '#2f8f5f'); break;
      case 'dew': pearl(ctx, x, y, s * .4, '#bff3f0'); break;
      case 'rays': sparkle(ctx, x, y, s * .8, '#fff2b0'); break;
      default: sparkle(ctx, x, y, s * .8, '#ffffff');
    }
  }
  ctx.restore();
}

function pearl(ctx: Ctx, x: number, y: number, r: number, tint = '#ffffff') {
  const g = ctx.createRadialGradient(x - r * .35, y - r * .35, r * .1, x, y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(.6, tint);
  g.addColorStop(1, 'rgba(200,190,200,.9)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** a large, faint emblem of the month behind the lettering */
function watermark(ctx: Ctx, t: CardTheme, x: number, y: number) {
  ctx.save();
  ctx.globalAlpha = .06;
  switch (t.accent) {
    case 'snow': case 'holly': snowflake(ctx, x, y, 300, t.ink); break;
    case 'hearts': heart(ctx, x, y + 120, 380, t.gem[1]); break;
    case 'fireworks': burst(ctx, x, y, 260, t.gem[1]); break;
    case 'stars': star5(ctx, x, y, 300, t.ink); break;
    default: flower(ctx, { ...t, petals: [t.ink, t.ink], centre: t.ink, style: t.style === 'bell' ? 'blossom' : t.style }, x, y, 290, 0);
  }
  ctx.restore();
}

/* ============================== the card ============================== */

export async function drawCard(c: CardContent): Promise<HTMLCanvasElement> {
  await fontsReady();
  const logo = await loadImage(c.logo);
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d')!;
  const t = c.theme;
  const rnd = seeded(c.name + t.id);
  const { x: px, y: py, w: pw, h: ph } = PANEL;
  const cx = CARD_W / 2;

  // ---- the month's colour, with a soft light from the top
  const bg = ctx.createLinearGradient(0, 0, CARD_W * .35, CARD_H);
  bg.addColorStop(0, t.bg[1]);
  bg.addColorStop(.5, t.bg[0]);
  bg.addColorStop(1, t.bg[2]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const light = ctx.createRadialGradient(cx, -100, 50, cx, 200, 900);
  light.addColorStop(0, 'rgba(255,255,255,.28)');
  light.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  season(ctx, t, rnd);

  // ---- the ivory card
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.45)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 14;
  roundRect(ctx, px, py, pw, ph, 26);
  const paper = ctx.createLinearGradient(0, py, 0, py + ph);
  paper.addColorStop(0, '#fffdf8');
  paper.addColorStop(1, '#fbf4e8');
  ctx.fillStyle = paper;
  ctx.fill();
  ctx.restore();
  // a fine paper grain
  ctx.save();
  roundRect(ctx, px, py, pw, ph, 26);
  ctx.clip();
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = rnd() < .5 ? 'rgba(120,90,40,.035)' : 'rgba(255,255,255,.5)';
    ctx.fillRect(px + rnd() * pw, py + rnd() * ph, 1.6, 1.6);
  }
  watermark(ctx, t, cx, py + ph * .52);
  ctx.restore();

  // ---- gold-foil frame: a double rule with jewelled corners
  const gold = foil(ctx, px, py, px + pw, py + ph);
  ctx.strokeStyle = gold;
  ctx.lineWidth = 3;
  roundRect(ctx, px + 22, py + 22, pw - 44, ph - 44, 16);
  ctx.stroke();
  ctx.lineWidth = 1.2;
  roundRect(ctx, px + 32, py + 32, pw - 64, ph - 64, 10);
  ctx.stroke();

  // ---- the month's flowers in two corners
  spray(ctx, t, px - 6, py - 6, 0, 1.05, rnd);
  spray(ctx, t, px + pw + 6, py + ph + 6, Math.PI, 1.05, rnd);
  for (const [x, y] of [[px + pw - 27, py + 27], [px + 27, py + ph - 27]] as const) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = gold;
    ctx.fillRect(-9, -9, 18, 18);
    ctx.fillStyle = t.gem[0];
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
  }

  // ---- the academy's logo: the whole gold emblem, uncropped, straight on the ivory paper.
  // It carries the academy's name itself, so no name is written under it.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const top = py + 52, boxW = 300, boxH = 250;
  if (logo) {
    const s = Math.min(boxW / logo.width, boxH / logo.height);
    const w = logo.width * s, h = logo.height * s;
    const lx = cx - w / 2, ly = top + (boxH - h) / 2;
    // a soft warm light behind the gold, as if it were catching the light
    const glow = ctx.createRadialGradient(cx, ly + h * .45, 10, cx, ly + h * .45, w * .75);
    glow.addColorStop(0, 'rgba(255, 236, 170, .55)');
    glow.addColorStop(1, 'rgba(255, 236, 170, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - w, ly - h * .3, w * 2, h * 1.6);
    ctx.save();
    ctx.shadowColor = 'rgba(90, 60, 10, .28)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
    ctx.drawImage(logo, lx, ly, w, h);
    ctx.restore();
  } else {
    // no logo to hand: the academy's name in its place
    ctx.fillStyle = alpha(t.ink, .75);
    ctx.letterSpacing = '6px';
    const acTop = fit(ctx, c.academy.toUpperCase(), px => `600 ${px}px Cinzel, Georgia, serif`, 22, 14, pw - 360);
    ctx.font = `600 ${acTop}px Cinzel, Georgia, serif`;
    ctx.fillText(c.academy.toUpperCase(), cx, top + boxH / 2);
    ctx.letterSpacing = '0px';
  }

  // ---- Happy Birthday, in gold foil
  const hb = fit(ctx, 'Happy Birthday', px => `${px}px "Great Vibes", cursive`, 148, 100, pw - 240);
  ctx.font = `${hb}px "Great Vibes", cursive`;
  ctx.save();
  ctx.shadowColor = 'rgba(90, 60, 10, .25)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = foil(ctx, cx - 380, py + 340, cx + 380, py + 440);
  ctx.fillText('Happy Birthday', cx, py + 440);
  ctx.restore();

  // ---- the name
  ctx.fillStyle = t.ink;
  ctx.letterSpacing = '5px';
  const nm = c.name.toUpperCase();
  const ns = fit(ctx, nm, px => `700 ${px}px Cinzel, Georgia, serif`, 60, 32, pw - 170);
  ctx.font = `700 ${ns}px Cinzel, Georgia, serif`;
  ctx.fillText(nm, cx, py + 520, pw - 170);
  ctx.letterSpacing = '0px';

  // ---- an ornamental rule: line, diamond, line
  const ry = py + 556;
  ctx.strokeStyle = gold;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 200, ry); ctx.lineTo(cx - 22, ry);
  ctx.moveTo(cx + 22, ry); ctx.lineTo(cx + 200, ry);
  ctx.stroke();
  for (const dx of [-210, 210]) { ctx.fillStyle = gold; ctx.beginPath(); ctx.arc(cx + dx, ry, 3.5, 0, Math.PI * 2); ctx.fill(); }
  ctx.save();
  ctx.translate(cx, ry);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = gold;
  ctx.fillRect(-9, -9, 18, 18);
  ctx.fillStyle = t.gem[0];
  ctx.fillRect(-5, -5, 10, 10);
  ctx.restore();

  // ---- the medallion: the age in a gem of the month, ringed in gold
  const my = py + 655, mr = 80;
  if (c.turning) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.25)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.beginPath();
    ctx.arc(cx, my, mr, 0, Math.PI * 2);
    ctx.fillStyle = foil(ctx, cx - mr, my - mr, cx + mr, my + mr);
    ctx.fill();
    ctx.restore();
    const gem = ctx.createRadialGradient(cx - mr * .35, my - mr * .4, mr * .1, cx, my, mr * .86);
    gem.addColorStop(0, shade(t.gem[0], .35));
    gem.addColorStop(.55, t.gem[0]);
    gem.addColorStop(1, t.gem[1]);
    ctx.fillStyle = gem;
    ctx.beginPath();
    ctx.arc(cx, my, mr * .86, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, my, mr * .78, 0, Math.PI * 2);
    ctx.stroke();
    // the number, with its little "th"
    const [num, suf] = ordinalParts(c.turning);
    const light = t.id === 'apr' || t.id === 'jun' || t.id === 'oct';
    ctx.fillStyle = light ? t.ink : '#ffffff';
    ctx.font = `700 ${num.length > 1 ? 66 : 76}px Cinzel, Georgia, serif`;
    const nw = ctx.measureText(num).width;
    ctx.font = '700 25px Cinzel, Georgia, serif';
    const sw = ctx.measureText(suf).width;
    const left = cx - (nw + sw + 4) / 2;
    ctx.textAlign = 'left';
    ctx.font = `700 ${num.length > 1 ? 66 : 76}px Cinzel, Georgia, serif`;
    ctx.fillText(num, left, my + 18);
    ctx.font = '700 25px Cinzel, Georgia, serif';
    ctx.fillText(suf, left + nw + 4, my - 12);
    ctx.textAlign = 'center';
    ctx.letterSpacing = '4px';
    ctx.font = '700 13px Lato, "Segoe UI", sans-serif';
    ctx.fillText('BIRTHDAY', cx, my + 44);
    ctx.letterSpacing = '0px';
  } else {
    flower(ctx, t, cx, my, 66, .3);
  }

  // ---- the wish
  ctx.fillStyle = alpha(t.ink, .85);
  ctx.font = 'italic 32px Lato, "Segoe UI", sans-serif';
  let y = my + mr + 66;
  for (const line of wrap(ctx, c.wish, pw - 250, 4)) {
    ctx.fillText(line, cx, y);
    y += 45;
  }

  // ---- signed by the teacher and the academy; kept clear of the corner flowers
  const sy = py + ph - 222;
  ctx.fillStyle = alpha(t.ink, .7);
  ctx.font = 'italic 24px Lato, "Segoe UI", sans-serif';
  ctx.fillText('With all our love,', cx, sy - 50);
  ctx.fillStyle = t.gem[1] === '#c9a7b4' ? t.ink : shade(t.gem[1], -.1);
  const sig = (c.from || 'Your teachers') + ' ♥';
  const ss = fit(ctx, sig, px => `${px}px "Great Vibes", cursive`, 62, 40, pw - 420);
  ctx.font = `${ss}px "Great Vibes", cursive`;
  ctx.fillText(sig, cx, sy + 8);
  ctx.fillStyle = t.ink;
  ctx.letterSpacing = '2px';
  const amp = '& EVERYONE AT ' + c.academy.toUpperCase();
  const as = fit(ctx, amp, px => `600 ${px}px Cinzel, Georgia, serif`, 18, 13, pw - 480);
  ctx.font = `600 ${as}px Cinzel, Georgia, serif`;
  ctx.fillText(amp, cx, sy + 52);
  ctx.letterSpacing = '0px';

  // ---- the month, its stone and its flower, on two short lines
  ctx.fillStyle = alpha(t.ink, .55);
  ctx.letterSpacing = '5px';
  ctx.font = '700 16px Lato, "Segoe UI", sans-serif';
  ctx.fillText(`A ${t.month.toUpperCase()} BIRTHDAY`, cx, py + ph - 108);
  ctx.letterSpacing = '3px';
  ctx.font = '600 14px Lato, "Segoe UI", sans-serif';
  ctx.fillText(`${t.stone.toUpperCase()}  ·  ${t.flower.toUpperCase()}`, cx, py + ph - 82, pw - 500);
  ctx.letterSpacing = '0px';
  return canvas;
}

export function canvasPng(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((ok, fail) => c.toBlob(b => b ? ok(b) : fail(new Error('no picture')), 'image/png'));
}
