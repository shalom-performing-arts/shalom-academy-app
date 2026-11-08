/*
  PDF and JPG export of the A5 sheet.

  A5 (148 × 210 mm) is the one output size. 3.125× turns the 559 × 794 css-pixel sheet into
  1748 × 2480 px, exactly 148 × 210 mm at 300 dpi.

  html2canvas and jsPDF are loaded on first use, so they stay out of the start-up bundle.
*/

export const PAGE = { label: 'A5', w: 148, h: 210, scale: 3.125, dpi: 300 };
const PDF_MAX_BYTES = 1_600_000;   // above this, fall back to JPEG to keep WhatsApp sends light

// rAF never fires while the tab is in the background, which would hang the export, so race it
// against a timer and carry on either way.
const nextFrame = () => Promise.race([
  new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
  new Promise(r => setTimeout(r, 150)),
]);

/** Rasterise the sheet at its true size, whatever the preview is scaled to. */
export async function sheetCanvas(paper: HTMLElement, restoreScale: () => void): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import('html2canvas');
  const prev = paper.style.transform;
  try {
    paper.style.transform = 'none';
    await nextFrame();
    // Webfonts and images must both be ready, or the capture gets the fallback face or a blank
    // logo. Cap the font wait so a blocked CDN cannot stall the download.
    await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 3000))]);
    await Promise.all(Array.from(paper.querySelectorAll('img')).map(img => img.complete ? null :
      new Promise(done => { img.onload = img.onerror = done; })));
    const canvas = await html2canvas(paper, {
      scale: PAGE.scale,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      width: paper.offsetWidth,
      height: paper.offsetHeight,
      windowWidth: paper.offsetWidth,
    });
    return exactCanvas(canvas);
  } finally {
    paper.style.transform = prev;
    restoreScale();
  }
}

/**
 * html2canvas rounds to whole pixels off the measured size, landing a pixel or two either side
 * of the target. Redraw onto the exact pixel count so the file reports precisely 148 × 210 mm.
 */
function exactCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const W = Math.round(PAGE.w / 25.4 * PAGE.dpi);
  const H = Math.round(PAGE.h / 25.4 * PAGE.dpi);
  if (src.width === W && src.height === H) return src;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const cx = out.getContext('2d')!;
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(src, 0, 0, W, H);
  return out;
}

export interface PdfMeta { title: string; subject: string; author: string }

export async function savePdf(canvas: HTMLCanvasElement, fileName: string, meta: PdfMeta) {
  download(await pdfBlob(canvas, meta), fileName);
}

/** The A5 PDF as a file, for sharing straight to WhatsApp. */
export async function pdfBlob(canvas: HTMLCanvasElement, meta: PdfMeta): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  // Prefer lossless PNG: a mostly-white sheet compresses well and the lettering stays crisp.
  let data = canvas.toDataURL('image/png');
  let fmt = 'PNG';
  if (data.length * 0.75 > PDF_MAX_BYTES) {
    data = canvas.toDataURL('image/jpeg', 0.93);
    fmt = 'JPEG';
  }
  const pdf = new jsPDF({ unit: 'mm', format: 'a5', orientation: 'portrait', compress: true });
  pdf.addImage(data, fmt, 0, 0, PAGE.w, PAGE.h, undefined, 'FAST');
  pdf.setProperties(meta);
  return pdf.output('blob');
}

/** PNG of the sheet: what gets pasted into a WhatsApp Web chat. */
export async function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>(done => canvas.toBlob(done, 'image/png'));
  if (!blob) throw new Error('Could not encode the image.');
  return blob;
}

/** JPEG with the true 300 dpi stamped in. */
export async function jpgBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>(done => canvas.toBlob(done, 'image/jpeg', 0.94));
  if (!blob) throw new Error('Could not encode the image.');
  return stampJpegDpi(blob, PAGE.dpi);
}

export async function saveJpg(canvas: HTMLCanvasElement, fileName: string) {
  download(await jpgBlob(canvas), fileName);
}

/**
 * A canvas JPEG carries no resolution, so viewers, Word and print shops assume 72 dpi and size
 * the receipt at ~592 × 840 mm. Write the real density into the JFIF header.
 */
async function stampJpegDpi(blob: Blob, dpi: number): Promise<Blob> {
  try {
    const b = new Uint8Array(await blob.arrayBuffer());
    const isJfif = b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF && b[3] === 0xE0 &&
                   b[6] === 0x4A && b[7] === 0x46 && b[8] === 0x49 && b[9] === 0x46;
    if (!isJfif) return blob;
    b[13] = 1;                                          // units: dots per inch
    b[14] = (dpi >> 8) & 0xFF; b[15] = dpi & 0xFF;      // X density
    b[16] = (dpi >> 8) & 0xFF; b[17] = dpi & 0xFF;      // Y density
    return new Blob([b], { type: 'image/jpeg' });
  } catch {
    return blob;                                        // never block the download
  }
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
