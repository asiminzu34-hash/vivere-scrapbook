import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createNarrationHandler } from './narration-service.js';

function response() {
  return Object.assign(new EventEmitter(), {
    set(key, value) { this[key] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    type(value) { this.mime = value; return this; },
    send(value) { this.body = value; return this; },
    json(value) { return this.send(value); },
    end() { return this; }
  });
}

const mp3 = () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } });

test('disabled and invalid requests do not contact a speech provider', async () => {
  let calls = 0;
  const fetchImpl = () => { calls++; };
  const disabled = response();
  await createNarrationHandler({ env: {}, fetchImpl })({ body: { text: 'A story.' } }, disabled);
  assert.equal(disabled.statusCode, 204);
  const handler = createNarrationHandler({ env: { OPENAI_API_KEY: 'mock-key' }, fetchImpl });
  for (const text of ['', ' '.repeat(4), 42, 'A'.repeat(601)]) {
    const invalid = response();
    await handler({ body: { text } }, invalid);
    assert.equal(invalid.statusCode, 400);
  }
  assert.equal(calls, 0);
});

test('OpenAI uses the speech API, a bounded mood preset and a server-side key', async () => {
  let request;
  const res = response();
  const handler = createNarrationHandler({
    env: { OPENAI_API_KEY: 'mock-openai', ELEVENLABS_API_KEY: 'mock-eleven', OPENAI_TTS_VOICE: 'marin' },
    fetchImpl: async (...args) => { request = args; return mp3(); }
  });
  await handler({ body: { text: ' A story. ', mood: 'quiet' } }, res);
  const [url, init] = request;
  assert.equal(url, 'https://api.openai.com/v1/audio/speech');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer mock-openai');
  const body = JSON.parse(init.body);
  assert.equal(body.input, 'A story.');
  assert.equal(body.model, 'gpt-4o-mini-tts');
  assert.equal(body.voice, 'marin');
  assert.equal(body.response_format, 'mp3');
  assert.equal(body.speed, 0.85);
  assert.match(body.instructions, /Quiet and reflective/);
  assert.equal(res.mime, 'audio/mpeg');
  assert.equal(res['Cache-Control'], 'no-store');
  assert.equal(res['X-Narration-Persona'], 'quiet');
  assert.equal(res['X-Narration-Provider'], 'openai');
  assert.equal(res['X-Narration-Model'], body.model);
  assert.deepEqual(res.body, Buffer.from([1, 2, 3]));
});

test('ElevenLabs selection sends voice ID, API key and proper MP3 format', async () => {
  let request;
  const res = response();
  const handler = createNarrationHandler({
    env: { NARRATION_PROVIDER: 'elevenlabs', OPENAI_API_KEY: 'unused', ELEVENLABS_API_KEY: 'mock-eleven', ELEVENLABS_VOICE_ID: 'test-voice' },
    fetchImpl: async (...args) => { request = args; return mp3(); }
  });
  await handler({ body: { text: 'A story.', mood: 'unknown mood' } }, res);
  const [url, init] = request;
  assert.equal(url, 'https://api.elevenlabs.io/v1/text-to-speech/test-voice?output_format=mp3_44100_128');
  assert.equal(init.headers['xi-api-key'], 'mock-eleven');
  assert.equal(JSON.parse(init.body).model_id, 'eleven_multilingual_v2');
  assert.equal(JSON.parse(init.body).voice_settings.speed, 0.94);
  assert.equal(res.mime, 'audio/mpeg');
  assert.equal(res['X-Narration-Persona'], 'warm');
  assert.equal(res['X-Narration-Provider'], 'elevenlabs');
  assert.equal(res['X-Narration-Model'], 'eleven_multilingual_v2');
});

async function generate(env, mood) {
  let request;
  const res = response();
  const handler = createNarrationHandler({ env, fetchImpl: async (url, init) => {
    request = { url: new URL(url), body: JSON.parse(init.body) };
    return mp3();
  } });
  await handler({ body: { text: 'A story.', mood, voice: 'untrusted', model: 'untrusted' } }, res);
  assert.equal(res.mime, 'audio/mpeg');
  return { ...request, res };
}

