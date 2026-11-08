import { FlowerPalette } from './flowers';

/*
  One palette per month. Picking a fee month repaints the sheet in it, so a parent who files
  twelve receipts ends up with twelve different cards rather than twelve copies of one.

  Only two colours are written out per month (the ink and the metallic) plus the flower's own
  colours. Panel tints and hairlines are mixed from the ink so every palette stays as legible as
  the classic sheet, and body text stays neutral grey so a grayscale print still reads.
*/

type FlowerColours = Omit<FlowerPalette, 'accent' | 'edge'>;

const MONTH_PALETTE: Record<string, { ink: string; accent: string; fl: FlowerColours }> = {
  January: { ink: '#1f3864', accent: '#b08d3f',
    fl: { p1: '#ffffff', p2: '#f5f1e6', p3: '#e4ddcb', p4: '#fbf8f1', eye: '#c9a227', eyeDark: '#9a7a1e', leaf: '#4f6b4a', leafDark: '#35492f' } },
  February: { ink: '#9c4f63', accent: '#b76e79',
    fl: { p1: '#f7cdd6', p2: '#eda9ba', p3: '#d9849b', p4: '#fbe3e9', eye: '#c98a97', eyeDark: '#9c5566', leaf: '#5d7352', leafDark: '#3f5137' } },
  March: { ink: '#1b6b4c', accent: '#c6ad7c',
    fl: { p1: '#f6ecd6', p2: '#ecd9ae', p3: '#dcc289', p4: '#fbf5e7', eye: '#b9892f', eyeDark: '#8a6420', leaf: '#2f7a56', leafDark: '#1d5239' } },
  April: { ink: '#6a5a92', accent: '#9a9aa6',
    fl: { p1: '#ffffff', p2: '#efecf7', p3: '#ddd6ee', p4: '#faf8fd', eye: '#e3b53f', eyeDark: '#ad8520', leaf: '#6b7a5c', leafDark: '#4a553f' } },
  May: { ink: '#7b2238', accent: '#b76e79',
    fl: { p1: '#eda9b6', p2: '#d47187', p3: '#a83e59', p4: '#f6d3da', eye: '#e8c98f', eyeDark: '#a8833c', leaf: '#5b6e4e', leafDark: '#3d4d34' } },
  June: { ink: '#176b70', accent: '#c3bba0',
    fl: { p1: '#b7b4dd', p2: '#8e8ac4', p3: '#6f6ba8', p4: '#d6d4ec', eye: '#d8cfa6', eyeDark: '#a1976c', leaf: '#4f7d72', leafDark: '#345549' } },
  July: { ink: '#b07c13', accent: '#d9a93f',
    fl: { p1: '#ffd864', p2: '#f5bf32', p3: '#dda01c', p4: '#ffe79a', eye: '#6b4a1c', eyeDark: '#432d0f', leaf: '#5d7a35', leafDark: '#3e5222' } },
  August: { ink: '#1b2a4a', accent: '#9aa0ad',
    fl: { p1: '#e9e6f1', p2: '#d2cde2', p3: '#bab3d2', p4: '#f5f3f9', eye: '#2f3f68', eyeDark: '#16233f', leaf: '#4a5f5a', leafDark: '#31403c' } },
  September: { ink: '#5a6e4e', accent: '#bfae8c',
    fl: { p1: '#f7f2e3', p2: '#e9e0c6', p3: '#d4c7a4', p4: '#fbf8ef', eye: '#b08f3c', eyeDark: '#7d6526', leaf: '#6b7d58', leafDark: '#49573a' } },
  October: { ink: '#a1502b', accent: '#c7a479',
    fl: { p1: '#f3a94a', p2: '#e2832a', p3: '#c4601c', p4: '#f9cd8c', eye: '#8a3f12', eyeDark: '#5c2909', leaf: '#6e7439', leafDark: '#4b4f25' } },
  November: { ink: '#6e2a52', accent: '#c6ad7c',
    fl: { p1: '#e9b9cd', p2: '#d286a8', p3: '#a9497a', p4: '#f5dbe6', eye: '#e8d39a', eyeDark: '#a88f4e', leaf: '#4f6b50', leafDark: '#354935' } },
  December: { ink: '#33373c', accent: '#b7902f',
    fl: { p1: '#e3b64a', p2: '#cf9a28', p3: '#a8761a', p4: '#f0d48a', eye: '#c9452f', eyeDark: '#8d2a19', leaf: '#3f5a40', leafDark: '#2a3d2b' } },
};

const hex = (h: string) => {
  const v = h.replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
};

/** colour over white: 0 is white, 1 is the colour itself */
const wash = (h: string, ratio: number) => '#' + hex(h)
  .map(c => Math.round(255 - (255 - c) * ratio).toString(16).padStart(2, '0')).join('');

/** a touch darker than the ink, for the small-caps total label */
const mixDown = (h: string) =>
  '#' + hex(h).map(c => Math.round(c * .74).toString(16).padStart(2, '0')).join('');

export interface MonthPalette {
  month: string;
  /** CSS custom properties read by everything under .paper in styles.css */
  vars: Record<string, string>;
  fl: FlowerPalette;
}

const cache = new Map<string, MonthPalette>();

export function paletteFor(month: string): MonthPalette {
  const m = MONTH_PALETTE[month] ? month : 'November';
  const hit = cache.get(m);
  if (hit) return hit;
  const p = MONTH_PALETTE[m];
  const out: MonthPalette = {
    month: m,
    vars: {
      '--r-ink': p.ink,
      '--r-accent': p.accent,
      '--r-deep': mixDown(p.ink),
      '--r-tint': wash(p.ink, .085),
      '--r-wash': wash(p.ink, .045),
      '--r-wash2': wash(p.ink, .025),
      '--r-line': wash(p.ink, .10),
      '--r-line2': wash(p.ink, .055),
      '--r-rule': wash(p.accent, .62),
      '--r-seal-rgb': hex(p.ink).join(','),
    },
    fl: { ...p.fl, accent: p.accent, edge: mixDown(p.fl.p3) },
  };
  cache.set(m, out);
  return out;
}
