import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryForStorage, memorySoundtrackLabel, previewSoundtrack, resolveMemoryAudio, saveMemoryAudio, soundtrackForShare } from './memory-audio.js';

const previewUrl = '/api/preview?u=exact';
const match = { title: 'Track (Live)', artist: 'The Artist', query: 'track', url: previewUrl, label: 'Track (Live) — The Artist' };

function fakeIndexedDB(t) {
  const rows = new Map();
  let initialized = false;
  let failWrites = false;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
    open(name, version) {
      assert.equal(name, 'vivere-memory-audio');
      assert.equal(version, 1);
      const result = {
        createObjectStore(name) { assert.equal(name, 'blobs'); },
        close() {},
        transaction(name, mode) {
          assert.equal(name, 'blobs');
          const tx = {
            objectStore() {
              return {
                add(value, key) {
                  assert.equal(mode, 'readwrite');
                  const request = {};
                  queueMicrotask(() => {
                    if (failWrites) {
                      tx.error = new Error('Quota exceeded');
                      tx.onabort();
                    } else {
                      rows.set(key, structuredClone(value));
                      tx.oncomplete();
                    }
                  });
                  return request;
                },
                get(key) {
                  assert.equal(mode, 'readonly');
                  const request = {};
                  queueMicrotask(() => {
                    request.result = rows.get(key);
                    tx.oncomplete();
                  });
                  return request;
                }
              };
            }
          };
          return tx;
        }
      };
      const request = { result };
      queueMicrotask(() => {
        if (!initialized) request.onupgradeneeded();
        initialized = true;
        request.onsuccess();
      });
      return request;
    }
  } });
  t.after(() => descriptor ? Object.defineProperty(globalThis, 'indexedDB', descriptor) : Reflect.deleteProperty(globalThis, 'indexedDB'));
  return { rows, failWrites: () => { failWrites = true; } };
}

test('exact preview survives JSON storage and share without a fresh search or AI relabeling', async t => {
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected lookup'); });
  const soundtrack = previewSoundtrack(match);
  const copy = JSON.parse(JSON.stringify(memoryForStorage({ soundtrack, audioUrl: 'blob:old', ai: { song: { title: 'Wrong' } } })));
  assert.deepEqual(copy.soundtrack, { kind: 'preview', title: match.title, artist: match.artist, query: match.query, url: previewUrl });
  assert.equal(copy.audioUrl, undefined);
  assert.equal(memorySoundtrackLabel(copy), match.label);
  assert.deepEqual(await soundtrackForShare(copy), copy.soundtrack);
  const resolved = await resolveMemoryAudio(copy);
  assert.equal(resolved.url, previewUrl);
  resolved.release();
  assert.equal(network.mock.callCount(), 0);
});

test('local uploads reopen from IndexedDB, and each caller owns its object URL', async t => {
  const storage = fakeIndexedDB(t);
  const blob = new Blob(['persisted audio'], { type: 'audio/mpeg' });
  const soundtrack = await saveMemoryAudio(blob, 'Home recording');
  const saved = JSON.parse(JSON.stringify(memoryForStorage({ soundtrack, audioUrl: 'blob:old' })));
  assert.equal(saved.audioUrl, undefined);
  assert.equal(storage.rows.get(soundtrack.blobId).size, blob.size);
  const revoke = t.mock.method(URL, 'revokeObjectURL');
  const [one, two] = await Promise.all([resolveMemoryAudio(saved), resolveMemoryAudio(saved)]);
  assert.notEqual(one.url, two.url);
  assert.equal(await (await fetch(one.url)).text(), 'persisted audio');
  one.release();
  one.release();
  await assert.rejects(fetch(one.url));
  assert.equal(await (await fetch(two.url)).text(), 'persisted audio');
  two.release();
  assert.equal(revoke.mock.callCount(), 2);
  storage.rows.clear();
  assert.equal(await resolveMemoryAudio(saved), null);
  assert.equal((await resolveMemoryAudio({ soundtrack: { ...soundtrack, url: '/api/audio/0123456789.mp3' } })).url, '/api/audio/0123456789.mp3');
  storage.failWrites();
  await assert.rejects(saveMemoryAudio(blob, 'New recording'), /Quota exceeded/);
});

