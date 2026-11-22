const utf8 = new TextEncoder();
const svgNS = 'http://www.w3.org/2000/svg';
const htmlNS = 'http://www.w3.org/1999/xhtml';
const max32 = 0xffffffff;
const months = 'january february march april may june july august september october november december'.split(' ');

function archiveDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return [String(value.getFullYear()).padStart(4, '0'), value.getMonth() + 1, value.getDate()]
      .map(part => String(part).padStart(2, '0')).join('-');
  }
  const text = String(value ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(text);
  const written = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i.exec(text);
  const [year, month, day] = iso ? iso.slice(1).map(Number) : written
    ? [+written[3], months.indexOf(written[2].toLowerCase()) + 1, +written[1]] : [];
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return 'undated';
  const check = new Date(0);
  check.setUTCFullYear(year, month - 1, day);
  return check.getUTCMonth() === month - 1 ? check.toISOString().slice(0, 10) : 'undated';
}

export function archiveFolderName({ date, title } = {}) {
  const slug = Array.from(String(title ?? '').normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, ''))
    .slice(0, 56).join('').replace(/-+$/, '');
  return `${archiveDate(date)}_${slug || 'memory'}`;
}

export function formatArchiveMetadata({ date, title, story, song, query, journal } = {}) {
  const displayDate = date instanceof Date ? archiveDate(date) : date;
  const search = query ? `\nTrack search: ${query}` : '';
  const edited = journal && journal !== story ? `\nScrapbook note:\n${journal}\n` : '';
  return `Title: ${title ?? ''}\nDate: ${displayDate ?? ''}\nSong: ${song ?? ''}${search}\n\nStory:\n${story ?? ''}\n${edited}`;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  for (let bit = 0; bit < 8; bit++) byte = (byte >>> 1) ^ (byte & 1 ? 0xedb88320 : 0);
  return byte;
});

export function crc32(bytes) {
  let crc = max32;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ max32) >>> 0;
}

// Classic ZIP with stored entries: media is already compressed, and no dependency is needed.
export async function createArchiveZip(entries) {
  if (entries.length >= 0xffff) throw new Error('Too many ZIP entries.');
  const files = [], directory = [], paths = new Set();
  let offset = 0, directorySize = 0;
  for (const { name, blob } of entries) {
    const path = utf8.encode(name);
    if (!path.length || path.length > 0xffff || /[\\:\u0000-\u001f]/.test(name) ||
        name.split('/').some(part => !part || part === '.' || part === '..') || paths.has(name)) {
      throw new Error('Invalid or duplicate ZIP entry name.');
    }
    paths.add(name);
    const size = blob.size;
    if (offset + 30 + path.length + size >= max32) throw new Error('Archive is too large for ZIP export.');
    const crc = crc32(new Uint8Array(await blob.arrayBuffer()));
    const local = new DataView(new ArrayBuffer(30));
    const central = new DataView(new ArrayBuffer(46));
    local.setUint32(0, 0x04034b50, true);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    for (const [header, start] of [[local, 4], [central, 6]]) {
      header.setUint16(start, 20, true);
      header.setUint16(start + 2, 0x0800, true); // UTF-8 names
      header.setUint16(start + 8, 0x21, true); // DOS date: 1980-01-01
      header.setUint32(start + 10, crc, true);
      header.setUint32(start + 14, size, true);
      header.setUint32(start + 18, size, true);
      header.setUint16(start + 22, path.length, true);
    }
    central.setUint32(42, offset, true);
    files.push(local.buffer, path, blob);
    directory.push(central.buffer, path);
    offset += local.byteLength + path.length + size;
    directorySize += central.byteLength + path.length;
  }
  if (offset + directorySize + 22 >= max32) throw new Error('Archive is too large for ZIP export.');
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return new Blob([...files, ...directory, end.buffer], { type: 'application/zip' });
}

function within(promise, milliseconds) {
  let timer;
  return Promise.race([promise, new Promise(resolve => { timer = setTimeout(resolve, milliseconds); })])
    .finally(() => clearTimeout(timer));
}

function dataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function fetchResource(url, read) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await read(response);
  } finally {
    clearTimeout(timer);
  }
}

const cssUrls = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/gi;

async function inlineCssUrls(css, replace) {
  const parts = [];
  let cursor = 0;
  for (const match of css.matchAll(cssUrls)) {
    parts.push(css.slice(cursor, match.index), Promise.resolve(replace(match[1] ?? match[2] ?? match[3]))
      .then(url => `url("${url}")`));
    cursor = match.index + match[0].length;
  }
  parts.push(css.slice(cursor));
  return (await Promise.all(parts)).join('');
}

async function embeddedFonts(doc, families, asset) {
  if (!families.size) return '';
  const sheets = [...doc.styleSheets];
  const lists = await Promise.all(sheets.map(async sheet => {
    if (sheet.disabled) return [];
    let rules;
    try {
      rules = [...sheet.cssRules].filter(rule => rule.type === 5).map(rule => rule.cssText);
    } catch {
      if (!sheet.href) return [];
      try {
        const css = await fetchResource(sheet.href, response => response.text());
        rules = css.match(/@font-face\s*\{[^}]*\}/gi) || [];
      } catch {
        return []; // The computed fallback family is still available to the SVG renderer.
      }
    }
    return Promise.all(rules.map(async rule => {
      const family = /font-family:\s*([^;}]+)/i.exec(rule)?.[1].trim().replace(/^["']|["']$/g, '').toLowerCase();
      if (!families.has(family)) return '';
      try {
        return await inlineCssUrls(rule, url => asset(url, sheet.href || doc.baseURI));
      } catch {
        return '';
      }
    }));
  }));
  return lists.flat().join('\n');
}

