/** The month's colours as the flower drawings use them (see palette.ts). */
export interface FlowerPalette {
  p1: string; p2: string; p3: string; p4: string;
  eye: string; eyeDark: string; leaf: string; leafDark: string;
  accent: string;
  /** hairline between neighbouring petals */
  edge: string;
}

// Botanical artwork for the monthly receipt themes.
//
// Twelve species, one per month, each drawn as real SVG geometry rather than a
// glyph or an icon, so it stays sharp at the 300 dpi the receipt exports at and
// recolours cleanly to whichever palette the month is using.
//
// Every flower is drawn around its own origin at roughly 10 units of radius.
// The composer scales and places them; nothing here knows about the page.
//
// Ported from the original app's flowers.js; the drawing code is unchanged.

const R = 10;                                   // nominal flower radius
const f = (n: number) => (Math.round(n * 100) / 100);     // keep the path data small

// n copies of a shape, evenly turned about the origin
const ring = (n: number, fn: (i: number) => string, start?: number) => {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += '<g transform="rotate(' + f((start || 0) + i * 360 / n) + ')">' + fn(i) + '</g>';
  }
  return out;
};

/* ---------------- petal outlines ----------------
   All drawn pointing up from the origin, so a rotate() places them. */

// narrow and pointed — daisies, chrysanthemums, sunflower rays
const lance = (len: number, wid: number) =>
  'M0,0 C' + f(wid) + ',' + f(-len * .25) + ' ' + f(wid * .7) + ',' + f(-len * .8) + ' 0,' + f(-len) +
  ' C' + f(-wid * .7) + ',' + f(-len * .8) + ' ' + f(-wid) + ',' + f(-len * .25) + ' 0,0 Z';

// broad with a rounded tip — camellia, rose, peony
const round = (len: number, wid: number) =>
  'M0,0 C' + f(wid) + ',' + f(-len * .2) + ' ' + f(wid * 1.05) + ',' + f(-len * .72) + ' 0,' + f(-len) +
  ' C' + f(-wid * 1.05) + ',' + f(-len * .72) + ' ' + f(-wid) + ',' + f(-len * .2) + ' 0,0 Z';

// rounded but with a notched, slightly wavy edge — peony, marigold
const ruffle = (len: number, wid: number) =>
  'M0,0 C' + f(wid) + ',' + f(-len * .22) + ' ' + f(wid * 1.1) + ',' + f(-len * .6) + ' ' + f(wid * .45) + ',' + f(-len * .88) +
  ' C' + f(wid * .3) + ',' + f(-len) + ' ' + f(-wid * .3) + ',' + f(-len) + ' ' + f(-wid * .45) + ',' + f(-len * .88) +
  ' C' + f(-wid * 1.1) + ',' + f(-len * .6) + ' ' + f(-wid) + ',' + f(-len * .22) + ' 0,0 Z';

// a sharp lobe — poinsettia bracts
const spear = (len: number, wid: number) =>
  'M0,0 C' + f(wid) + ',' + f(-len * .3) + ' ' + f(wid * .55) + ',' + f(-len * .62) + ' 0,' + f(-len) +
  ' C' + f(-wid * .55) + ',' + f(-len * .62) + ' ' + f(-wid) + ',' + f(-len * .3) + ' 0,0 Z';

// A petal with a hairline edge. Without it, neighbouring petals of the same
// fill merge into one disc and every bloom reads as concentric rings rather
// than as petals — which is what made four of the months look alike.
const P = (d: string, fill: string, p: FlowerPalette) =>
  '<path d="' + d + '" fill="' + fill + '" stroke="' + (p.edge || p.eyeDark) +
  '" stroke-width=".3" stroke-linejoin="round" stroke-opacity=".55"/>';

