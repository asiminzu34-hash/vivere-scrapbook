import assert from 'node:assert/strict';
import test from 'node:test';
import { findMusicPreview, normalizeMusicQuery } from './music-preview.js';

const url = '/api/preview?u=https%3A%2F%2Fexample.com%2Fpreview.mp3';

test('preview lookup normalizes the query but preserves the canonical song label', async t => {
  assert.equal(normalizeMusicQuery('  TiTlE  & Artist  '), 'title  & artist');
  const fetch = t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ title: 'Title', artist: 'Artist', url })
  }));

  assert.equal(await findMusicPreview('  '), null);
  assert.equal(fetch.mock.callCount(), 0);
  const expected = { query: 'title  & artist', title: 'Title', artist: 'Artist', label: 'Title — Artist', url };
  assert.deepEqual(await findMusicPreview('  TiTlE  & Artist  '), expected);
  assert.deepEqual(await findMusicPreview('title  & artist'), expected);
  for (const call of fetch.mock.calls) {
    assert.equal(call.arguments[0], '/api/music?q=title%20%20%26%20artist');
  }
});

test('preview lookup distinguishes no match from service errors and rejects non-proxy URLs', async t => {
  const responses = [
    { status: 404 },
    { status: 502 },
    { ok: true, json: async () => ({ title: 'Title', url: 'https://example.com/preview.mp3' }) }
  ];
  t.mock.method(globalThis, 'fetch', async () => responses.shift());
  assert.equal(await findMusicPreview('Title'), null);
  await assert.rejects(findMusicPreview('Title'), /Music search failed/);
  await assert.rejects(findMusicPreview('Title'), /Invalid preview/);
});

test('preview lookup forwards cancellation to the request', async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const pending = findMusicPreview('Title', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('toolbar and creation can share a preview without restarting it, with a manual play fallback', async t => {
  const elements = new Map();
  const form = { addEventListener: (_type, callback) => { form.submit = callback; } };
  const preview = new EventTarget();
  let sourceWrites = 0;
  let source;
  Object.defineProperty(preview, 'src', {
    get: () => source,
    set: value => { source = value; sourceWrites++; }
  });
  preview.paused = true;
  preview.play = async () => {};
  let blockAutoplay = true;
  const play = t.mock.method(preview, 'play', async () => {
    if (blockAutoplay) {
      blockAutoplay = false;
      throw new DOMException('Autoplay blocked', 'NotAllowedError');
    }
    preview.paused = false;
    preview.dispatchEvent(new Event('playing'));
  });
  elements.set('backgroundMusicForm', form);
  elements.set('backgroundTrackQuery', { value: '  TiTlE & Artist ' });
  elements.set('backgroundAudio', preview);
  elements.set('backgroundPlayToggle', { addEventListener() {}, setAttribute() {} });
  elements.set('backgroundVolume', { addEventListener() {}, valueAsNumber: 0.45 });
  elements.set('backgroundTrack', {});
  const status = {};
  elements.set('backgroundMusicStatus', status);
  const globals = {
    window: {}, document: { getElementById: id => elements.get(id) }, location: { href: 'http://localhost/' },
    cancelAnimationFrame() {}, customAudioEl: new EventTarget(), stopAmbientSynth() {},
    updateModalPlayerUI() {}, isPlayingAmbient: false
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : Reflect.deleteProperty(globalThis, key));
  }
  const fetch = t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, json: async () => ({ title: 'Title', artist: 'Artist', url })
  }));
  await import('./background-music.js');
  const background = window.backgroundMusic;

  await form.submit({ preventDefault() {} });
  assert.equal(status.textContent, 'Press Play to start the audio.');
  background.toggle();
  assert.equal(background.playing, true);
  assert.equal(preview.loop, true);

  const match = await background.findPreview('TITLE & ARTIST');
  background.playPreview(match);
  assert.equal(fetch.mock.calls[0].arguments[0], fetch.mock.calls[1].arguments[0]);
  assert.equal(sourceWrites, 1);
  assert.equal(play.mock.callCount(), 2);
  assert.equal(background.title, 'Title — Artist');
});
