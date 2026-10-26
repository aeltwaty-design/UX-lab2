// The side-by-side picture for a preference test: every option in one image, labelled A, B, C…
// Slack stacks image blocks one under the other, so one combined picture is the only way to show the options next
// to each other. The dashboard builds it on save with a canvas and stores it next to the option images.

export interface CompareOption {
  image_url: string;
  label_en: string;
  label_ar: string;
}

export const LETTERS = ["A", "B", "C", "D", "E", "F"];

/** Columns for n options: up to three in one row, four as a square, five or six in two rows of three. */
export function compareColumns(n: number): number {
  return n <= 3 ? n : n === 4 ? 2 : 3;
}

// Slack accepts images up to 3000 × 2000; the picture stays under that with room to spare.
const MAX_W = 2400;
const MAX_H = 1800;
const PAD = 40;
const GAP = 40;
/** The label band above each tile. */
const BAND = 72;

async function loadImage(url: string): Promise<ImageBitmap> {
  // A fresh request: a copy the browser cached for an <img> tag may lack the CORS headers a canvas needs.
  const res = await fetch(url, { mode: "cors", cache: "reload" });
  if (!res.ok) throw new Error(`image request failed (${res.status})`);
  return createImageBitmap(await res.blob());
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/** Draws the options in a grid, each under a band with its letter and label, and returns the picture as a JPEG. */
export async function composeComparison(options: CompareOption[]): Promise<Blob> {
  const opts = options.slice(0, LETTERS.length);
  if (opts.length < 2) throw new Error("two images at least");
  const font = `600 ${Math.round(BAND * 0.42)}px Poppins, "IBM Plex Sans Arabic", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  await document.fonts.load(font).catch(() => []);
  const images = await Promise.all(opts.map((o) => loadImage(o.image_url)));
  try {
    const cols = compareColumns(opts.length);
    const rows = Math.ceil(opts.length / cols);
    // The widest shape sets the tile; narrower images sit centred in it.
    const aspect = Math.max(...images.map((im) => im.width / im.height));
    const natural = Math.max(...images.map((im) => im.height));
    const tileH = Math.floor(
      Math.min(Math.max(natural, 600), (MAX_W - 2 * PAD - (cols - 1) * GAP) / (cols * aspect), (MAX_H - 2 * PAD - (rows - 1) * GAP) / rows - BAND),
    );
    const tileW = Math.round(tileH * aspect);
    const width = 2 * PAD + cols * tileW + (cols - 1) * GAP;
    const height = 2 * PAD + rows * (BAND + tileH) + (rows - 1) * GAP;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.font = font;
    ctx.textBaseline = "middle";

    opts.forEach((o, i) => {
      const im = images[i]!;
      const x = PAD + (i % cols) * (tileW + GAP);
      const y = PAD + Math.floor(i / cols) * (BAND + tileH + GAP);
      // The band: a brand-green badge with the letter, then the label.
      const r = BAND * 0.36;
      ctx.fillStyle = "#00ce8b";
      ctx.beginPath();
      ctx.arc(x + r, y + BAND / 2, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#06352a";
      ctx.textAlign = "center";
      ctx.fillText(LETTERS[i]!, x + r, y + BAND / 2 + 1);
      const label = [o.label_en.trim(), o.label_ar.trim()].filter(Boolean).join(" · ");
      if (label) {
        ctx.fillStyle = "#111317";
        ctx.textAlign = "left";
        ctx.fillText(fitText(ctx, label, tileW - 2 * r - 16), x + 2 * r + 16, y + BAND / 2 + 1);
      }
      // The tile: a light box with the image fitted inside.
      const ty = y + BAND;
      ctx.fillStyle = "#f8f9fc";
      ctx.fillRect(x, ty, tileW, tileH);
      ctx.strokeStyle = "#e2e6ee";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, ty + 1, tileW - 2, tileH - 2);
      const s = Math.min(tileW / im.width, tileH / im.height);
      const w = Math.round(im.width * s);
      const h = Math.round(im.height * s);
      ctx.drawImage(im, x + Math.round((tileW - w) / 2), ty + Math.round((tileH - h) / 2), w, h);
    });

    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode the picture"))), "image/jpeg", 0.9),
    );
  } finally {
    for (const im of images) im.close();
  }
}
