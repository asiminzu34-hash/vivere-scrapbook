import { FONTS, analyzeAtmosphere, normalizeAtmosphere, onColor } from './atmosphere-style.js';
import { resolveReelCopy } from './reel-copy.js';

export async function requestAtmosphere(context) {
  const resultWithCopy = (style, source, copy) => ({
    style, source,
    ...(context.includeCopy ? { copy: resolveReelCopy(copy, { ...context, style }) } : {})
  });
  try {
    const response = await fetch('/api/atmosphere', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('Atmosphere request failed');
    const result = await response.json();
    const style = normalizeAtmosphere(result.style);
    if (style && ['ai', 'mock', 'fallback'].includes(result.source)) return resultWithCopy(style, result.source, result.copy);
  } catch {
    // The page also works when served without the atmosphere API.
  }
  return resultWithCopy(analyzeAtmosphere(context), 'fallback');
}

function applyAtmosphere(style) {
  const root = document.documentElement;
  const { palette, typography, layout, effects } = style;
  const { gradient } = effects;
  const tokens = {
    ...palette,
    'on-primary': onColor(palette.primary),
    'on-secondary': onColor(palette.secondary),
    'heading-font': FONTS[typography.heading],
    'body-font': FONTS[typography.body],
    'heading-weight': typography.headingWeight,
    'body-weight': typography.bodyWeight,
    radius: `${layout.radius}px`,
    blur: `${effects.blur}px`,
    glow: `${effects.glow * 100}%`,
    particles: effects.particles,
    motion: `${effects.motion}s`,
    'gradient-from': gradient.from,
    'gradient-to': gradient.to,
    'gradient-angle': `${gradient.angle}deg`
  };
  for (const [key, value] of Object.entries(tokens)) root.style.setProperty(`--atm-${key}`, value);
  root.dataset.atmosphereMotion = effects.motion ? 'on' : 'off';
}

export function bindAtmosphereForm(form, capture) {
  const prompt = form.elements.prompt;
  const status = form.querySelector('[role="status"]');
  const submit = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    const target = capture(prompt.value.trim());
    if (!target) return;
    submit.disabled = true;
    status.textContent = 'Designing your atmosphere…';
    try {
      const { style, source } = await requestAtmosphere(target.context);
      if (await target.apply(style) === false) {
        status.textContent = '';
        return;
      }
      status.textContent = `${style.mood} · ${style.vibe}${source === 'ai' ? '' : ' (local style)'}`;
    } catch {
      status.textContent = 'Could not update the style. Try again.';
    } finally {
      submit.disabled = false;
    }
  });
}

const toolbar = document.querySelector('.studio-toolbar');
document.addEventListener('click', event => {
  if (toolbar.open && !toolbar.contains(event.target)) toolbar.open = false;
});
toolbar.addEventListener('keydown', event => {
  if (event.key === 'Escape' && toolbar.open) {
    toolbar.open = false;
    toolbar.querySelector('summary').focus();
  }
});

let draft;
bindAtmosphereForm(document.getElementById('atmosphereForm'), prompt => {
  const story = document.getElementById('storyInput').value.trim();
  const song = document.getElementById('songInput').value.trim() || window.backgroundMusic?.title || '';
  return {
    context: { prompt, story, song, page: 'Scrapbook studio' },
    apply(style) {
      draft = { prompt, story, song, style };
      applyAtmosphere(style);
    }
  };
});

window.studioAtmosphere = {
  request: requestAtmosphere,
  analyze: analyzeAtmosphere,
  takeDraft(story, song) {
    const selected = draft && (draft.prompt || (draft.story === story && draft.song === song)) ? draft : null;
    draft = null;
    return selected;
  }
};
