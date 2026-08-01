#!/usr/bin/env node
/**
 * Bakes docs/assets/diagrams/*.html into docs/assets/*.png with headless Chrome.
 *
 * The HTML is the authoring format; the PNG is the deliverable the READMEs embed.
 * Each source declares its own canvas via <meta name="canvas" content="880x620">,
 * so size lives with the layout instead of in a table here.
 *
 *   node scripts/render-diagrams.mjs            # all
 *   node scripts/render-diagrams.mjs architecture build-loop
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'docs/assets/diagrams');
const OUT_DIR = join(ROOT, 'docs/assets');
const SCALE = 2;
const MAX_BYTES = 300 * 1024;

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

function findChrome() {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv) return fromEnv;
  for (const p of CHROME_CANDIDATES) {
    try { statSync(p); return p; } catch { /* keep looking */ }
  }
  throw new Error(
    'No Chrome found. Install Google Chrome or set CHROME_PATH to a Chromium binary.'
  );
}

/** sharp already ships with @ant/cli — borrow it rather than adding a root dep. */
function loadSharp() {
  try {
    return createRequire(join(ROOT, 'packages/ant-cli/package.json'))('sharp');
  } catch {
    return null;
  }
}

function readCanvas(html, name) {
  const meta = html.match(/<meta\s+name=["']canvas["']\s+content=["'](\d+)x(\d+)["']/i);
  if (!meta) throw new Error(`${name}.html is missing <meta name="canvas" content="WxH">`);
  return { width: Number(meta[1]), height: Number(meta[2]) };
}

const chrome = findChrome();
const sharp = loadSharp();

const requested = process.argv.slice(2).map((a) => a.replace(/\.html$/, ''));
const sources = readdirSync(SRC_DIR)
  .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
  .map((f) => f.replace(/\.html$/, ''))
  .filter((n) => requested.length === 0 || requested.includes(n))
  .sort();

if (sources.length === 0) {
  console.error(`No matching diagrams in ${SRC_DIR}`);
  process.exit(1);
}

let failed = false;
let total = 0;

for (const name of sources) {
  const srcPath = join(SRC_DIR, `${name}.html`);
  const outPath = join(OUT_DIR, `${name}.png`);
  const { width, height } = readCanvas(readFileSync(srcPath, 'utf8'), name);

  execFileSync(chrome, [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    `--force-device-scale-factor=${SCALE}`,
    `--window-size=${width},${height}`,
    // gives webfonts time to land before the frame is captured
    '--virtual-time-budget=12000',
    '--run-all-compositor-stages-before-draw',
    '--default-background-color=00000000',
    `--screenshot=${outPath}`,
    srcPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let bytes = statSync(outPath).size;

  // Chrome's PNG encoder is fast, not small. Recompress losslessly, and only
  // quantise if the file is still over budget — gradients band under a palette.
  if (sharp) {
    const lossless = await sharp(outPath).png({ compressionLevel: 9, effort: 10 }).toBuffer();
    if (lossless.length < bytes) { writeFileSync(outPath, lossless); bytes = lossless.length; }
    if (bytes > MAX_BYTES) {
      const quantised = await sharp(outPath)
        .png({ palette: true, colors: 192, dither: 1, compressionLevel: 9, effort: 10 })
        .toBuffer();
      if (quantised.length < bytes) { writeFileSync(outPath, quantised); bytes = quantised.length; }
    }
  }

  total += bytes;
  const kb = (bytes / 1024).toFixed(0);
  const over = bytes > MAX_BYTES;
  if (over) failed = true;
  console.log(
    `${over ? '✗' : '✓'} ${name}.png  ${width * SCALE}×${height * SCALE}  ${kb} KB${over ? '  (over 300 KB budget)' : ''}`
  );
}

console.log(`\n${sources.length} diagram(s), ${(total / 1024).toFixed(0)} KB total`);
if (!sharp) console.log('note: sharp not resolvable — PNGs are unoptimised.');
process.exit(failed ? 1 : 0);
