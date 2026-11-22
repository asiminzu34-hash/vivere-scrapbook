// Shared contract for model output, saved scrapbook styles, and browser CSS tokens.
export const FONTS = Object.freeze({
  editorial: "'Cormorant Garamond', Georgia, serif",
  classic: 'Georgia, serif',
  modern: "'Plus Jakarta Sans', system-ui, sans-serif",
  humanist: 'system-ui, sans-serif'
});

export const DEFAULT_ATMOSPHERE = {
  palette: {
    primary: '#705094', secondary: '#cbb8e3', accent: '#a77ac4',
    background: '#e5daf3', surface: '#fcfaff', text: '#2c223b'
  },
  typography: { heading: 'editorial', body: 'modern', headingWeight: 600, bodyWeight: 400 },
  layout: { radius: 18 },
  effects: {
    blur: 10, glow: 0.20, particles: 0.16, motion: 24, texture: 'orbs',
    gradient: { from: '#efe8f8', to: '#d5c2ec', angle: 135 }
  },
  mood: 'Calm', vibe: 'Soft paper and lavender'
};

const HEX = /^#[\da-f]{6}$/i;
const isColor = color => typeof color === 'string' && HEX.test(color);
const bounded = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
const font = name => typeof name === 'string' && Object.hasOwn(FONTS, name);
const label = value => typeof value === 'string' ? value.trim().slice(0, 64) : '';
const MOODS = {
  sad: { texture: 'rain', hue: 220, dark: true, heading: 'classic', mood: 'Melancholic', vibe: 'Rain on charcoal paper' },
  moody: { texture: 'rain', hue: 222, dark: true, heading: 'classic', mood: 'Moody', vibe: 'Rain on midnight paper' },
  joy: { texture: 'sparkles', hue: 8, heading: 'modern', mood: 'Celebratory', vibe: 'Warm paper and confetti' },
  edgy: { texture: 'grain', hue: 275, dark: true, heading: 'modern', mood: 'Edgy', vibe: 'Ink and torn newsprint' },
  nostalgic: { texture: 'grain', hue: 36, heading: 'editorial', mood: 'Nostalgic', vibe: 'Golden light and film grain' },
  calm: { texture: 'orbs', hue: 145, heading: 'editorial', mood: 'Calm', vibe: 'Quiet light and soft paper' }
};

