/**
 * Renders the PWA icons from `public/icons/icon.svg` (run `pnpm --filter @tt/web icons` after
 * editing the mark, then commit the PNGs). Deterministic: same sharp version, same bytes.
 *   icon-192 / icon-512   purpose "any": the rounded mark on a transparent background;
 *   maskable-512          full-bleed brand colour, the mark scaled to 85 % (glyph inside the 80 % safe zone);
 *   apple-touch-icon      180 px, full bleed (iOS rounds the corners itself, transparency turns black).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const dir = fileURLToPath(new URL('../public/icons/', import.meta.url));
const svg = await readFile(`${dir}icon.svg`);
const fill = /<rect[^>]*fill="(#[0-9a-fA-F]{6})"/.exec(svg.toString('utf8'))?.[1];
if (!fill) throw new Error('icon.svg: no <rect fill="#rrggbb"> background found');

const render = (size) =>
  sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

async function fullBleed(size) {
  const inner = Math.round(size * 0.85);
  return sharp({ create: { width: size, height: size, channels: 4, background: fill } })
    .composite([{ input: await render(inner), gravity: 'center' }])
    .png({ compressionLevel: 9 });
}

await sharp(await render(192)).toFile(`${dir}icon-192.png`);
await sharp(await render(512)).toFile(`${dir}icon-512.png`);
await (await fullBleed(512)).toFile(`${dir}maskable-512.png`);
await (await fullBleed(180)).toFile(`${dir}apple-touch-icon.png`);
console.log('icons written to', dir);
