import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { generateAtmosphere } from './atmosphere-service.js';
import { DEFAULT_ATMOSPHERE } from './atmosphere-style.js';
import { ensureReelCopy, localReelCopy, resolveReelCopy } from './reel-copy.js';
import { createBeatMeter, createNarration, pickEnglishVoice, voiceProfile } from './reel-audio.js';
import { reelTiming } from './reel-renderer.js';

const story = 'We were playing UNO cards with my best friend late into the night.';
const english = s => s.match(/\b[\w'-]+\b/g)?.length || 0;

test('local reel copy uses the story without leaking a truncated prompt', () => {
  const copy = localReelCopy({ story });
  assert.equal(copy.title, 'Late Night UNO & Laughter');
  assert.ok(copy.captions.some(caption => caption.includes('round')));
  assert.ok(english(copy.voiceover) >= 12 && english(copy.voiceover) <= 24);
  assert.doesNotMatch(JSON.stringify(copy), /we were playing|\.\.\.|…/i);
  assert.equal(localReelCopy({ story: 'Fue el cumpleaños de mi amiga' }).title, 'A Birthday in Bloom');
});

test('invalid model copy falls back and old fragments are repaired without overriding edited titles', () => {
  const bad = { title: 'We were playing UNO', captions: ['We were playing UNO', 'Yes'], voiceover: 'Not a script...' };
  assert.deepEqual(resolveReelCopy(bad, { story }), localReelCopy({ story }));
  const old = ensureReelCopy({ title: 'We were playing UNO cards wi...', journal_entry: story });
  assert.equal(old.title, 'Late Night UNO & Laughter');
  assert.equal(ensureReelCopy({ title: 'My personal photo album, volume one', journal_entry: story }).title, 'My personal photo album, volume one');
});

test('text-only atmosphere generation returns validated reel copy when requested', async () => {
  const copy = { title: 'Cards Under Moonlight', captions: ['Hands across the table', 'A small celebration', 'Still feels like home'], voiceover: 'The room felt warmer with everyone there. I still think about that feeling when the night gets quiet.' };
  const result = await generateAtmosphere({ story, includeCopy: true }, prompt => {
    assert.match(prompt, /Write in English/);
    return JSON.stringify({ style: DEFAULT_ATMOSPHERE, copy });
  });
  assert.deepEqual(result, { style: DEFAULT_ATMOSPHERE, source: 'ai', copy });
  assert.equal((await generateAtmosphere({ story, includeCopy: true })).copy.title, 'Late Night UNO & Laughter');
});

test('timeline includes all photos, loops seamlessly and gives one photo three cuts', () => {
  for (let i = 0; i < 6; i++) assert.equal(reelTiming(i * 5, 30, 6).photoIndex, i);
  assert.equal(reelTiming(30, 30, 6).photoIndex, 0);
  const end = reelTiming(29.9, 30, 6);
  assert.equal(end.nextPhotoIndex, 0);
  assert.ok(end.dissolve > 0.9);
  assert.equal(reelTiming(8, 15, 1).sceneCount, 3);
  assert.equal(reelTiming(8, 15, 1).photoIndex, 0);
  assert.equal(reelTiming(1, 15, 0).photoIndex, -1);
});

test('narration prioritizes natural English voices, matches mood and ducks only during delivery', () => {
  const natural = { name: 'Microsoft Ava Online (Natural)', lang: 'en-US' };
  const voices = [{ name: 'Spanish Natural', lang: 'es-ES' }, { name: 'Basic', lang: 'en-US', default: true }, natural];
  assert.equal(pickEnglishVoice(voices, 'en-US'), natural);
  assert.equal(pickEnglishVoice(voices.slice(0, 1), 'en-US'), null);
  const upbeat = voiceProfile({ atmosphereStyle: { effects: { texture: 'sparkles' } } });
  const quiet = voiceProfile({ atmosphereStyle: { effects: { texture: 'rain' } } });
  assert.ok(upbeat.rate > quiet.rate && upbeat.pitch > quiet.pitch);
  let speaking, level, cancelled = 0;
  const narrator = createNarration({
    synth: { getVoices: () => voices, speak: value => { speaking = value; }, pause() {}, resume() {}, cancel() { cancelled++; } },
    Utterance: class { constructor(text) { this.text = text; } }, duck: value => { level = value; }, report() {}
  });
  assert.ok(narrator.speak('A brief English story.', upbeat));
  assert.equal(level, false);
  assert.equal(speaking.voice, natural);
  speaking.onstart();
  assert.equal(level, true);
  narrator.pause();
  assert.equal(level, false);
  narrator.resume();
  assert.equal(level, true);
  const prior = speaking;
  narrator.stop();
  prior.onstart();
  assert.equal(level, false);
  assert.equal(cancelled, 1);
});

test('auto and manual narration personas select distinct rates and browser voices', t => {
  const quiet = voiceProfile({ atmosphereStyle: { mood: 'Noir', effects: { texture: 'sparkles' } } });
  const warm = voiceProfile({ mood: 'sad' }, 'warm');
  const bright = voiceProfile({ mood: 'joy' });
  assert.deepEqual([quiet.mood, warm.mood, bright.mood], ['quiet', 'warm', 'bright']);
  assert.deepEqual([quiet.rate, warm.rate, bright.rate], [0.85, 0.94, 1.08]);
  assert.equal(voiceProfile({ mood: 'joy' }, 'quiet').mood, 'quiet');
  const voices = [
    { name: 'Microsoft Sonia Online (Natural)', lang: 'en-GB', default: true },
    { name: 'Microsoft Ryan Online (Natural)', lang: 'en_GB' },
    { name: 'Microsoft Ava Online (Natural)', lang: 'en-US' },
    { name: 'Ava Premium', lang: 'es-ES' }
  ];
  const utterances = [];
  const { narrator, messages } = narrationFixture(t, {
    synth: { getVoices: () => voices, speak: utterance => utterances.push(utterance), cancel() {} }
  });
  for (const [profile, voice] of [[quiet, voices[1]], [warm, voices[0]], [bright, voices[2]]]) {
    narrator.speak('A brief English story', profile);
    const utterance = utterances.at(-1);
    assert.equal(utterance.voice, voice);
    assert.equal(utterance.rate, profile.rate);
    utterance.onstart();
    assert.deepEqual(messages.at(-1), [voice.name, { source: 'browser', persona: profile.mood, voice: voice.name }]);
  }
});

const Utterance = class { constructor(text) { this.text = text; } };
const clip = (metadata = {}) => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg', ...metadata } });
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

function narrationFixture(t, options = {}) {
  const utterances = [], players = [], levels = [], messages = [];
  const synth = { getVoices: () => [], speak: value => utterances.push(value), pause() {}, resume() {}, cancel() {} };
  const narrator = createNarration({
    synth, Utterance, duck: value => levels.push(value), report: (...args) => messages.push(args),
    createAudio: () => {
      const audio = {
        plays: 0, pauses: 0,
        play() { this.plays++; return options.play?.(); },
        pause() { this.pauses++; },
        removeAttribute(key) { delete this[key]; }, load() {}
      };
      players.push(audio);
      return audio;
    },
    ...options
  });
  t.after(() => narrator.reset());
  return { narrator, utterances, players, levels, messages };
}

test('browser narration varies phrases and preserves the break while paused', async t => {
  const { narrator, utterances, levels } = narrationFixture(t);
  const text = 'It was getting late, but nobody wanted to leave.';
  narrator.speak(text, voiceProfile());
  assert.equal(utterances[0].text, 'It was getting late,');
  utterances[0].onstart();
  utterances[0].onend();
  assert.equal(levels.at(-1), false);
  narrator.pause();
  await delay(300);
  assert.equal(utterances.length, 1);
  narrator.resume();
  assert.equal(utterances.length, 1);
  await delay(300);
  assert.equal(utterances[1].text, 'but nobody wanted to leave.');
  assert.ok(utterances[1].rate < utterances[0].rate);
  assert.ok(utterances[1].pitch < utterances[0].pitch);
  utterances[1].onend();
  assert.equal(narrator.active, false);
});

test('a disabled endpoint or provider failure falls back and does not retry the same reel each loop', async t => {
  for (const status of [204, 503]) {
    let calls = 0;
    const { narrator, utterances } = narrationFixture(t, { fetchAudio: async () => {
      calls++;
      return new Response(null, { status });
    } });
    narrator.speak('First story.', voiceProfile());
    await nextTurn();
    assert.equal(utterances[0].text, 'First story.');
    narrator.speak('First story.', voiceProfile());
    assert.equal(utterances[1].text, 'First story.');
    assert.equal(calls, 1);
    narrator.reset();
    narrator.speak('Another story.', voiceProfile());
    await nextTurn();
    assert.equal(calls, status === 204 ? 1 : 2);
  }
});

test('a stale browser error cannot interrupt a retry with the default voice', t => {
  const utterances = [];
  const { narrator } = narrationFixture(t, {
    synth: {
      getVoices: () => [{ name: 'Samantha', lang: 'en-US' }],
      speak: utterance => utterances.push(utterance), cancel() {}
    }
  });
  narrator.speak('First story.', voiceProfile());
  const first = utterances[0];
  first.onerror({ error: 'voice-unavailable' });
  assert.equal(utterances.length, 2);
  assert.equal(utterances[1].voice, undefined);
  first.onerror({ error: 'interrupted' });
  assert.equal(narrator.active, true);
  utterances[1].onend();
  assert.equal(narrator.active, false);
});

test('studio audio waits for resume, ducks only while playing, and revokes object URLs', async t => {
  let calls = 0;
  const { narrator, players, levels, messages } = narrationFixture(t, { fetchAudio: async (url, init) => {
    assert.equal(url, '/api/narration');
    const { text, mood } = JSON.parse(init.body);
    assert.equal(text, 'First story.');
    assert.equal(mood, calls++ === 0 ? 'bright' : 'quiet');
    return clip({ 'X-Narration-Persona': mood, 'X-Narration-Provider': 'openai', 'X-Narration-Model': 'gpt-4o-mini-tts' });
  } });
  const bright = voiceProfile({}, 'bright');
  const cloudReport = ['AI studio voice', { source: 'cloud', persona: 'bright', provider: 'openai', model: 'gpt-4o-mini-tts' }];
  narrator.speak('First story.', bright);
  narrator.pause();
  await nextTurn();
  assert.equal(players.length, 0);
  narrator.resume();
  const [audio] = players;
  const url = audio.src;
  assert.equal(audio.plays, 1);
  assert.equal(levels.at(-1), false);
  audio.onplaying();
  assert.equal(levels.at(-1), true);
  assert.deepEqual(messages.at(-1), cloudReport);
  narrator.pause();
  assert.equal(audio.pauses, 1);
  assert.equal(levels.at(-1), false);
  narrator.resume();
  assert.equal(audio.plays, 2);
  assert.equal(levels.at(-1), false);
  const stalePlaying = audio.onplaying;
  audio.onended();
  stalePlaying();
  assert.equal(levels.at(-1), false);
  await assert.rejects(fetch(url));
  narrator.speak('First story.', bright);
  assert.equal(players.length, 2);
  players[1].onplaying();
  assert.deepEqual(messages.at(-1), cloudReport);
  assert.equal(calls, 1);
  narrator.speak('First story.', voiceProfile({}, 'quiet'));
  await nextTurn();
  assert.equal(players.length, 3);
  assert.equal(calls, 2);
  players[2].onplaying();
  assert.equal(messages.at(-1)[1].persona, 'quiet');
});

test('stopping a pending studio request aborts it and ignores its eventual completion', async t => {
  let finish, signal;
  const { narrator, players, utterances } = narrationFixture(t, { fetchAudio: (_, init) => {
    signal = init.signal;
    return new Promise(resolve => { finish = resolve; });
  } });
  narrator.speak('First story.', voiceProfile());
  narrator.stop();
  assert.equal(signal.aborted, true);
  finish(clip());
  await nextTurn();
  assert.equal(players.length + utterances.length, 0);
});

test('autoplay rejection falls back to Web Speech without losing the clip for Restart', async t => {
  let calls = 0, attempts = 0;
  const { narrator, players, utterances } = narrationFixture(t, {
    fetchAudio: async () => { calls++; return clip(); },
    play: () => { if (!attempts++) return Promise.reject(new DOMException('Blocked', 'NotAllowedError')); }
  });
  narrator.speak('First story.', voiceProfile());
  await nextTurn();
  assert.equal(utterances[0].text, 'First story.');
  assert.equal(players[0].src, undefined);
  narrator.speak('First story.', voiceProfile());
  assert.equal(players[1].plays, 1);
  assert.equal(calls, 1);
});

test('bass onsets produce a short pulse and silence releases it', () => {
  let level = 0;
  const context = { sampleRate: 48000, createAnalyser: () => ({ frequencyBinCount: 512, getByteFrequencyData: bins => bins.fill(level) }) };
  const sample = createBeatMeter(context, { connect() {} });
  assert.equal(sample(0), 0);
  level = 150;
  assert.equal(sample(440), 1);
  level = 0;
  assert.ok(sample(640) < 0.25);
});
