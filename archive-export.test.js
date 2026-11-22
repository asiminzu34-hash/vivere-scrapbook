import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { archiveFolderName, createArchiveZip, crc32, formatArchiveMetadata } from './archive-export.js';

const utf8 = new TextEncoder();

test('archive folders use a validated date and a bounded, path-safe Unicode title', () => {
  assert.equal(archiveFolderName({ date: '21 NOVEMBER 2026', title: ' ../ Été: 海 / CON. ' }), '2026-11-21_Été-海-CON');
  assert.equal(archiveFolderName({ date: '2024-02-29T01:00:00Z', title: ' 💥 ' }), '2024-02-29_memory');
  assert.equal(archiveFolderName({ date: '2026-02-29', title: 'x'.repeat(200) }), `undated_${'x'.repeat(56)}`);
  assert.equal(archiveFolderName({ date: new Date(2020, 0, 2) }), '2020-01-02_memory');
  assert.equal(archiveFolderName({ date: '23 Fakeuary 2024' }), 'undated_memory');
});

test('metadata keeps the supplied text, not filesystem-safe text or generated copy', () => {
  assert.equal(formatArchiveMetadata({ date: '21 NOVEMBER 2026', title: 'Été: 海', story: '  First\nSecond 🌊', song: 'Artist — Song' }),
    'Title: Été: 海\nDate: 21 NOVEMBER 2026\nSong: Artist — Song\n\nStory:\n  First\nSecond 🌊\n');
});

test('ZIP directory, local headers, CRCs, and UTF-8 entry paths agree', async () => {
  assert.equal(crc32(utf8.encode('123456789')), 0xcbf43926);
  const paths = ['2026-11-21-été/memory.txt', '2026-11-21-été/reel.webm'];
  const payloads = [utf8.encode('Café'), Uint8Array.of(0, 1, 2, 255)];
  const zip = await createArchiveZip(paths.map((name, index) => ({ name, blob: new Blob([payloads[index]]) })));
  assert.equal(zip.type, 'application/zip');
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  const u16 = index => view.getUint16(index, true);
  const u32 = index => view.getUint32(index, true);
  const decode = (start, length) => new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start, start + length));
  assert.equal(u32(end), 0x06054b50);
  assert.equal(u16(end + 10), paths.length);
  let central = u32(end + 16);
  assert.equal(central + u32(end + 12), end);
  for (const [index, path] of paths.entries()) {
    assert.equal(u32(central), 0x02014b50);
    assert.equal(u16(central + 8), 0x0800);
    assert.equal(u16(central + 10), 0);
    const length = u16(central + 28);
    assert.equal(decode(central + 46, length), path);
    const local = u32(central + 42);
    assert.equal(u32(local), 0x04034b50);
    assert.equal(u16(local + 6), 0x0800);
    assert.equal(u16(local + 26), length);
    assert.equal(decode(local + 30, length), path);
    assert.equal(u32(local + 14), crc32(payloads[index]));
    assert.equal(u32(central + 16), u32(local + 14));
    assert.equal(u32(central + 24), payloads[index].length);
    assert.deepEqual(bytes.subarray(local + 30 + length, local + 30 + length + u32(local + 22)), payloads[index]);
    central += 46 + length;
  }
  const blob = new Blob(['x']);
  await assert.rejects(createArchiveZip([{ name: '../bad', blob }]), /invalid/i);
  await assert.rejects(createArchiveZip([{ name: 'a', blob }, { name: 'a', blob }]), /duplicate/i);
});

