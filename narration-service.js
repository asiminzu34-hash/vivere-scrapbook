const MAX_TEXT = 600;
const MAX_AUDIO = 1024 * 1024;
const DELIVERY = {
  bright: {
    speed: 1.08, openaiVoice: 'shimmer', elevenlabsVoice: 'cgSgspJ2msm6clMCkdW9', stability: 0.43,
    note: 'Bright and gently upbeat, with a smile in your voice and a light, lively rhythm.'
  },
  quiet: {
    speed: 0.85, openaiVoice: 'onyx', elevenlabsVoice: 'onwK4e9ZLuTAKqWW03F9', stability: 0.65,
    note: 'Quiet and reflective, with a low, measured register and room for silence, without whispering.'
  },
  warm: {
    speed: 0.94, openaiVoice: 'coral', elevenlabsVoice: 'EXAVITQu4vr4xnSDxMaL', stability: 0.5,
    note: 'Warm, intimate and conversational, as if sharing a memory with a friend.'
  }
};

function voiceOverride(env, key, persona) {
  return env[`${key}_${persona.toUpperCase()}`]?.trim() || env[key]?.trim();
}

function providerConfig(env) {
  const openai = env.OPENAI_API_KEY?.trim();
  const elevenlabs = env.ELEVENLABS_API_KEY?.trim();
  const provider = env.NARRATION_PROVIDER?.trim().toLowerCase() || (openai ? 'openai' : 'elevenlabs');
  if (provider === 'openai' && openai) {
    const model = env.OPENAI_TTS_MODEL?.trim() || 'gpt-4o-mini-tts';
    return {
      provider, model,
      request: (text, persona, delivery) => ({
        url: 'https://api.openai.com/v1/audio/speech',
        headers: { Authorization: `Bearer ${openai}` },
        body: {
          model, voice: voiceOverride(env, 'OPENAI_TTS_VOICE', persona) || delivery.openaiVoice, input: text,
          response_format: 'mp3', speed: delivery.speed,
          // The legacy tts-1 and tts-1-hd models do not accept instructions.
          ...(!/^tts-1(?:-|$)/.test(model) && {
            instructions: `Read the input verbatim in natural English, like a voiceover for a personal film. ${delivery.note} Pause briefly between clauses.`
          })
        }
      })
    };
  }
  if (provider === 'elevenlabs' && elevenlabs) {
    const model = env.ELEVENLABS_MODEL_ID?.trim() || 'eleven_multilingual_v2';
    return {
      provider, model,
      request: (text, persona, delivery) => {
        const voice = voiceOverride(env, 'ELEVENLABS_VOICE_ID', persona) || delivery.elevenlabsVoice;
        return {
          url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
          headers: { 'xi-api-key': elevenlabs },
          body: {
            text, model_id: model,
            voice_settings: { stability: delivery.stability, similarity_boost: 0.75, speed: delivery.speed }
          }
        };
      }
    };
  }
  return null;
}

// Mount after a small JSON parser; the provider selection and credentials stay on the server.
export function createNarrationHandler({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 4500 } = {}) {
  const provider = providerConfig(env);
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!provider) return res.status(204).end();
    const { text, mood } = req.body || {};
    if (typeof text !== 'string' || text.length > MAX_TEXT || !text.trim()) {
      return res.status(400).json({ error: `Narration needs 1–${MAX_TEXT} characters.` });
    }
    const persona = typeof mood === 'string' && Object.hasOwn(DELIVERY, mood) ? mood : 'warm';
    const request = new AbortController();
    const abort = () => request.abort();
    res.once('close', abort);
    const deadline = setTimeout(abort, timeoutMs);
    try {
      const { url, headers, body } = provider.request(text.trim(), persona, DELIVERY[persona]);
      const response = await fetchImpl(url, {
        method: 'POST', signal: request.signal, redirect: 'error',
        headers: { ...headers, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify(body)
      });
      if (!response.ok || !/^audio\/mpeg(?:\s*;|$)/i.test(response.headers.get('content-type') || '') || !response.body) {
        throw new Error('Invalid speech response');
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > MAX_AUDIO) throw new Error('Speech response too large');
        chunks.push(chunk);
      }
      if (!size || request.signal.aborted) throw new Error('No speech audio');
      if (!res.destroyed) {
        res.set('X-Narration-Persona', persona);
        res.set('X-Narration-Provider', provider.provider);
        res.set('X-Narration-Model', provider.model);
        res.type('audio/mpeg').send(Buffer.concat(chunks, size));
      }
    } catch {
      if (!res.destroyed) res.status(503).json({ error: 'Cloud narration is unavailable.' });
    } finally {
      clearTimeout(deadline);
      res.off('close', abort);
      request.abort();
    }
  };
}
