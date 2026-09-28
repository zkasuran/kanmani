#!/usr/bin/env node
/*
 * Renders the film headlessly, frame-exact, in parallel.
 *
 *   node pitch/render.mjs sheet 1 4.5 9 ...   contact sheet of those moments -> out/<film>/sheet.jpg
 *   node pitch/render.mjs stills 4.5 30 ...   full-size PNGs                  -> out/still-<t>.png
 *   node pitch/render.mjs cues                the sound cue list              -> out/cues.json
 *   node pitch/render.mjs video [workers]     every frame, H.264              -> out/video.mp4
 *   node pitch/render.mjs mux                 video + soundtrack.wav          -> out/kanmani-pitch.mp4
 *
 * FILM=graffiti|eye|plumbing|run-it picks the film (default graffiti): pitch/<film>/index.html renders
 * into pitch/out/<film>/.
 *
 * Every frame is a pure function of its timestamp, so workers render disjoint ranges and the
 * chunks are concatenated without re-encoding.
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pw = process.env.PLAYWRIGHT_MODULE || `${execSync('npm root -g').toString().trim()}/@playwright/mcp/node_modules/playwright`;
const { chromium } = require(pw);
const DIR = path.dirname(new URL(import.meta.url).pathname);
const FILM = process.env.FILM || 'graffiti';
const OUT = process.env.OUT || path.join(DIR, 'out', FILM);
const FF = process.env.FFMPEG || execSync(`python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"`).toString().trim();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png' };

await mkdir(OUT, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const p = path.join(DIR, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(DIR)) throw new Error('outside');
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); res.end(await readFile(p));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/${FILM}/index.html`;

async function openFilm() {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()));
  await page.goto(URL_);
  await page.evaluate(() => window.film.ready);
  return { browser, page };
}
const run = (args) => new Promise((ok, bad) => { const p = spawn(FF, args, { stdio: ['ignore', 'ignore', 'inherit'] }); p.on('exit', (c) => (c === 0 ? ok() : bad(new Error('ffmpeg ' + c)))); });

const [mode, ...rest] = process.argv.slice(2);
const FPS = 30;
let FRAMES = 120 * FPS;

if (mode === 'cues') {
  const { browser, page } = await openFilm();
  const cues = await page.evaluate(() => window.film.cues());
  await writeFile(path.join(OUT, 'cues.json'), JSON.stringify(cues, null, 1));
  console.log(`${cues.cues.length} cues`); await browser.close();
} else if (mode === 'stills') {
  const { browser, page } = await openFilm();
  for (const t of rest.map(Number)) {
    const url = await page.evaluate((t) => window.film.frame(t), t);
    await writeFile(path.join(OUT, `still-${t}.png`), Buffer.from(url.split(',')[1], 'base64')); console.log('still', t);
  }
  await browser.close();
} else if (mode === 'sheet') {
  const { browser, page } = await openFilm();
  const url = await page.evaluate((times) => {
    const cols = 3, tw = 640, th = 360, rows = Math.ceil(times.length / cols);
    const s = document.createElement('canvas'); s.width = cols * tw; s.height = rows * th; const g = s.getContext('2d');
    times.forEach((t, i) => {
      window.film.renderFrame(t); const x = (i % cols) * tw, y = Math.floor(i / cols) * th;
      g.drawImage(document.getElementById('c'), x, y, tw, th);
      g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(x, y, 86, 30); g.fillStyle = '#fff'; g.font = '700 18px monospace'; g.fillText(t.toFixed(2) + 's', x + 8, y + 21);
    });
    return s.toDataURL('image/jpeg', 0.85);
  }, rest.map(Number));
  const name = process.env.SHEET || 'sheet';
  await writeFile(path.join(OUT, `${name}.jpg`), Buffer.from(url.split(',')[1], 'base64')); console.log('sheet', name); await browser.close();
} else if (mode === 'video') {
  { const { browser, page } = await openFilm(); FRAMES = Math.round((await page.evaluate(() => window.film.DURATION)) * FPS); await browser.close(); }
  const workers = Number(rest[0] || 6), per = Math.ceil(FRAMES / workers), t0 = Date.now();
  const chunk = async (k) => {
    const from = k * per, to = Math.min(FRAMES, from + per); if (from >= to) return null;
    const file = path.join(OUT, `chunk-${k}.mp4`), mark = file + '.done';
    if (await readFile(mark).then(() => true, () => false)) { console.log(`worker ${k}: already rendered`); return file; }
    const ff = spawn(FF, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-tune', 'grain', '-pix_fmt', 'yuv420p', '-g', '60', '-r', String(FPS), file], { stdio: ['pipe', 'ignore', 'inherit'] });
    const done = new Promise((ok, bad) => ff.on('exit', (c) => (c === 0 ? ok() : bad(new Error('ffmpeg chunk ' + k)))));
    const { browser, page } = await openFilm();
    for (let f = from; f < to; f++) {
      const url = await page.evaluate((t) => window.film.frame(t, 'image/jpeg', 0.95), f / FPS);
      if (!ff.stdin.write(Buffer.from(url.split(',')[1], 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
      if ((f - from) % 150 === 0) console.log(`worker ${k}: frame ${f - from}/${to - from}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    ff.stdin.end(); await done; await browser.close(); await writeFile(mark, 'ok'); return file;
  };
  const files = (await Promise.all([...Array(workers).keys()].map(chunk))).filter(Boolean);
  await writeFile(path.join(OUT, 'chunks.txt'), files.map((f) => `file '${f}'`).join('\n'));
  await run(['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(OUT, 'chunks.txt'), '-c', 'copy', path.join(OUT, 'video.mp4')]);
  console.log(`video.mp4 in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
} else if (mode === 'mux') {
  await run(['-y', '-loglevel', 'error', '-i', path.join(OUT, 'video.mp4'), '-i', path.join(OUT, 'soundtrack.wav'),
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', path.join(OUT, 'kanmani-pitch.mp4')]);
  console.log('kanmani-pitch.mp4');
} else {
  console.error('mode: sheet | stills | cues | video | mux');
}
server.close();