// a textured flower centre
const disc = (r: number, fill: string, dots?: string) => {
  let out = '<circle r="' + f(r) + '" fill="' + fill + '"/>';
  if (dots) {
    // a phyllotactic spiral, which is what a real seed head does
    const n = Math.round(r * 9);
    for (let i = 1; i <= n; i++) {
      const a = i * 2.39996, rr = r * .86 * Math.sqrt(i / n);
      out += '<circle cx="' + f(Math.cos(a) * rr) + '" cy="' + f(Math.sin(a) * rr) +
             '" r="' + f(r * .075) + '" fill="' + dots + '"/>';
    }
  }
  return out;
};

// a tuft of stamens
const stamens = (n: number, len: number, col: string) => {
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, d = len * (.55 + .45 * ((i * 7) % 5) / 5);
    const x = f(Math.cos(a) * d), y = f(Math.sin(a) * d);
    out += '<line x1="0" y1="0" x2="' + x + '" y2="' + y + '" stroke="' + col +
           '" stroke-width="' + f(len * .11) + '" stroke-linecap="round"/>' +
           '<circle cx="' + x + '" cy="' + y + '" r="' + f(len * .15) + '" fill="' + col + '"/>';
  }
  return out;
};

const leafPath = (len: number, wid: number) =>
  'M0,0 C' + f(wid) + ',' + f(-len * .3) + ' ' + f(wid * .5) + ',' + f(-len * .85) + ' 0,' + f(-len) +
  ' C' + f(-wid * .5) + ',' + f(-len * .85) + ' ' + f(-wid) + ',' + f(-len * .3) + ' 0,0 Z';

// a leaf with its midrib, placed at an angle
const leaf = (p: FlowerPalette, angle: number, scale: number) =>
  '<g transform="rotate(' + f(angle) + ') scale(' + f(scale) + ')">' +
    P(leafPath(R * 1.05, R * .36), p.leaf, p) +
    '<path d="M0,0 L0,' + f(-R * 1.0) + '" stroke="' + p.leafDark + '" stroke-width=".5" fill="none"/>' +
  '</g>';

/* ---------------- the twelve species ---------------- */
// Each returns markup centred on 0,0. p is the month's palette.

// Rose, in bud — five broad outer petals round a tight spiral heart. The
// spiral is the whole point: it is what stops a rose reading as "a flower
// with petals in rings", which is every other bloom here.
const rose = (p: FlowerPalette) =>
  '<g>' +
    ring(5, () => P(round(R, R * .86), p.p3, p), 0) +
    ring(5, () => P(round(R * .74, R * .68), p.p2, p), 36) +
    // the heart: three nested commas, each turned a third of the way round
    ring(3, i => {
      const s = 1 - i * .26;
      return '<path d="M0,0 C' + f(R * .52 * s) + ',' + f(-R * .1 * s) + ' ' +
        f(R * .5 * s) + ',' + f(-R * .52 * s) + ' 0,' + f(-R * .56 * s) +
        ' C' + f(-R * .34 * s) + ',' + f(-R * .56 * s) + ' ' + f(-R * .36 * s) + ',' + f(-R * .2 * s) +
        ' ' + f(-R * .1 * s) + ',0 Z" fill="' + (i ? p.p1 : p.p4) + '"/>';
    }, 20) +
    '<circle r="' + f(R * .07) + '" fill="' + p.p2 + '"/>' +
  '</g>';

// The same species a week later: blown open, flatter, more petals with wavy
// edges, and the stamens on show. Reads as a different flower at a glance.
const openRose = (p: FlowerPalette) =>
  '<g>' +
    ring(8, () => P(ruffle(R, R * .62), p.p3, p), 0) +
    ring(8, () => P(ruffle(R * .8, R * .56), p.p2, p), 22) +
    ring(6, () => P(ruffle(R * .52, R * .44), p.p1, p), 10) +
    stamens(16, R * .3, p.eye) +
    disc(R * .12, p.eyeDark) +
  '</g>';