export function classifyMoodText(text) {
  if (typeof text !== 'string') return;
  const clues = text
    .replace(/\b(?:crying (?:with|from) laughter|(?:in |with )?tears of joy)\b/gi, 'joy')
    .replace(/\b(?:not|never)\s+(?:(?:felt|feel|too|very|really|at all)\s+)*[\w-]+/gi, '');
  if (/\b(sad(?:ness|dened)?|melanchol\w*|somber|sombre|wistful|grief|griev\w*|mourn\w*|heartbrok\w*|heartbreak|breakup|broken heart|lonel\w*|rest in peace|miss(?:ing)? you|with tears|in tears|cried|crying|depress(?:ed|ing|ion)|feeling (?:down|blue))\b/i.test(clues)) return 'sad';
  if (/\b(?:(?:want(?:ed)? to|wanna|wish i could|need to|trying to) forget (?:it all|everything|what happened|the past)|(?:feel|felt|feeling|so) (?:empty|alone|numb)|(?:left|all) alone|lost everything|nothing feels the same|can['’]?t move on)\b/i.test(clues)) return 'sad';
  if (/\b(noir|low[- ]key lighting)\b/i.test(clues)) return 'moody';
  if (/\b(edgy|angst\w*|zine|grunge|street art|streetwear|punk|comic(?: book)?|spider[- ]?man|halftone)\b/i.test(clues)) return 'edgy';
  if (/\b(birthday\w*|celebrat\w*|confetti|disco|part(?:y|ied)|playful|joy(?:ful|ous)?|happy|happiness|excit(?:ed|ement|ing)|ecstatic|euphori\w*|laugh(?:ed|ing|ter)|y2k|pop magazine)\b/i.test(clues)) return 'joy';
  if (/^\s*(dark|night)\s*$/i.test(clues) || /\b(rain\w*|storm\w*|dark (?:room|sky|night|alley|street)|nighttime|night sky|midnight|moody|blues|shadowy|overcast)\b/i.test(clues)) return 'moody';
  if (/\b(nostalgi\w*|vintage|golden hour|autumn|film|oldies|vinyl|jazz|warm|retro)\b/i.test(clues)) return 'nostalgic';
  if (/\b(calm|peaceful|serene|stillness|quiet morning|relax\w*)\b/i.test(clues)) return 'calm';
}

const moodFrom = text => MOODS[classifyMoodText(text)];
const TEXTURES = ['orbs', 'rain', 'sparkles', 'grain'];

export function luminance(color) {
  const [r, g, b] = color.slice(1).match(/../g).map(channel => {
    const v = parseInt(channel, 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

export const onColor = background => contrast('#ffffff', background) >= contrast('#000000', background)
  ? '#ffffff' : '#000000';

export function normalizeAtmosphere(value) {
  const { palette, typography, layout, effects, mood, vibe } = value ?? {};
  if (!palette || !typography || !layout || !effects?.gradient) return null;
  const { primary, secondary, accent, background, surface, text } = palette;
  const { heading, body, headingWeight, bodyWeight } = typography;
  const { radius } = layout;
  const { blur, glow, particles, motion, texture, gradient: { from, to, angle } } = effects;
  if (![primary, secondary, accent, background, surface, text, from, to].every(isColor) ||
      ![background, surface, from, to].every(color => contrast(text, color) >= 4.5) ||
      !font(heading) || !font(body) ||
      ![400, 500, 600, 700].includes(headingWeight) || ![400, 500, 600, 700].includes(bodyWeight) ||
      !bounded(radius, 4, 32) || !bounded(blur, 0, 20) || !bounded(glow, 0, 0.35) ||
      !bounded(particles, 0, 0.30) || !(motion === 0 || bounded(motion, 12, 60)) ||
      !bounded(angle, 0, 360) || !label(mood) || !label(vibe)) return null;
  return {
    palette: { primary, secondary, accent, background, surface, text },
    typography: { heading, body, headingWeight, bodyWeight },
    layout: { radius },
    effects: {
      blur, glow, particles, motion, gradient: { from, to, angle },
      texture: TEXTURES.includes(texture) ? texture : moodFrom(`${label(mood)} ${label(vibe)}`)?.texture || 'orbs'
    },
    mood: label(mood), vibe: label(vibe)
  };
}

function hsl(h, s, l) {
  const channel = offset => {
    const k = (offset + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const component = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * component).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

// Explicit mood wins over diary and soundtrack clues; the words vary shades within that mood.
export function analyzeAtmosphere({ prompt = '', story = '', song = '' } = {}) {
  const clues = [prompt, story, song].filter(text => typeof text === 'string').map(text => text.trim().toLowerCase());
  const input = clues.filter(Boolean).join(' ');
  if (!input) return DEFAULT_ATMOSPHERE;
  const mood = clues.map(moodFrom).find(Boolean);
  let seed = 0;
  for (const char of input) seed = (Math.imul(seed, 31) + char.codePointAt(0)) >>> 0;
  const dark = mood?.dark;
  const muted = mood?.texture === 'rain';
  const lively = mood?.texture === 'sparkles';
  const hue = mood ? (mood.hue + seed % 25 + 348) % 360 : seed % 360;
  const adjacent = (hue + (dark ? 22 : 36) + (seed >>> 8) % 14) % 360;
  const background = hsl(hue, muted ? 0.12 : 0.35, dark ? 0.13 : 0.91);
  const surface = hsl(hue, muted ? 0.14 : 0.26, dark ? 0.20 : 0.97);
  return {
    palette: {
      primary: hsl(hue, muted ? 0.18 : lively ? 0.72 : 0.46, dark ? 0.70 : 0.40),
      secondary: hsl(adjacent, muted ? 0.14 : 0.52, dark ? 0.39 : 0.78),
      accent: hsl((adjacent + (dark ? 338 : 22)) % 360, muted ? 0.18 : 0.66, dark ? 0.78 : 0.46),
      background, surface, text: dark ? '#f6f1fa' : '#271f2e'
    },
    typography: { heading: mood?.heading || 'editorial', body: 'modern', headingWeight: lively ? 700 : 600, bodyWeight: 400 },
    layout: { radius: dark ? 9 : 15 + (seed >>> 4) % 11 },
    effects: {
      blur: dark ? 14 : 8, glow: lively ? 0.30 : 0.20, particles: lively ? 0.26 : dark ? 0.18 : 0.12,
      motion: lively ? 19 : 32, texture: mood?.texture || 'orbs',
      gradient: { from: background, to: hsl(adjacent, muted ? 0.14 : 0.38, dark ? 0.23 : 0.84), angle: 115 + seed % 65 }
    },
    mood: mood?.mood || 'Calm',
    vibe: mood?.vibe || 'Soft and reflective'
  };
}
