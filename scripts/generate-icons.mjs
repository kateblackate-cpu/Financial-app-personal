/*
 * Generates the PWA / apple-touch icons from scratch — no image deps.
 * The mark is the "K+" wordmark drawn with anti-aliased strokes, in the
 * app's own palette. Run with `npm run icons`.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const BG = [0x7c, 0x8f, 0x94]; // accent #7C8F94
const FG = [0xe5, 0xe5, 0xe5]; // background grey #E5E5E5

/* ---------- minimal PNG encoder (RGBA, 8-bit, no interlace) ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- drawing ---------- */
// Distance from point p to segment ab, used for anti-aliased round-cap strokes.
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Strokes in a normalised 0..1 square: the "K", then the "+".
function strokes(scale) {
  const s = (v) => v * scale;
  const w = 0.058 * scale; // K stroke half-width comes from this
  const pw = 0.052 * scale;
  return [
    // K: stem, upper arm, lower leg
    { a: [s(0.27), s(0.29)], b: [s(0.27), s(0.71)], w },
    { a: [s(0.27), s(0.5)], b: [s(0.48), s(0.29)], w },
    { a: [s(0.27), s(0.5)], b: [s(0.48), s(0.71)], w },
    // +: horizontal and vertical
    { a: [s(0.59), s(0.5)], b: [s(0.77), s(0.5)], w: pw },
    { a: [s(0.68), s(0.41)], b: [s(0.68), s(0.59)], w: pw },
  ];
}

function render(size, { bleed = true } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  // A maskable icon needs its mark inside the safe zone, so shrink it a little.
  const marks = strokes(size);
  const inset = bleed ? 0 : 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let cover = 0;
      for (const m of marks) {
        const d = distToSegment(px, py, m.a[0], m.a[1], m.b[0], m.b[1]);
        // smooth 1px edge -> anti-aliasing
        const c = Math.max(0, Math.min(1, m.w / 2 - d + 0.5));
        cover = Math.max(cover, c);
      }
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(BG[0] + (FG[0] - BG[0]) * cover);
      rgba[i + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * cover);
      rgba[i + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * cover);
      rgba[i + 3] = 255;
    }
  }
  return encodePNG(size, rgba);
}

// Maskable icons are cropped to a circle by some launchers: scale the mark to
// ~62% and centre it so nothing important falls outside the safe zone.
function renderMaskable(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const inner = size * 0.68;
  const off = (size - inner) / 2;
  const marks = strokes(inner);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - off;
      const py = y + 0.5 - off;
      let cover = 0;
      for (const m of marks) {
        const d = distToSegment(px, py, m.a[0], m.a[1], m.b[0], m.b[1]);
        cover = Math.max(cover, Math.max(0, Math.min(1, m.w / 2 - d + 0.5)));
      }
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(BG[0] + (FG[0] - BG[0]) * cover);
      rgba[i + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * cover);
      rgba[i + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * cover);
      rgba[i + 3] = 255;
    }
  }
  return encodePNG(size, rgba);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "icon-192.png"), render(192));
writeFileSync(join(OUT, "icon-512.png"), render(512));
writeFileSync(join(OUT, "apple-touch-icon.png"), render(180));
writeFileSync(join(OUT, "maskable-512.png"), renderMaskable(512));
console.log("icons written to public/icons/");