// Tulip — a closed cup of three visible petals on a stem
const tulip = (p: FlowerPalette) =>
  '<g>' +
    '<path d="M0,' + f(R * .3) + ' L0,' + f(R * 1.5) + '" stroke="' + p.leafDark + '" stroke-width="' + f(R * .11) + '"/>' +
    leaf(p, 152, .9) + leaf(p, 208, .9) +
    '<path d="M' + f(-R * .62) + ',' + f(R * .35) + ' C' + f(-R * .8) + ',' + f(-R * .5) + ' ' + f(-R * .5) + ',' + f(-R * .95) + ' 0,' + f(-R * .95) +
      ' C' + f(R * .5) + ',' + f(-R * .95) + ' ' + f(R * .8) + ',' + f(-R * .5) + ' ' + f(R * .62) + ',' + f(R * .35) +
      ' C' + f(R * .3) + ',' + f(R * .62) + ' ' + f(-R * .3) + ',' + f(R * .62) + ' ' + f(-R * .62) + ',' + f(R * .35) + ' Z" fill="' + p.p2 + '"/>' +
    '<path d="M' + f(-R * .6) + ',' + f(R * .3) + ' C' + f(-R * .68) + ',' + f(-R * .45) + ' ' + f(-R * .42) + ',' + f(-R * .9) + ' ' + f(-R * .06) + ',' + f(-R * .92) +
      ' L' + f(-R * .06) + ',' + f(R * .5) + ' Z" fill="' + p.p1 + '"/>' +
    '<path d="M' + f(R * .2) + ',' + f(-R * .9) + ' C' + f(R * .62) + ',' + f(-R * .78) + ' ' + f(R * .74) + ',' + f(-R * .2) + ' ' + f(R * .6) + ',' + f(R * .3) +
      ' C' + f(R * .42) + ',' + f(-R * .2) + ' ' + f(R * .34) + ',' + f(-R * .6) + ' ' + f(R * .2) + ',' + f(-R * .9) + ' Z" fill="' + p.p3 + '"/>' +
  '</g>';

// Daisy — many narrow rays about a domed eye
const daisy = (p: FlowerPalette) =>
  '<g>' +
    ring(18, () => '<path d="' + lance(R, R * .2) + '" fill="' + p.p1 + '" stroke="' + p.p3 + '" stroke-width=".25"/>', 0) +
    ring(18, () => P(lance(R * .78, R * .16), p.p2, p), 10) +
    disc(R * .3, p.eye, p.eyeDark) +
  '</g>';

// Peony — a shaggy globe. A real one is never tidy, so the petal lengths
// are jittered: the ragged outline is what tells it apart from a rose.
const peony = (p: FlowerPalette) => {
  const jitter = (i: number) => 1 + ((i * 37) % 11 - 5) / 34;      // ±15%, repeatable
  return '<g>' +
    ring(11, i => P(ruffle(R * jitter(i), R * .5 * jitter(i)), p.p3, p), 0) +
    ring(11, i => P(ruffle(R * .84 * jitter(i + 3), R * .46), p.p2, p), 16) +
    ring(10, i => P(ruffle(R * .64 * jitter(i + 7), R * .4), p.p1, p), 8) +
    ring(9,  i => P(ruffle(R * .44 * jitter(i + 5), R * .32), p.p4, p), 22) +
    ring(7,  i => P(ruffle(R * .26 * jitter(i + 2), R * .22), p.p2, p), 12) +
  '</g>';
};

/* Lavender — three spikes rising from one base.
   A single spike of blobs does not read as lavender; a small bunch of
   tapering spikes does, because the fanned silhouette is the thing people
   recognise. Each spike is a quadratic curve, and the florets are placed by
   sampling along it so they follow the lean instead of stacking straight up. */
