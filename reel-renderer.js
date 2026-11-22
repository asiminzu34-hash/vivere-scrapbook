export const REEL_EFFECTS = Object.freeze({
  film: '35mm Film', sunbeams: 'Golden Sunbeams', collage: 'Scrapbook Collage', vhs: 'Retro VHS', dream: 'Dreamy Soft'
});

const W = 405, H = 720, TAU = Math.PI * 2, DISSOLVE = 0.22;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = t => (t = clamp(t), t * t * (3 - 2 * t));
const mix = (a, b, t) => a + (b - a) * t;
const durationOf = d => Number.isFinite(+d) && +d > 0 ? +d : 15;
const random = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const hex = (value, fallback) => /^#[\da-f]{6}$/i.test(value) ? value : fallback;

// Scene progress is 0–1; the next scene enters before its nominal start.
export function reelTiming(seconds, duration = 15, photoCount = 0) {
  duration = durationOf(duration);
  photoCount = Number.isFinite(photoCount) ? Math.max(0, Math.floor(photoCount)) : 0;
  const sceneCount = photoCount === 1 ? 3 : photoCount || 1;
  const remainder = Number.isFinite(seconds) ? seconds % duration : 0;
  const time = remainder < 0 ? remainder + duration : remainder || 0;
  const scene = time / duration * sceneCount;
  const sceneIndex = Math.min(sceneCount - 1, Math.floor(scene));
  const nextSceneIndex = (sceneIndex + 1) % sceneCount;
  const progress = scene - sceneIndex;
  return {
    time, duration, sceneCount, sceneIndex, nextSceneIndex, progress,
    photoIndex: photoCount ? sceneIndex % photoCount : -1,
    nextPhotoIndex: photoCount ? nextSceneIndex % photoCount : -1,
    dissolve: sceneCount > 1 ? smooth((progress - (1 - DISSOLVE)) / DISSOLVE) : 0
  };
}

function rect(ctx, color, x = 0, y = 0, w = W, h = H) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function glow(ctx, x, y, radius, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, color);
  g.addColorStop(1, 'transparent');
  rect(ctx, g, x - radius, y - radius, radius * 2, radius * 2);
}

function vignette(ctx, edge) {
  const g = ctx.createRadialGradient(W / 2, H * .45, 130, W / 2, H / 2, 425);
  g.addColorStop(0, 'transparent');
  g.addColorStop(1, edge);
  rect(ctx, g);
}

function cover(ctx, photo, x, y, w, h, zoom, fx, fy) {
  const { img, width, height } = photo;
  const scale = Math.max(w / width, h / height) * zoom;
  const sw = w / scale, sh = h / scale;
  ctx.drawImage(img, (width - sw) * fx, (height - sh) * fy, sw, sh, x, y, w, h);
}

function tornPaper(ctx, x, y, w, h, color, seed) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i <= 16; i++) ctx.lineTo(x + w * i / 16, y + random(seed + i) * 6);
  for (let i = 16; i >= 0; i--) ctx.lineTo(x + w * i / 16, y + h - random(seed + 31 + i) * 9);
  ctx.closePath();
  ctx.fill();
}

function wrap(ctx, text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > width) {
      lines.push(line);

      line = word;
    } else line = test;
  }
  return line ? [...lines, line] : lines;
}

