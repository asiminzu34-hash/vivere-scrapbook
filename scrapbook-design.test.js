import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeAtmosphere, luminance, normalizeAtmosphere } from './atmosphere-style.js';
import { ARCHETYPES, summarizePhotoPixels, chooseArchetype, composeLayout } from './scrapbook-design.js';

const pixels = (...colors) => Uint8ClampedArray.from(colors.flatMap(rgb => [...rgb, 255]));

test('photo swatches combine every photo with equal weight and disregard transparency', () => {
  const red = [224, 28, 40], blue = [24, 70, 218];
  const result = summarizePhotoPixels([pixels(...Array(40).fill(red)), pixels(blue), Uint8ClampedArray.of(255, 255, 255, 0)]);
  assert.equal(result.dominant, '#e01c28');
  assert.equal(result.accent, '#1846da');
  assert.equal(summarizePhotoPixels([[]]), null);
});

test('image saturation, pastel highlights, moods and explicit prompts choose different materials', () => {
  const quiet = analyzeAtmosphere();
  const red = summarizePhotoPixels([pixels([243, 18, 29], [210, 24, 36], [36, 32, 34])]);
  const pastel = summarizePhotoPixels([pixels([246, 223, 212], [231, 232, 218])]);
  assert.equal(chooseArchetype(quiet, {}, red), 'zine');
  assert.equal(chooseArchetype(quiet, {}, pastel), 'painter');
  assert.equal(chooseArchetype(analyzeAtmosphere({ story: 'A joyful birthday' }), {}, null), 'pop');
  assert.equal(chooseArchetype(quiet, { journal_entry: 'A sleepover with my bestie' }, null), 'cozy');
  assert.equal(chooseArchetype(quiet, { designPrompt: 'Monet watercolor', journal_entry: 'Street grunge' }, red), 'painter');
});

test('dark muted photos are noir even at high contrast; vivid night photos can still be zine', () => {
  const noirPhoto = summarizePhotoPixels([pixels(...Array(7).fill([20, 22, 28]), ...Array(3).fill([218, 220, 227]))]);
  const vividPhoto = summarizePhotoPixels([pixels([185, 5, 21], [202, 18, 30], [17, 18, 19])]);
  const brightGray = summarizePhotoPixels([pixels([220, 220, 220])]);
  const upbeat = analyzeAtmosphere({ prompt: 'birthday party' });
  assert.ok(noirPhoto.contrast > .22);
  assert.equal(chooseArchetype(upbeat, { designPrompt: 'Y2K confetti' }, noirPhoto), 'noir');
  assert.equal(chooseArchetype(analyzeAtmosphere(), {}, vividPhoto), 'zine');
  assert.equal(chooseArchetype(analyzeAtmosphere(), {}, brightGray), 'painter');
  assert.equal(chooseArchetype(analyzeAtmosphere(), { sourceStory: 'A happy birthday at midnight' }, vividPhoto), 'pop');
});

test('direct sadness overrides upbeat AI and vivid photos without swallowing joy or zine', () => {
  const upbeat = analyzeAtmosphere({ prompt: 'birthday party' });
  const vivid = summarizePhotoPixels([pixels([206, 14, 30])]);
  const ai = { journal_entry: 'A joyful birthday covered in confetti' };
  assert.equal(chooseArchetype(upbeat, { ...ai, designPrompt: 'Sad, not a celebration' }, vivid), 'noir');
  assert.equal(chooseArchetype(upbeat, { ...ai, sourceStory: 'I am grieving' }, vivid), 'noir');
  assert.equal(chooseArchetype(upbeat, { ...ai, sourceStory: 'A grunge zine with torn newsprint' }, vivid), 'zine');
  assert.equal(chooseArchetype(analyzeAtmosphere({ prompt: 'sad' }), ai, null), 'noir');
  assert.equal(chooseArchetype(analyzeAtmosphere(), { journal_entry: 'Rainy midnight' }, null), 'noir');
});

test('a noir scene and its toolbar use only curated stickers even with upbeat AI', async t => {
  const element = () => ({
    children: [], elements: {}, dataset: {}, style: { setProperty() {} },
    addEventListener() {}, querySelector() { return null; },
    appendChild(child) { this.children.push(child); }
  });
  const elements = Object.fromEntries(['bookSpread', 'collageBoard', 'collageItemsLayer', 'vtBackdrop'].map(id => [id, element()]));
  const bar = element();
  globalThis.document = {
    head: element(), body: element(), createElement: element, getElementById: id => elements[id] || element(),
    querySelector: selector => selector.endsWith('.sticker-bar') ? bar : selector === '.studio-toolbar' ? element() : null,
    addEventListener() {}
  };
  globalThis.window = {};
  globalThis.makeDraggable = () => {};
  t.after(() => { delete globalThis.document; delete globalThis.window; delete globalThis.makeDraggable; });
  await import('./themes.js');

  const ai = {
    designPrompt: 'A sad memorial', atmosphereStyle: normalizeAtmosphere(analyzeAtmosphere({ prompt: 'confetti party' })),
    stickers: ['heart', 'balloon', 'bow'], photoColors: { dominant: '#ff0030', accent: '#00ff40' }
  };
  const scene = window.VT.refresh({ ai, photos: ['memory.jpg'] });
  assert.deepEqual(elements.bookSpread.dataset, { archetype: 'noir', texture: 'rain', motion: 'off' });
  assert.deepEqual(bar.children.map(button => button.textContent), ['+ moon', '+ umbrella', '+ camera', '+ key', '+ cloud', '🎲 Layout']);
  assert.equal(scene.archetype, 'noir');
  assert.equal(scene.frames[0], 'film');
  assert.equal(scene.titleStyle, 'cinzel');
  assert.ok(scene.P.dark && scene.P.board.every(color => luminance(color) < .05));
  assert.ok(scene.P.paper.every(color => luminance(color) < .10));
  assert.ok((luminance(scene.P.ink) + .05) / (luminance(scene.P.jpBg) + .05) >= 4.5);
  assert.deepEqual(scene.stickers, ARCHETYPES.noir.stickers);
  assert.ok(scene.stickers.every(id => window.VT.allStickerIds().includes(id)));
  assert.equal(window.VT.buildScene({ ai: { theme: 'lilac' }, photos: ['memory.jpg'] }).themeId, 'lilac');
});

test('all five layouts offer distinct geometry, preserve six slots and vary by seed and layout choice', () => {
  const layouts = new Set();
  for (const design of Object.values(ARCHETYPES)) {
    const original = composeLayout(design, () => .5, 0, true);
    const variant = composeLayout(design, () => .8, 1, true);
    assert.equal(original.slots.length, 6);
    assert.ok(variant.slots.every(p => p.x >= 0 && p.x + p.w < 100 && p.y < 100));
    assert.notDeepEqual(original, variant);
    layouts.add(JSON.stringify(original.slots));
  }
  assert.equal(layouts.size, 5);
});