const lavender = (p: FlowerPalette) => {
  // one tubular floret, pointing up before it is rotated outward
  const floret = (x: number, y: number, s: number, rot: number, fill: string) =>
    '<g transform="translate(' + f(x) + ',' + f(y) + ') rotate(' + f(rot) + ') scale(' + f(s) + ')">' +
      '<path d="M0,0 C1.45,-.35 2.15,-1.5 1.85,-2.85 C1.05,-3.55 -.35,-3.25 -.95,-2.35' +
      ' C-1.4,-1.5 -1,-.5 0,0 Z" fill="' + fill + '" stroke="' + (p.edge || p.eyeDark) +
      '" stroke-width=".3" stroke-opacity=".5" stroke-linejoin="round"/>' +
    '</g>';

  // B(t) on a quadratic through base -> control -> tip
  const at = (b: number[], c: number[], e: number[], t: number) => {
    const u = 1 - t;
    return [u * u * b[0] + 2 * u * t * c[0] + t * t * e[0],
            u * u * b[1] + 2 * u * t * c[1] + t * t * e[1]];
  };

  const base = [0, R * .98];
  const spikes = [
    { c: [-R * .38, R * .10], e: [-R * .62, -R * .78], n: 7,  s: .66, lean: -24 },
    { c: [ R * .36, R * .06], e: [ R * .60, -R * .84], n: 7,  s: .66, lean:  24 },
    { c: [ R * .04, R * .10], e: [ 0,       -R * 1.12], n: 9, s: .78, lean:   0 },
  ];

  let out = '';
  for (const sp of spikes) {
    const [tx, ty] = sp.e;
    out += '<path d="M' + f(base[0]) + ',' + f(base[1]) +
           ' Q' + f(sp.c[0]) + ',' + f(sp.c[1]) + ' ' + f(tx) + ',' + f(ty) +
           '" fill="none" stroke="' + p.leafDark + '" stroke-width="' + f(R * .075) +
           '" stroke-linecap="round"/>';

    // florets over the top two-thirds, tapering towards the tip
    for (let i = 0; i < sp.n; i++) {
      const k = i / (sp.n - 1);
      const [x, y] = at(base, sp.c, sp.e, .34 + .66 * k);
      const size = R * sp.s * .105 * (1 - .42 * k);
      for (const dir of [-1, 1]) {
        out += floret(x + dir * size * .9, y, size, sp.lean + dir * 34, i % 2 ? p.p2 : p.p1);
      }
      out += floret(x, y - size * .5, size * .82, sp.lean, p.p3);
    }
  }

  // two narrow leaves at the foot, the way a cut bunch is tied
  return '<g>' + leaf(p, 163, .66) + leaf(p, 197, .62) + out + '</g>';
};

// Sunflower — two ranks of rays round a big seeded disc
const sunflower = (p: FlowerPalette) =>
  '<g>' +
    ring(16, () => P(lance(R * 1.08, R * .26), p.p2, p), 0) +
    ring(16, () => P(lance(R * .92, R * .23), p.p1, p), 11) +
    disc(R * .44, p.eye, p.eyeDark) +
  '</g>';

// Orchid — three sepals, two broad lateral petals, and a lip
const orchid = (p: FlowerPalette) =>
  '<g>' +
    '<g transform="rotate(0)"><path d="' + round(R * .95, R * .34) + '" fill="' + p.p3 + '"/></g>' +
    '<g transform="rotate(130)"><path d="' + round(R * .92, R * .32) + '" fill="' + p.p3 + '"/></g>' +
    '<g transform="rotate(230)"><path d="' + round(R * .92, R * .32) + '" fill="' + p.p3 + '"/></g>' +
    '<g transform="rotate(68)"><path d="' + round(R * .98, R * .66) + '" fill="' + p.p1 + '"/></g>' +
    '<g transform="rotate(292)"><path d="' + round(R * .98, R * .66) + '" fill="' + p.p1 + '"/></g>' +
    '<g transform="rotate(180)">' +
      P(ruffle(R * .72, R * .44), p.p4, p) +
      P(ruffle(R * .4, R * .26), p.eye, p) +
    '</g>' +
    '<ellipse rx="' + f(R * .17) + '" ry="' + f(R * .22) + '" fill="' + p.eye + '"/>' +
    '<circle cy="' + f(-R * .06) + '" r="' + f(R * .07) + '" fill="' + p.eyeDark + '"/>' +
  '</g>';