async function buildSnapshot(spread, scale) {
  const doc = spread.ownerDocument;
  const view = doc.defaultView;
  if (!spread.isConnected || !spread.getClientRects().length) throw new Error('Open the scrapbook before archiving.');
  // Wait only for the entrance/drawing animations; ambient loops are frozen at their current frame.
  const entrances = (spread.getAnimations?.({ subtree: true }) || []).filter(animation =>
    animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime));
  await Promise.all([
    within(Promise.allSettled(entrances.map(animation => animation.finished)), 3000),
    within(doc.fonts?.ready, 3000)
  ]);
  const { width, height } = spread.getBoundingClientRect();
  if (!width || !height) throw new Error('The scrapbook is not visible.');
  const pixelScale = Math.min(scale, 8192 / Math.max(width, height), Math.sqrt(24e6 / (width * height)));
  const pixelWidth = Math.ceil(width * pixelScale), pixelHeight = Math.ceil(height * pixelScale);
  const svg = doc.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', pixelWidth);
  svg.setAttribute('height', pixelHeight);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const defs = doc.createElementNS(svgNS, 'defs');
  const foreign = doc.createElementNS(svgNS, 'foreignObject');
  foreign.setAttribute('width', '100%');
  foreign.setAttribute('height', '100%');
  svg.append(defs, foreign);
  const wrapper = doc.createElementNS(htmlNS, 'div');
  foreign.appendChild(wrapper);
  const stylesheet = doc.createElementNS(htmlNS, 'style');
  wrapper.appendChild(stylesheet);
  const rules = [], pending = [], families = new Set(), fetched = new Map(), localRefs = new Set();
  let missingImages = 0;
  const asset = (source, base = doc.baseURI) => {
    if (/^data:/i.test(source)) return source;
    const url = new URL(source, base);
    const here = new URL(doc.URL);
    if (url.hash && (source.startsWith('#') || url.origin + url.pathname + url.search === here.origin + here.pathname + here.search)) {
      localRefs.add(url.hash.slice(1));
      return url.hash;
    }
    if (!['http:', 'https:', 'blob:'].includes(url.protocol)) throw new Error('Unsupported scrapbook asset URL.');
    if (!fetched.has(url.href)) fetched.set(url.href, fetchResource(url.href, response => response.blob()).then(dataURL));
    return fetched.get(url.href);
  };
  const freeze = (style, apply, overrides = '') => {
    for (const name of style.fontFamily.split(',')) families.add(name.trim().replace(/^["']|["']$/g, '').toLowerCase());
    const declarations = [];
    for (const property of style) {
      if (property.startsWith('--') || /^(?:animation|transition)(?:-|$)/.test(property)) continue;
      const value = style.getPropertyValue(property);
      if (value) declarations.push(`${property}:${value};`);
    }
    const css = declarations.join('') + 'animation:none;transition:none;' + overrides;
    if (/url\(/i.test(css)) pending.push(inlineCssUrls(css, url => asset(url)).then(apply));
    else apply(css);
  };
  const copy = (source, root = false) => {
    if (source.nodeType === 3) return source.cloneNode();
    if (source.nodeType !== 1 || /^(script|style|link|iframe|object|embed|audio|video|source|animate|animatemotion|animatetransform|set)$/i.test(source.localName)) return null;
    const target = source.cloneNode(false);
    for (const attr of [...target.attributes]) {
      if (/^(on|src|data-)/i.test(attr.name) || /^(style|contenteditable|autofocus|action|formaction|poster|ping|download)$/i.test(attr.name) ||
          (attr.localName === 'href' && !(source.namespaceURI === svgNS && attr.value.startsWith('#')))) {
        target.removeAttributeNode(attr);
      }
    }
    const style = view.getComputedStyle(source);
    if (style.display === 'none') return null;
    freeze(style, css => target.setAttribute('style', css), root
      ? `position:relative;inset:auto;margin:0;box-sizing:border-box;width:${width}px;height:${height}px;min-width:0;min-height:0;max-width:none;max-height:none;`
      : '');
    if (source.localName === 'img') {
      const url = source.currentSrc || source.getAttribute('src');
      if (url) pending.push(Promise.resolve().then(() => asset(url)).then(data => {
        target.setAttribute('src', data);
      }, () => {
        // Some optional museum images can display live without granting fetch access.
        missingImages++;
      }));
      target.removeAttribute('loading');
      target.removeAttribute('decoding');
    }
    if (source.namespaceURI === htmlNS) {
      for (const pseudo of ['::before', '::after']) {
        const computed = view.getComputedStyle(source, pseudo);
        if (computed.content === 'none' || computed.content === 'normal' || computed.display === 'none') continue;
        const key = rules.length;
        rules.push('');
        target.setAttribute(`data-archive-${pseudo.slice(2)}`, key);
        freeze(computed, css => { rules[key] = `[data-archive-${pseudo.slice(2)}="${key}"]${pseudo}{${css}}`; });
      }
    }
    for (const child of source.childNodes) {
      const clone = copy(child);
      if (clone) target.appendChild(clone);
    }
    return target;
  };
  const clone = copy(spread, true);
  if (!clone) throw new Error('The scrapbook is not visible.');
  wrapper.appendChild(clone);
  const fonts = embeddedFonts(doc, families, asset);
  try {
    await Promise.all(pending);
    // The scrapbook can reference an outside SVG definition (e.g. the heart photo mask).
    for (const id of localRefs) {
      const definition = doc.getElementById(id);
      if (definition?.namespaceURI === svgNS && !spread.contains(definition)) {
        const cloned = copy(definition);
        if (cloned) defs.appendChild(cloned);
      }
    }
    await Promise.all(pending);
  } catch (error) {
    throw new Error('Could not embed a scrapbook image or decoration.', { cause: error });
  }
  stylesheet.textContent = `${await fonts}\n${rules.join('\n')}`;
  return { svg: new Blob([new view.XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }), pixelWidth, pixelHeight, missingImages };
}

async function rasterize(doc, svg, width, height) {
  const image = doc.createElement('img');
  // Chromium can mark a blob: SVG containing foreignObject as non-origin-clean.
  image.src = await dataURL(svg);
  await image.decode();
  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(image, 0, 0, width, height);
  const probe = doc.createElement('canvas');
  probe.width = probe.height = 24;
  const context = probe.getContext('2d');
  context.drawImage(canvas, 0, 0, 24, 24);
  const pixels = context.getImageData(0, 0, 24, 24).data;
  if (!pixels.some((value, index) => index % 4 === 3 && value)) throw new Error('The scrapbook rasterized to an empty image.');
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob?.size ? resolve(blob) : reject(new Error('PNG encoding failed.')), 'image/png'));
}

export async function captureScrapbook(spread, { scale = 3 } = {}) {
  if (!spread || !Number.isFinite(scale) || scale <= 0) throw new TypeError('A scrapbook element and a positive scale are required.');
  const { svg, pixelWidth, pixelHeight, missingImages } = await buildSnapshot(spread, scale);
  try {
    const png = await within(rasterize(spread.ownerDocument, svg, pixelWidth, pixelHeight), 10000);
    if (png) return { name: 'scrapbook.png', blob: png, missingImages };
  } catch {
    // Keep the sealed browser-rendered artwork rather than approximating the layout.
  }
  return { name: 'scrapbook.svg', blob: svg, missingImages };
}

async function writeFolder(parent, name, files) {
  const existing = new Set();
  for await (const key of parent.keys()) existing.add(key.toLowerCase());
  let unique = name;
  for (let suffix = 2; existing.has(unique.toLowerCase()); suffix++) unique = `${name}-${suffix}`;
  const folder = await parent.getDirectoryHandle(unique, { create: true });
  try {
    for (const file of files) {
      const handle = await folder.getFileHandle(file.name, { create: true });
      const writer = await handle.createWritable();
      try {
        await writer.write(file.blob);
        await writer.close();
      } catch (error) {
        await writer.abort().catch(() => {});
        throw error;
      }
    }
    return unique;
  } catch (error) {
    await parent.removeEntry?.(unique, { recursive: true }).catch(() => {});
    throw error;
  }
}

function downloadZip(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}.zip`;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

/**
 * Call directly from the initiating click, before any await. After the picker,
 * ensureScrapbookOpen() must resolve once the current scene is rendered. It can
 * return the spread or leave the default #bookSpread in place. captureReel()
 * runs after the snapshot and must return a WebM or MP4 Blob.
 */
export async function exportMemoryArchive({ metadata, ensureScrapbookOpen, captureReel }) {
  let destination, folderError;
  if (typeof globalThis.showDirectoryPicker === 'function') {
    try {
      destination = await globalThis.showDirectoryPicker({ mode: 'readwrite' });
    } catch (error) {
      if (error.name === 'AbortError') return { mode: 'cancelled' };
      folderError = error;
    }
  }
  const name = archiveFolderName(metadata);
  const text = formatArchiveMetadata(metadata);
  const spread = await ensureScrapbookOpen?.() || document.getElementById('bookSpread');
  const snapshot = await captureScrapbook(spread);
  const reel = await captureReel();
  const extension = /^video\/(webm|mp4)(?:;|$)/i.exec(reel?.type)?.[1].toLowerCase();
  if (!extension || !reel.size) throw new Error('Reel capture must return a nonempty WebM or MP4 Blob.');
  const files = [
    { name: 'memory-details.txt', blob: new Blob([text], { type: 'text/plain;charset=utf-8' }) },
    snapshot,
    { name: `reel.${extension}`, blob: reel }
  ];
  const details = { scrapbook: snapshot.name, missingImages: snapshot.missingImages };
  if (destination) {
    try {
      const root = await destination.getDirectoryHandle('Vivere_Archive', { create: true });
      const folderName = await writeFolder(root, name, files);
      return { mode: 'folder', name: folderName, ...details };
    } catch (error) {
      folderError = error;
    }
  }
  const zip = await createArchiveZip(files.map(file => ({ ...file, name: `Vivere_Archive/${name}/${file.name}` })));
  downloadZip(zip, name);
  return { mode: 'zip', name, ...details, ...(folderError && { folderError }) };
}