export function createReelRenderer(canvas, images, memory = {}) {
  const ctx = canvas.getContext('2d');
  const ai = memory.ai || {};
  const duration = durationOf(memory.duration);
  const photos = Array.from(images || [], img => ({
    img, width: img?.naturalWidth ?? img?.width, height: img?.naturalHeight ?? img?.height
  })).filter(p => p.img?.complete !== false && p.width > 0 && p.height > 0);
  const { sceneCount } = reelTiming(0, duration, photos.length);
  const clean = s => typeof s === 'string' ? s.trim().slice(0, 240) : '';
  const captions = Array.isArray(ai.captions) ? ai.captions.map(clean).filter(Boolean) : [];
  const title = clean(ai.title) || 'Living Memory';
  const date = clean(memory.dateStr) || clean(ai.dateStr);
  const palette = ai.atmosphereStyle?.palette;
  const accent = hex(palette?.accent, '#ffc480');
  const primary = hex(palette?.primary, '#cbb6ea');
  const secondary = hex(palette?.secondary, '#ffd0c8');
  const focus = (value, fallback) => typeof value === 'number' && Number.isFinite(value)
    ? clamp(value / 100) : fallback;
  const fx = focus(ai.focus?.x, .5), fy = focus(ai.focus?.y, .45);
  function textCard(text, intro) {
    const font = intro ? 'bold 43px Georgia, serif' : 'italic 28px Georgia, serif';
    ctx.save();
    ctx.font = font;
    const lines = wrap(ctx, text, 307);
    ctx.restore();
    // Older titles may have been edited by hand; fit them without adding an ellipsis.
    return { intro, font, lines: lines.length <= 3 ? lines : [text] };
  }
  const intro = textCard(title, true);
  const introTime = Math.min(2.6, duration * 0.20, duration / sceneCount * 0.78);
  const introProgress = introTime / (duration / sceneCount);
  const sceneText = Array.from({ length: sceneCount }, (_, i) => {
    const start = Math.floor(i * captions.length / sceneCount);
    const end = Math.min(captions.length, Math.max(start + 1, Math.floor((i + 1) * captions.length / sceneCount)));
    return captions.slice(start, end).map(text => textCard(text, false));
  });

  const surface = (w = W, h = H) => {
    const layer = canvas.ownerDocument.createElement('canvas');
    layer.width = w; layer.height = h;
    return layer.getContext('2d');
  };
  let scratch, channel, grain;

  function scene(ctx, index, photoIndex, progress, t, style, motion, pulse) {
    const photo = photos[photoIndex], mode = index % 3;
    const dream = style === 'dream';
    const u = smooth(progress), sway = Math.sin(t * (dream ? 0.63 : 1.3) + index) * motion;
    const zoom = mix([1.04, 1.27, 1.13][mode], [1.22, 1.1, 1.29][mode], mix(.5, u, .35 + (dream ? .32 : .65) * motion)) + pulse * .022;
    const x = clamp(fx + ([-.10, .12, .05][mode] + (u - .5) * [.2, -.18, .14][mode]) * (.55 + .45 * motion) + sway * .015);
    const y = clamp(fy + ([.03, -.12, .10][mode] + (u - .5) * [.10, .14, -.20][mode]) * (.55 + .45 * motion));
    if (style === 'collage') {
      rect(ctx, '#cbb392');
      tornPaper(ctx, -12, 55, 435, 495, '#e2d0b4', 4);
      tornPaper(ctx, -8, 500, 424, 166, '#ede1ca', 43);
      for (let row = 70; row < 650; row += 17) rect(ctx, '#503b2920', 0, row, W, 1);
      const drop = (1 - Math.floor(smooth((progress + DISSOLVE) / DISSOLVE) * 6) / 6) * motion;
      ctx.save();
      ctx.translate(W / 2 + 15 * drop, 299 - 118 * drop);
      ctx.rotate((mode === 1 ? .052 : -.055) + (.18 * drop + sway * .008));
      rect(ctx, '#432d3240', -159, -217, 330, 461);
      rect(ctx, '#fff8e8', -165, -225, 330, 461);
      if (photo) cover(ctx, photo, -152, -212, 304, 409, zoom, x, y);
      else rect(ctx, primary, -152, -212, 304, 409);
      ctx.restore();
      ctx.save();
      ctx.translate(89, 86 + sway * 4 - drop * 25);
      ctx.rotate(-.24);
      tornPaper(ctx, -52, -14, 104, 29, accent + 'cf', 21);
      ctx.restore();
      ctx.translate(337, 500 - sway * 4);
      ctx.rotate(.16 + sway * .08);
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = i * TAU / 16, r = i % 2 ? 19 : 27;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fillStyle = '#fff6d9'; ctx.fill();
      ctx.fillStyle = '#9b5445'; ctx.font = '22px Georgia'; ctx.textAlign = 'center'; ctx.fillText('✦', 0, 8);
    } else if (photo) {
      rect(ctx, '#1c1720');
      if (style === 'film') ctx.filter = 'sepia(18%) contrast(106%) saturate(88%)';
      if (style === 'sunbeams') ctx.filter = 'saturate(108%) contrast(94%)';
      cover(ctx, photo, 0, 0, W, H, zoom, x, clamp(y + (dream ? sway * .065 : 0)));
      ctx.filter = 'none';
    } else {
      rect(ctx, '#241b32');
      glow(ctx, 105, 230, 400, primary + '9e');
      glow(ctx, 340, 460, 325, secondary + '65');
    }
  }

  function film(t) {
    rect(ctx, '#a6522229');
    ctx.globalCompositeOperation = 'screen'; rect(ctx, '#6840183d'); ctx.globalCompositeOperation = 'source-over';
    vignette(ctx, '#1d0b06db');
    if (!grain) {
      const tile = surface(128, 128), pixels = tile.createImageData(128, 128);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const v = random(i);
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v < .55 ? 0 : 255;
        pixels.data[i + 3] = Math.round(48 * Math.abs(v - .5));
      }
      tile.putImageData(pixels, 0, 0);
      grain = ctx.createPattern(tile.canvas, 'repeat');
    }
    const tick = Math.floor(t * 18), x = -Math.floor(random(tick) * 128), y = -Math.floor(random(tick + 1) * 128);
    ctx.save(); ctx.translate(x, y); rect(ctx, grain, 0, 0, W - x, H - y); ctx.restore();
    for (const edge of [0, W - 16]) {
      rect(ctx, '#1a100eea', edge, 0, 16, H);
      for (let y = 12; y < H; y += 44) {
        ctx.beginPath(); ctx.roundRect(edge + 4, y, 8, 14, 2);
        ctx.fillStyle = '#eed3a4b0'; ctx.fill();
      }
    }
  }

  function vhs(time, t) {
    scratch ||= surface();
    channel ||= surface();
    scratch.drawImage(canvas, 0, 0, W, H);
    const tick = Math.floor(t * 12), jitter = random(tick) > .84 ? (random(tick + 5) - .5) * 16 : 0;
    rect(ctx, '#000'); ctx.globalCompositeOperation = 'lighter';
    for (const [color, shift] of [['#f00', -3], ['#0ff', 3]]) {
      channel.drawImage(scratch.canvas, 0, 0);
      channel.globalCompositeOperation = 'multiply'; rect(channel, color);
      channel.globalCompositeOperation = 'source-over';
      ctx.drawImage(channel.canvas, shift + jitter, 0);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (let y = 0; y < H; y += 4) rect(ctx, '#090c2845', 0, y, W, 1);
    rect(ctx, '#bec9e123', 0, t * 39 % H, W, 13);
    vignette(ctx, '#080b32a0');
    const stamp = v => String(v).padStart(2, '0');
    ctx.font = 'bold 17px monospace'; ctx.textAlign = 'left';
    ctx.fillStyle = '#e2f6fc'; ctx.shadowColor = '#25273d'; ctx.shadowBlur = 4;
    ctx.fillText('PLAY ▸   SP', 24, 42);
    ctx.fillText(`00:${stamp(Math.floor(time / 60))}:${stamp(Math.floor(time) % 60)}`, 24 + jitter, 684);
    ctx.shadowBlur = 0;
  }

  return (seconds, effect = 'film', { pulse = 0, reducedMotion = false } = {}) => {
    const style = Object.hasOwn(REEL_EFFECTS, effect) ? effect : 'film';
    const s = reelTiming(seconds, duration, photos.length);
    const motion = reducedMotion ? 0 : 1, t = s.time * motion;
    const beat = Number.isFinite(pulse) ? clamp(pulse) * motion : 0;
    ctx.save();
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.save(); scene(ctx, s.sceneIndex, s.photoIndex, s.progress, t, style, motion, beat); ctx.restore();
    if (s.dissolve > 0) {
      scratch ||= surface();
      scratch.save(); scene(scratch, s.nextSceneIndex, s.nextPhotoIndex, s.progress - 1, t, style, motion, beat); scratch.restore();
      ctx.globalAlpha = s.dissolve;
      ctx.drawImage(scratch.canvas, 0, 0);
      ctx.globalAlpha = 1;
    }
    if (style === 'film') film(t);
    if (style === 'vhs') vhs(s.time, t);
    if (style === 'sunbeams' || style === 'dream') {
      ctx.globalCompositeOperation = 'screen';
      if (style === 'dream') {
        scratch ||= surface(); scratch.drawImage(canvas, 0, 0, W, H);
        ctx.globalAlpha = .23; ctx.filter = 'blur(9px) saturate(75%)';
        ctx.drawImage(scratch.canvas, -7, -7, W + 14, H + 14);
        ctx.filter = 'none'; ctx.globalAlpha = 1;
        glow(ctx, 34 + 21 * Math.sin(t * .5), 205, 385, primary + '95');
        glow(ctx, 390, 600, 320, secondary + '85');
      } else {
        glow(ctx, 26 + 42 * Math.sin(t * .5), 110, 350, '#ffb046ae');
        glow(ctx, 410, 510 + 36 * Math.cos(t * .8), 210, '#ff71466e');
        for (let i = 1; i <= 23; i++) {
          const x = random(i) * W + Math.sin(t * .72 + i) * 17;
          const y = (random(i + 39) * H - t * (4 + i % 6) % H + H) % H;
          const r = i % 5 ? 1 + random(i + 71) * 2 : 13 + random(i + 71) * 16;
          glow(ctx, x, y, r, i % 5 ? '#fff0b56b' : '#ffd38f52');
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    if (s.dissolve > 0) {
      ctx.globalAlpha = Math.sin(s.dissolve * Math.PI) * (reducedMotion ? .22 : .58);
      glow(ctx, W * (.16 + .69 * s.dissolve), H * .36, 340, accent + 'aa');
      ctx.globalAlpha = 1;
    }
    const texts = sceneText[s.sceneIndex];
    const captionStart = s.sceneIndex === 0 ? introProgress : 0;
    const cue = (s.progress - captionStart) / (.95 - captionStart) * texts.length;
    const isIntro = s.time < introTime;
    const card = isIntro ? intro : texts[Math.floor(cue)];
    const p = isIntro ? s.time / introTime : cue % 1;
    if (card) {
      ctx.globalAlpha = smooth(p / .17) * smooth((1 - p) / .22);
      const y = card.intro ? 448 : 568, step = card.intro ? 48 : 33;
      const g = ctx.createLinearGradient(0, y - 82, 0, y + 137);
      g.addColorStop(0, 'transparent'); g.addColorStop(.43, '#100d16be'); g.addColorStop(1, 'transparent');
      rect(ctx, g, style === 'film' ? 16 : 0, y - 82, style === 'film' ? W - 32 : W, 219);
      ctx.translate(W / 2, y + (1 - smooth(p / .21)) * 7 * motion);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff7e8';
      ctx.font = card.font;
      card.lines.forEach((line, i) => ctx.fillText(line, 0, i * step, 307));
      if (card.intro && date) {
        ctx.font = '600 12px sans-serif'; ctx.fillStyle = '#ffe3bf';
        ctx.fillText(date, 0, -33, 275);
      }
    }
    ctx.restore();
  };
}