// Chrysanthemum — very many fine incurved petals
const chrysanth = (p: FlowerPalette) =>
  '<g>' +
    ring(26, () => P(lance(R, R * .13), p.p3, p), 0) +
    ring(24, () => P(lance(R * .84, R * .12), p.p2, p), 7) +
    ring(20, () => P(lance(R * .64, R * .12), p.p1, p), 4) +
    ring(14, () => P(lance(R * .42, R * .11), p.p4, p), 11) +
    disc(R * .14, p.eye) +
  '</g>';

// Marigold — a tight pompom of short ruffled petals
const marigold = (p: FlowerPalette) =>
  '<g>' +
    ring(13, () => P(ruffle(R, R * .4), p.p3, p), 0) +
    ring(13, () => P(ruffle(R * .84, R * .37), p.p2, p), 14) +
    ring(11, () => P(ruffle(R * .66, R * .34), p.p1, p), 7) +
    ring(10, () => P(ruffle(R * .46, R * .3), p.p4, p), 18) +
    ring(8,  () => P(ruffle(R * .28, R * .22), p.eye, p), 9) +
  '</g>';

// Camellia — flat and formal: one rank of six very broad petals that barely
// overlap, and a big boss of stamens sitting right on top of them. Nothing
// else here is this geometric, which is what makes it read as a camellia.
const camellia = (p: FlowerPalette) =>
  '<g>' +
    ring(6, () => P(round(R, R * 1.02), p.p3, p), 0) +
    ring(6, () => P(round(R * .66, R * .72), p.p2, p), 30) +
    '<circle r="' + f(R * .34) + '" fill="' + p.p1 + '"/>' +
    stamens(22, R * .42, p.eye) +
    disc(R * .15, p.eyeDark) +
  '</g>';

// Poinsettia — pointed bracts in two ranks round the small true flowers
const poinsettia = (p: FlowerPalette) =>
  '<g>' +
    ring(7, () => P(spear(R * 1.1, R * .42), p.p3, p), 0) +
    ring(7, () => P(spear(R * .88, R * .36), p.p2, p), 26) +
    ring(5, () => P(spear(R * .6, R * .28), p.p1, p), 12) +
    ring(5, (i: number) => '<circle cy="' + f(-R * .17) + '" r="' + f(R * .09) + '" fill="' +
          (i % 2 ? p.eye : p.eyeDark) + '"/>', 0) +
    '<circle r="' + f(R * .08) + '" fill="' + p.eye + '"/>' +
  '</g>';

const SPECIES: Record<string, { name: string; draw: (p: FlowerPalette) => string; fit?: number }> = {
  January:   { name: 'White Rose',     draw: rose },
  February:  { name: 'Pink Rose',      draw: openRose },
  March:     { name: 'Tulip',          draw: tulip },
  April:     { name: 'Daisy',          draw: daisy },
  May:       { name: 'Peony',          draw: peony },
  June:      { name: 'Lavender',       draw: lavender },
  July:      { name: 'Sunflower',      draw: sunflower },
  August:    { name: 'Orchid',         draw: orchid },
  September: { name: 'Chrysanthemum',  draw: chrysanth },
  October:   { name: 'Marigold',       draw: marigold },
  November:  { name: 'Camellia',       draw: camellia },
  December:  { name: 'Poinsettia',     draw: poinsettia },
};

