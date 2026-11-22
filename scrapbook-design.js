import { classifyMoodText, luminance } from './atmosphere-style.js';

const hex = rgb => `#${rgb.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));
const chroma = rgb => (Math.max(...rgb) - Math.min(...rgb)) / 255;
const light = rgb => (Math.max(...rgb) + Math.min(...rgb)) / 510;

// Give each photo equal weight, even when their aspect ratios differ.
export function summarizePhotoPixels(samples) {
  const bins = new Map();
  let count = 0, lightness = 0, colorfulness = 0, shadow = 0, highlights = 0;
  for (const pixels of samples) {
    let visible = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 160) visible++;
    if (!visible) continue;
    const weight = 1 / visible;
    count++;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] <= 160) continue;
      const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
      const l = light(rgb), c = chroma(rgb);
      lightness += l * weight;
      colorfulness += c * weight;
      if (l < .26) shadow += weight;
      if (l > .75) highlights += weight;
      const key = (rgb[0] >> 5) * 64 + (rgb[1] >> 5) * 8 + (rgb[2] >> 5);
      const bin = bins.get(key) || { weight: 0, total: [0, 0, 0] };
      bin.weight += weight;
      rgb.forEach((value, j) => { bin.total[j] += value * weight; });
      bins.set(key, bin);
    }
  }
  if (!count) return null;
  const groups = [...bins.values()].map(bin => ({ weight: bin.weight, rgb: bin.total.map(sum => sum / bin.weight) }));
  groups.sort((a, b) => b.weight - a.weight);
  const dominant = groups[0].rgb;
  const accent = groups.filter(group => distance(group.rgb, dominant) > 47 && group.weight >= count * .012)
    .sort((a, b) => b.weight * (.2 + chroma(b.rgb) * 2) - a.weight * (.2 + chroma(a.rgb) * 2))[0]?.rgb;
  return {
    dominant: hex(dominant), accent: accent ? hex(accent) : null,
    lightness: lightness / count, colorfulness: colorfulness / count,
    contrast: Math.min(shadow, highlights) / count
  };
}

const cache = new WeakMap();
export function analyzePhotos(photos) {
  if (!photos?.length) return Promise.resolve(null);
  if (!cache.has(photos)) cache.set(photos, Promise.all(photos.slice(0, 6).map(readPixels)).then(summarizePhotoPixels));
  return cache.get(photos);
}

function readPixels(src) {
  return new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const timer = setTimeout(() => finish(), 1800);
    function finish(pixels = []) {
      clearTimeout(timer);
      image.onload = image.onerror = null;
      resolve(pixels);
    }
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 40;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const ratio = 40 / Math.max(image.naturalWidth, image.naturalHeight);
        ctx.drawImage(image, 0, 0, Math.max(1, image.naturalWidth * ratio), Math.max(1, image.naturalHeight * ratio));
        finish(ctx.getImageData(0, 0, 40, 40).data);
      } catch { finish(); }
    };
    image.onerror = () => finish();
    image.src = src;
  });
}

const MOOD_DESIGN = { sad: 'noir', moody: 'noir', edgy: 'zine', joy: 'pop' };

function namedDesign(text) {

  if (/\b(ransom|pop magazine|y2k)\b/i.test(text)) return 'pop';
  if (/\b(monet|impressionis\w*|painterly|watercolou?r|garden)\b/i.test(text)) return 'painter';
  if (/\b(cozy|cosy|bff|bestie|sleepover|warm vintage)\b/i.test(text)) return 'cozy';
}

export function chooseArchetype(style, ai, photo) {
  const source = typeof ai.sourceStory === 'string' ? ai.sourceStory.trim() : '';
  const story = source || ai.journal_entry || ai.title || '';
  const promptMood = classifyMoodText(ai.designPrompt);
  const storyMood = classifyMoodText(story);
  const styleMood = classifyMoodText(style.mood) || classifyMoodText(style.vibe);
  // Strong negative text and genuinely dark, muted photos must not inherit upbeat materials.
  if (promptMood === 'sad' || storyMood === 'sad' ||
      (photo && ((photo.lightness <= .35 && photo.colorfulness <= .19) ||
        (photo.lightness < .72 && photo.colorfulness <= .055)))) return 'noir';

  const promptDesign = promptMood === 'edgy' ? 'zine' : namedDesign(ai.designPrompt) || MOOD_DESIGN[promptMood];
  if (promptDesign) return promptDesign;
  if (!source && styleMood === 'sad') return 'noir';
  const storyDesign = storyMood === 'edgy' || storyMood === 'joy' ? MOOD_DESIGN[storyMood] : namedDesign(story) || MOOD_DESIGN[storyMood];
  if (storyDesign) return storyDesign;

  const styleDesign = MOOD_DESIGN[styleMood];
  if (styleDesign) return styleDesign;
  if (style.effects.texture === 'rain') return 'noir';
  if (style.effects.texture === 'sparkles') return 'pop';
  const surface = style.palette.surface;
  const surfaceRgb = [1, 3, 5].map(start => parseInt(surface.slice(start, start + 2), 16));
  if (luminance(surface) < .12 && chroma(surfaceRgb) <= .19) return 'noir';
  if (photo && (photo.contrast > .22 || (photo.lightness < .55 && photo.colorfulness > (photo.lightness < .40 ? .42 : .48)))) return 'zine';
  if (photo?.colorfulness > .38) return 'pop';
  if (photo?.lightness > .65 && photo.colorfulness < .30) return 'painter';
  return 'cozy';
}

// Geometry, materials and typography are independent of the photo-driven colors.
export const ARCHETYPES = {
  noir: { label: 'Midnight Noir', frames: ['film', 'torn', 'taped'], heading: 'cinzel', hand: "'Special Elite', monospace", edge: 'film', papers: ['charcoal', 'vellum', 'grid', 'halftone'], stickers: ['moon', 'umbrella', 'camera', 'key', 'cloud', 'vinyl'], extras: ['strip', 'clip'], slots: [[8, 9, 52, -3], [63, 18, 30, 3], [13, 45, 31, -3], [47, 43, 40, 2], [7, 70, 30, 2], [60, 70, 29, -3]] },
  zine: { label: 'Editorial Street Zine', frames: ['torn', 'film', 'taped'], heading: 'poster', hand: "'Special Elite', monospace", edge: 'film', papers: ['checker', 'newsprint', 'halftone', 'grid'], stickers: ['lightning', 'cassette', 'camera', 'star', 'stamp'], extras: ['strip', 'clip', 'doodles'], slots: [[4, 7, 51, -7], [54, 23, 34, 8], [4, 43, 34, 5], [40, 52, 42, -5], [6, 74, 28, -4], [62, 68, 30, 7]] },
  pop: { label: 'Y2K Pop Magazine', frames: ['polaroid', 'heart', 'star', 'blob'], heading: 'ransom', hand: "'Caveat Brush', cursive", edge: 'scallop', papers: ['gingham', 'dots', 'stars', 'checker'], stickers: ['heart', 'star', 'bow', 'sparkle', 'cherries', 'balloon'], extras: ['glitter', 'doodles', 'strip'], slots: [[9, 8, 40, -8], [51, 5, 36, 10], [30, 36, 39, -4], [5, 48, 29, 9], [67, 51, 27, 8], [40, 68, 31, -10]] },
  painter: { label: 'Impressionist Paper Study', frames: ['scalloped', 'arch', 'blob', 'torn'], heading: 'serif', hand: "'Shadows Into Light', cursive", edge: 'waves', papers: ['wash', 'wash', 'waves', 'floral'], stickers: ['flower', 'fern', 'peony', 'butterfly', 'tulip', 'leaf'], extras: ['note', 'doodles'], slots: [[25, 9, 47, -3], [4, 33, 26, 5], [68, 27, 26, -4], [35, 47, 37, 3], [8, 65, 27, -4], [65, 63, 29, 4]] },
  cozy: { label: 'Vintage Best Friends', frames: ['polaroid', 'taped', 'torn', 'arch'], heading: 'script', hand: "'Caveat', cursive", edge: 'airmail', papers: ['gingham', 'floral', 'lined', 'grid'], stickers: ['flower', 'heart', 'bow', 'coffee', 'daisy', 'bunny'], extras: ['note', 'clip', 'doodles', 'strip'], slots: [[6, 11, 40, -5], [54, 11, 38, 5], [17, 38, 33, 4], [56, 42, 34, -5], [7, 66, 30, -5], [52, 68, 32, 5]] }
};

export function composeLayout(design, random, variant = 0, large = false) {
  const slots = design.slots.map(([left, top, width, angle], i) => {
    const w = width - (large ? Math.max(0, width - 36) : 0);
    const x = variant % 2 ? 100 - left - w : left;
    return { x: Math.max(2, Math.min(98 - w, x + (random() - .5) * 4)), y: top + (random() - .5) * 4,
      w, r: angle * (variant % 2 ? -1 : 1) + (random() - .5) * 4, ar: i === 0 ? '5/4' : '4/3' };
  });
  if (variant > 1) [slots[0], slots[1]] = [slots[1], slots[0]];
  return { slots, eph: [{ x: 5, y: 77, w: 15, r: -6 }, { x: 75, y: 74, w: 16, r: 5 }], note: { x: 68, y: large ? 78 : 63, w: 29, r: 3 } };
}
