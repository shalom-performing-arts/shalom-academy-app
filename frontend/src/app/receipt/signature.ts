/*
  A scanned signature arrives as thin black ink on a big transparent sheet. Before it is legible
  on the receipt it is:
    1. cropped to the ink, or most of the box is empty margin and the strokes get scaled down
       several times further than they need to be;
    2. strengthened at its part-transparent edge pixels, because thin antialiased strokes wash
       out to nothing once shrunk to ~25 mm.
*/

const cache = new Map<string, string>();

export function prepareSignature(src: string): Promise<string> {
  const key = src.slice(0, 64) + '|' + src.length;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);

  return new Promise(done => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { done(src); return; }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const cx = c.getContext('2d', { willReadFrequently: true })!;
        cx.drawImage(img, 0, 0);
        const px = cx.getImageData(0, 0, w, h).data;

        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (px[(y * w + x) * 4 + 3] > 12) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX < 0) { done(src); return; }          // nothing but transparency

        const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.02);
        const x0 = Math.max(0, minX - pad), y0 = Math.max(0, minY - pad);
        const cw = Math.min(w, maxX + pad) - x0 + 1;
        const ch = Math.min(h, maxY + pad) - y0 + 1;

        const out = document.createElement('canvas');
        out.width = cw; out.height = ch;
        const ox = out.getContext('2d', { willReadFrequently: true })!;
        ox.drawImage(c, x0, y0, cw, ch, 0, 0, cw, ch);

        const od = ox.getImageData(0, 0, cw, ch);
        const op = od.data;
        for (let i = 3; i < op.length; i += 4) {
          if (op[i]) op[i] = Math.min(255, Math.round(255 * Math.pow(op[i] / 255, 0.5)));
        }
        ox.putImageData(od, 0, 0);

        const data = out.toDataURL('image/png');
        cache.set(key, data);
        done(data);
      } catch (e) {
        console.error('signature', e);
        done(src);
      }
    };
    img.onerror = () => done('');
    img.src = src;
  });
}

/** Shrinks an uploaded logo or signature to at most 520 px, as a PNG data URI. */
export function readImageFile(file: File): Promise<string> {
  return new Promise((ok, fail) => {
    const reader = new FileReader();
    reader.onerror = fail;
    reader.onload = () => {
      const img = new Image();
      img.onerror = fail;
      img.onload = () => {
        const max = 520;
        const ratio = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * ratio);
        c.height = Math.round(img.height * ratio);
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        ok(c.toDataURL('image/png'));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