const uri = (svg: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

/* ---------------- the bloom on its own ----------------
   Sized in millimetres and placed by the page, so it can sit beside the
   signature without the border having to know where the signature is. */
export function single(month: string, p: FlowerPalette, mm: number) {
  const sp = SPECIES[month] || SPECIES['November'];
  // The drawing runs to about 1.25R below the origin once the stem is on,
  // and a rotated bloom reaches further still, so the box is 3.2R with the
  // origin above centre. Too tight and the stem is simply cut off the image.
  const box = R * 3.2;
  const art =
    '<g transform="translate(' + f(box / 2) + ',' + f(box * .47) + ') rotate(14) scale(' + (sp.fit || 1) + ')">' +
      // a short stem and two leaves, so it reads as a cut flower rather than
      // a medallion floating next to the name
      '<path d="M0,' + f(R * .4) + ' Q' + f(R * .18) + ',' + f(R * .9) + ' ' + f(R * .1) + ',' + f(R * 1.25) +
        '" stroke="' + p.leafDark + '" stroke-width="' + f(R * .09) + '" fill="none" stroke-linecap="round"/>' +
      leaf(p, 196, .52) + leaf(p, 164, .46) +
      sp.draw(p) +
    '</g>';
  return uri(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + mm + 'mm" height="' + mm + 'mm" ' +
    'viewBox="0 0 ' + f(box) + ' ' + f(box) + '">' + art + '</svg>'
  );
}

/* ---------------- the page border ----------------
   Nothing in the corners: the sheet carries enough already, and the margins
   they needed are better spent on the receipt itself. What is left is the
   staff line in the bottom margin, which says where this came from. */
export function border(p: FlowerPalette, w: number, h: number) {
  let out = '';

  // four hairlines and a quaver, set small in the lower margin
  const ly = h - 4.2, lx = w / 2 - 11;
  for (let i = 0; i < 4; i++) {
    out += '<line x1="' + f(lx) + '" y1="' + f(ly + i * .85) + '" x2="' + f(lx + 22) + '" y2="' + f(ly + i * .85) +
           '" stroke="' + p.accent + '" stroke-width=".18" opacity=".55"/>';
  }
  out += '<g transform="translate(' + f(lx + 9.5) + ',' + f(ly + 1.3) + ') scale(.38)" fill="' + p.accent + '" opacity=".75">' +
           '<ellipse cx="0" cy="3.1" rx="2.3" ry="1.7" transform="rotate(-20)"/>' +
           '<path d="M2.1,2.8 L2.1,-5.2 C4.6,-4.2 5.4,-2.2 4.6,-.2 C5.8,-2.6 4.6,-5 2.1,-6.2 Z"/>' +
         '</g>';

  return uri(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + 'mm" height="' + h + 'mm" ' +
    'viewBox="0 0 ' + w + ' ' + h + '">' + out + '</svg>'
  );
}

/* ---------------- the PAID seal ----------------
   A real rubber stamp never prints as a clean circle: the rim is ragged and
   the ink misses in patches. Both come from one filter — turbulence pushes
   the edges about, then a second noise field is punched out of the ink so
   the coverage breaks up. The lettering stays in HTML on top, because an SVG
   in an <img> is its own document and cannot reach the page's fonts. */
export function seal(colour: string) {
  const art =
    '<defs><filter id="ink" x="-25%" y="-25%" width="150%" height="150%">' +
      '<feTurbulence type="fractalNoise" baseFrequency=".55" numOctaves="4" seed="9" result="n"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="n" scale="2.6"' +
        ' xChannelSelector="R" yChannelSelector="G" result="rough"/>' +
      '<feTurbulence type="fractalNoise" baseFrequency=".085" numOctaves="5" seed="4" result="p"/>' +
      '<feColorMatrix in="p" type="luminanceToAlpha" result="pa"/>' +
      '<feComponentTransfer in="pa" result="holes">' +
        '<feFuncA type="linear" slope="2.1" intercept="-.86"/>' +
      '</feComponentTransfer>' +
      '<feComposite in="rough" in2="holes" operator="out"/>' +
    '</filter></defs>' +
    '<g filter="url(#ink)" fill="none" stroke="' + colour + '" stroke-linecap="round">' +
      '<circle cx="50" cy="50" r="46" stroke-width="5"/>' +
      '<circle cx="50" cy="50" r="38.6" stroke-width="1.9"/>' +
    '</g>';
  return uri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">' +
    art + '</svg>'
  );
}

export const speciesFor = (m: string) => (SPECIES[m] || SPECIES['November']).name;