test('both providers have distinct defaults for all three personas', async () => {
  const openaiVoices = new Set(), elevenLabsVoices = new Set(), instructions = new Set(), stability = new Set();
  for (const [mood, speed] of [['quiet', 0.85], ['warm', 0.94], ['bright', 1.08]]) {
    const openai = await generate({ OPENAI_API_KEY: 'mock-openai' }, mood);
    const elevenlabs = await generate({ ELEVENLABS_API_KEY: 'mock-eleven' }, mood);
    assert.equal(openai.res['X-Narration-Persona'], mood);
    assert.equal(elevenlabs.res['X-Narration-Persona'], mood);
    assert.equal(openai.body.speed, speed);
    assert.equal(elevenlabs.body.voice_settings.speed, speed);
    assert.notEqual(openai.body.voice, 'untrusted');
    assert.notEqual(openai.body.model, 'untrusted');
    openaiVoices.add(openai.body.voice);
    elevenLabsVoices.add(elevenlabs.url.pathname.split('/').at(-1));
    instructions.add(openai.body.instructions);
    stability.add(elevenlabs.body.voice_settings.stability);
  }
  for (const values of [openaiVoices, elevenLabsVoices, instructions, stability]) assert.equal(values.size, 3);
});

test('persona voice overrides take priority over global overrides without changing persona metadata', async () => {
  const openaiEnv = {
    OPENAI_API_KEY: 'mock-openai', OPENAI_TTS_MODEL: ' tts-1-hd ',
    OPENAI_TTS_VOICE: ' coral ', OPENAI_TTS_VOICE_QUIET: ' onyx ', OPENAI_TTS_VOICE_BRIGHT: '  '
  };
  const quiet = await generate(openaiEnv, 'quiet');
  const bright = await generate(openaiEnv, 'bright');
  assert.equal(quiet.body.voice, 'onyx');
  assert.equal(bright.body.voice, 'coral');
  assert.equal(quiet.body.model, 'tts-1-hd');
  assert.equal(quiet.body.instructions, undefined);
  assert.equal(quiet.res['X-Narration-Model'], quiet.body.model);
  assert.equal(quiet.res['X-Narration-Persona'], 'quiet');

  const elevenlabsEnv = {
    ELEVENLABS_API_KEY: 'mock-eleven', ELEVENLABS_MODEL_ID: ' eleven_turbo_v2_5 ',
    ELEVENLABS_VOICE_ID: ' global ', ELEVENLABS_VOICE_ID_BRIGHT: ' specific/voice '
  };
  const elevenBright = await generate(elevenlabsEnv, 'bright');
  const elevenWarm = await generate(elevenlabsEnv, 'constructor');
  assert.equal(elevenBright.url.pathname, '/v1/text-to-speech/specific%2Fvoice');
  assert.equal(elevenWarm.url.pathname, '/v1/text-to-speech/global');
  assert.equal(elevenBright.body.model_id, 'eleven_turbo_v2_5');
  assert.equal(elevenBright.res['X-Narration-Model'], elevenBright.body.model_id);
  assert.equal(elevenBright.res['X-Narration-Persona'], 'bright');
  assert.equal(elevenWarm.res['X-Narration-Persona'], 'warm');
});

test('provider deadlines and invalid responses return a generic fallback status', async () => {
  const env = { OPENAI_API_KEY: 'mock-openai' };
  const req = { body: { text: 'A story.' } };
  const deadline = response();
  await createNarrationHandler({
    env, timeoutMs: 10,
    fetchImpl: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
  })(req, deadline);
  assert.equal(deadline.statusCode, 503);
  for (const bad of [
    new Response('Private provider detail', { status: 401 }),
    new Response(new Uint8Array(1024 * 1024 + 1), { headers: { 'Content-Type': 'audio/mpeg' } })
  ]) {
    const res = response();
    await createNarrationHandler({ env, fetchImpl: async () => bad })(req, res);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, deadline.body);
    assert.equal(res['X-Narration-Model'], undefined);
  }
});