test('sharing uploads stored bytes, not a browser-local URL or blob ID', async t => {
  fakeIndexedDB(t);
  const soundtrack = await saveMemoryAudio(new Blob(['audio'], { type: 'audio/mpeg' }), 'Recording');
  const url = '/api/audio/0123456789.mp3';
  const upload = t.mock.method(globalThis, 'fetch', async (endpoint, options) => {
    assert.equal(endpoint, '/api/audio');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'audio/mpeg');
    assert.equal(await options.body.text(), 'audio');
    return { ok: true, json: async () => ({ url }) };
  });
  const shared = await soundtrackForShare({ soundtrack });
  assert.deepEqual(shared, { kind: 'upload', title: 'Recording', artist: 'Custom Audio', url });
  assert.equal((await resolveMemoryAudio({ soundtrack: shared })).url, url);
  assert.deepEqual(await soundtrackForShare({ soundtrack: { ...soundtrack, url } }), shared);
  assert.equal(upload.mock.callCount(), 1);
  upload.mock.mockImplementation(async () => ({ ok: true, json: async () => ({ url: '/api/audio/id.{ext}' }) }));
  await assert.rejects(soundtrackForShare({ soundtrack }), /Invalid shared soundtrack URL/);
});

test('legacy memories resolve a saved remote URL or search only their own saved query', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => match }));
  const upload = '/api/audio/0123456789.mp3';
  const memory = { ai: { audio_url: upload, song: { title: 'Recording' } } };
  assert.equal((await resolveMemoryAudio(memory)).url, upload);
  assert.equal((await soundtrackForShare(memory)).url, upload);
  assert.equal(memoryForStorage({ audioUrl: upload }).audioUrl, upload);
  assert.equal(await resolveMemoryAudio({ ai: { song: { title: 'No source' } } }), null);
  assert.equal(await resolveMemoryAudio({ soundtrack: { kind: 'ambient' }, previewQuery: 'ignored' }), null);
  assert.equal(await resolveMemoryAudio({ previewQuery: 'ignored' }, { signal: AbortSignal.abort() }), null);
  assert.equal((await resolveMemoryAudio({ previewQuery: ' Track ' })).url, previewUrl);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(fetch.mock.calls[0].arguments[0], '/api/music?q=track');
});

test('studio reuses an already playing preview, isolates another soundtrack, then resumes the toolbar', async t => {
  class Player extends EventTarget {
    paused = true;
    plays = 0;
    urlWrites = 0;
    get src() { return this.url; }
    set src(url) { this.url = url; this.urlWrites++; }
    play() { this.paused = false; this.plays++; return Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute() { delete this.url; }
    load() {}
  }
  const preview = new Player();
  const custom = new Player();
  const elements = { backgroundAudio: preview };
  const globals = {
    window: {}, location: { href: 'https://vivere.test/' },
    document: { getElementById: id => (elements[id] ??= { setAttribute() {}, addEventListener() {}, valueAsNumber: 0.45 }) },
    customAudioEl: custom, cancelAnimationFrame() {}, stopAmbientSynth() {}, updateModalPlayerUI() {}, isPlayingAmbient: false
  };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key));
  }
  await import('./background-music.js');
  const music = window.backgroundMusic;
  music.playPreview(match);
  assert.deepEqual(music.soundtrack, previewSoundtrack(match));
  music.beginStudio(previewUrl);
  assert.equal(music.useStudioAudio(previewUrl), preview);
  music.endStudio();
  assert.equal(preview.plays, 1);
  assert.equal(preview.urlWrites, 1);

  music.beginStudio();
  assert.equal(preview.paused, true);
  assert.equal(music.element, null);
  assert.equal(music.useStudioAudio('blob:local'), custom);
  await custom.play();
  assert.equal(music.element, custom);
  music.endStudio();
  assert.equal(custom.paused, true);
  assert.equal(custom.src, undefined);
  assert.equal(music.element, preview);
  assert.equal(preview.plays, 2);
  assert.equal(preview.urlWrites, 1);

  music.toggle();
  assert.equal(preview.paused, true);
  music.beginStudio(previewUrl);
  await music.useStudioAudio(previewUrl).play();
  music.endStudio();
  assert.equal(preview.paused, true);
});