// Run with CHROME_BIN set to a Chromium/Chrome executable. No browser automation dependency.
const chromeBin = process.env.CHROME_BIN;
test('Chromium captures the live scrapbook, saves a folder, and falls back to ZIP/SVG', {
  skip: !chromeBin, timeout: 45000
}, async t => {
  const profile = await mkdtemp(join(tmpdir(), 'vivere-archive-'));
  let report;
  const result = new Promise(resolve => { report = resolve; });
  const server = createServer(async (req, res) => {
    if (req.url === '/report' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      res.end();
      report(JSON.parse(body));
      return;
    }
    if (req.url === '/probe.svg') {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#1200fe"/></svg>');
      return;
    }
    const name = req.url === '/' ? 'index.html' : req.url.slice(1);
    if (!/^[\w-]+\.(html|js|css)$/.test(name)) return res.writeHead(404).end();
    try {
      let source = await readFile(new URL(`./${name}`, import.meta.url), 'utf8');
      res.setHeader('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
      res.setHeader('Content-Type', { html: 'text/html', js: 'text/javascript', css: 'text/css' }[name.split('.').pop()]);
      if (req.url === '/') source = source.replace('</body>', `<script type="module">(${browserCheck.toString()})()</script></body>`);
      res.end(source);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const browser = spawn(chromeBin, ['--headless', '--no-sandbox', '--disable-gpu', '--no-first-run', '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}/`], { stdio: 'ignore' });
  const browserExit = new Promise(resolve => browser.once('close', resolve));
  const failure = new Promise((_, reject) => {
    browser.once('error', reject);
    browser.once('exit', code => reject(new Error(`Chrome exited before the page reported (code ${code})`)));
  });
  t.after(async () => {
    browser.kill();
    await browserExit;
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {});
  });
  const message = await Promise.race([result, failure]);
  assert.equal(message.error, undefined, message.error);
});

async function browserCheck() {
  const check = (value, message) => { if (!value) throw new Error(message); };
  try {
    const { exportMemoryArchive } = await import('/archive-export.js');
    const spread = document.getElementById('bookSpread');
    const board = document.getElementById('collageBoard');
    const layer = document.getElementById('collageItemsLayer');
    const sceneReady = new Promise(resolve => {
      const observer = new MutationObserver(() => { observer.disconnect(); resolve(); });
      observer.observe(layer, { childList: true });
    });
    window.openScrapbookModal(savedMemories[0]);
    await sceneReady;
    const probeStyle = document.createElement('style');
    probeStyle.textContent = '#archive-probe::after{content:"";display:block;position:absolute;left:24px;top:0;width:18px;height:18px;background:#0bed10}';
    document.head.appendChild(probeStyle);
    const probe = document.createElement('div');
    probe.id = 'archive-probe';
    probe.className = 'book-draggable';
    probe.style.cssText = 'position:absolute;left:25px;top:30px;z-index:2000;--drag-x:105px;--drag-y:69px;transform:rotate(6deg);';
    const img = document.createElement('img');
    img.src = '/probe.svg';
    await img.decode();
    probe.append(img);
    board.append(probe);
    const parts = new Map(), order = [];
    let folder;
    globalThis.showDirectoryPicker = options => {
      check(options.mode === 'readwrite', 'Expected writable picker');
      order.push('picker');
      return Promise.resolve({
        async getDirectoryHandle(root, { create }) {
          check(create && root === 'Vivere_Archive', 'Archive root not created');
          return {
            async *keys() { yield '2026-11-21_café'; },
            async getDirectoryHandle(name, options) {
              check(options.create, 'Folder not created');
              folder = name;
              return {
                async getFileHandle(path) {
                  return { async createWritable() { return { async write(blob) { parts.set(path, blob); }, async close() {} }; } };
                }
              };
            }
          };
        }
      });
    };
    const params = {
      metadata: { title: 'Café', date: '21 NOVEMBER 2026', story: 'Original note', song: 'Original song' },
      async ensureScrapbookOpen() { order.push('open'); return spread; },
      async captureReel() { order.push('reel'); return new Blob(['video'], { type: 'video/webm;codecs=vp9' }); }
    };
    const archive = exportMemoryArchive(params);
    check(order.join() === 'picker', 'Picker did not run synchronously');
    const saved = await archive;
    check(order.join() === 'picker,open,reel', `Wrong callback order: ${order}`);
    check(saved.mode === 'folder' && folder === '2026-11-21_Café-2' && parts.has('reel.webm'), 'Wrong folder or reel name');
    check(saved.missingImages === 0, 'Unexpected missing images');
    check((await parts.get('memory-details.txt').text()).includes('Original note'), 'Original metadata not preserved');
    check(saved.scrapbook === 'scrapbook.png', `Chrome unexpectedly needed ${saved.scrapbook}`);
    const bitmap = await createImageBitmap(parts.get('scrapbook.png'));
    const bounds = spread.getBoundingClientRect();
    const patch = img.getBoundingClientRect();
    check(bitmap.width === Math.ceil(bounds.width * 3) && bitmap.height === Math.ceil(bounds.height * 3),
      `Wrong PNG dimensions: ${bitmap.width}×${bitmap.height}; live spread ${bounds.width}×${bounds.height}`);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const pixel = (x, y) => [...ctx.getImageData(Math.round((x - bounds.left) * 3), Math.round((y - bounds.top) * 3), 1, 1).data];
    const x = patch.left + patch.width / 2, y = patch.top + patch.height / 2;
    check(pixel(x, y).join() === '18,0,254,255', `Missing inlined image at dragged position: ${pixel(x, y)}`);
    check(pixel(x - 105, y - 69).join() !== '18,0,254,255', 'Image did not move with the drag position');
    check(pixel(x + 25, y + 3).join() === '11,237,16,255', `Missing pseudo-element: ${pixel(x + 25, y + 3)}`);
    globalThis.showDirectoryPicker = async () => { throw new DOMException('Cancelled', 'AbortError'); };
    order.length = 0;
    check((await exportMemoryArchive(params)).mode === 'cancelled' && !order.length, 'Cancellation started work');
    globalThis.showDirectoryPicker = undefined;
    let download;
    HTMLAnchorElement.prototype.click = function () { download = [this.download, this.href]; };
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = callback => callback(null);
    const unavailable = document.createElement('img');
    unavailable.src = '/unavailable.svg';
    board.append(unavailable);
    const fallback = await exportMemoryArchive(params);
    check(fallback.mode === 'zip' && fallback.scrapbook === 'scrapbook.svg' && download[0] === '2026-11-21_Café.zip', 'ZIP/SVG fallback missing');
    check(fallback.missingImages === 1, 'Unavailable image not reported');
    const zip = await (await fetch(download[1])).arrayBuffer();
    const view = new DataView(zip);
    const svgHeader = 30 + view.getUint16(26, true) + view.getUint32(22, true);
    const nameLength = view.getUint16(svgHeader + 26, true);
    const decoder = new TextDecoder();
    check(decoder.decode(new Uint8Array(zip, svgHeader + 30, nameLength)) === 'Vivere_Archive/2026-11-21_Café/scrapbook.svg', 'Wrong ZIP snapshot entry');
    const svgText = decoder.decode(new Uint8Array(zip, svgHeader + 30 + nameLength, view.getUint32(svgHeader + 22, true)));
    const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    check(!parsed.querySelector('parsererror') && parsed.querySelector('#archive-probe img').getAttribute('src').startsWith('data:'), 'Fallback SVG is not valid and self-contained');
    HTMLCanvasElement.prototype.toBlob = toBlob;
    download = null;
    const memory = {
      id: 'archive-smoke', duration: 2, photos: [defaultSunsetDataUrl], dateStr: '21 NOVEMBER 2026',
      soundtrack: { kind: 'ambient', title: 'Soft ambient' },
      ai: { title: 'Rain on Glass', journal_entry: 'I want to forget everything.', photoColors: null }
    };
    await openScrapbookModal(memory, false);
    check(document.querySelector('#bookSpread').dataset.archetype === 'noir', 'Sad story did not use noir');
    document.querySelector('#scrapbookModal [data-archive]').click();
    for (let i = 0; !download && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 50));
    check(download?.[0] === '2026-11-21_Rain-on-Glass.zip', document.querySelector('#videoModal [data-archive-status]').textContent || 'Archive action did not download');
    const real = new Uint8Array(await (await fetch(download[1])).arrayBuffer());
    const realView = new DataView(real.buffer), entries = new Map();
    for (let offset = 0; realView.getUint32(offset, true) === 0x04034b50;) {
      const length = realView.getUint16(offset + 26, true);
      const start = offset + 30 + length + realView.getUint16(offset + 28, true);
      const size = realView.getUint32(offset + 22, true);
      entries.set(decoder.decode(real.subarray(offset + 30, offset + 30 + length)), real.subarray(start, start + size));
      offset = start + size;
    }
    const prefix = 'Vivere_Archive/2026-11-21_Rain-on-Glass/';
    check(entries.get(prefix + 'scrapbook.png')?.[0] === 137, 'Real PNG is missing');
    const reel = entries.get(prefix + 'reel.webm');
    check(reel?.length > 1000, 'Real encoded reel is missing');
    check(decoder.decode(reel).includes('A_OPUS'), 'The recorded reel lacks an audio track');
    check(decoder.decode(entries.get(prefix + 'memory-details.txt')).includes('I want to forget everything.'), 'Real archive lost story');
    document.getElementById('reelVoiceMood').value = 'bright';
    document.getElementById('reelVoiceMood').dispatchEvent(new Event('change'));
    check(document.getElementById('reelVoiceBadge').textContent.includes('Bright'), 'Manual voice selector does not update the badge');
    await fetch('/report', { method: 'POST', body: '{}' });
  } catch (error) {
    await fetch('/report', { method: 'POST', body: JSON.stringify({ error: error.stack || String(error) }) });
  }
}
