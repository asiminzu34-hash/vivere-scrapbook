const PROFILES = {
  quiet: { label: 'Quiet & reflective', lang: 'en-GB', rate: 0.85, pitch: 0.88 },
  warm: { label: 'Soft & warm', lang: 'en-GB', rate: 0.94, pitch: 0.99 },
  bright: { label: 'Bright & upbeat', lang: 'en-US', rate: 1.08, pitch: 1.10 }
};

export function voiceProfile(ai = {}, selection = 'auto') {
  const { atmosphereStyle: style } = ai;
  const clues = `${style?.mood || ''} ${style?.vibe || ''} ${ai.mood || ''} ${typeof ai.vibe === 'string' ? ai.vibe : ''}`;
  const texture = style?.effects?.texture;
  let mood = selection;
  if (!Object.hasOwn(PROFILES, mood)) {
    if (/\b(?:noir|sad|quiet|moody|melanchol\w*|midnight|somber|sombre|dark)\b/i.test(clues)) mood = 'quiet';
    else if (/\b(?:celebrat\w*|joy\w*|happy|playful|energetic|vivid|bright)\b/i.test(clues)) mood = 'bright';
    else mood = texture === 'rain' ? 'quiet' : texture === 'sparkles' ? 'bright' : 'warm';
  }
  return { mood, ...PROFILES[mood] };
}

const PREFERRED_VOICES = {
  quiet: ['daniel', 'ryan', 'guy'],
  warm: ['sonia', 'samantha', 'moira'],
  bright: ['ava', 'aria', 'jenny', 'karen']
};
const KNOWN_VOICES = Object.values(PREFERRED_VOICES).flat();
const normalizeLang = lang => lang.toLowerCase().replaceAll('_', '-');

export function pickEnglishVoice(voices, lang, mood) {
  const preferred = Object.hasOwn(PREFERRED_VOICES, mood) ? PREFERRED_VOICES[mood] : [];
  const score = voice => {
    const name = (voice.name || '').toLowerCase();
    const words = name.match(/[a-z]+/g) || [];
    const premium = /natural|neural|enhanced|premium|microsoft.*online|google.*english|siri/.test(name);
    const rank = preferred.findIndex(candidate => words.includes(candidate));
    const known = KNOWN_VOICES.some(candidate => words.includes(candidate));
    return (premium ? 20 : known ? 8 : 0) + (rank < 0 ? 0 : 12 - rank) +
      (normalizeLang(voice.lang) === normalizeLang(lang) ? 4 : 0) + (voice.default ? 1 : 0);
  };
  return voices.filter(voice => /^en(?:[-_]|$)/i.test(voice.lang))
    .sort((a, b) => score(b) - score(a))[0] || null;
}

function narrationClauses(text) {
  return text.trim().split(/(?<=[,.!?;:…][”’"']?)\s+|\s*[—–]\s*/u).filter(Boolean).flatMap(clause => {
    const words = clause.split(/\s+/);
    const parts = [];
    while (words.length > 17) {
      const conjunction = words.findIndex((word, index) => index >= 8 && index <= 14 && /^(and|but|so|because|while|when)$/i.test(word));
      parts.push(words.splice(0, conjunction < 0 ? 13 : conjunction).join(' '));
    }
    return [...parts, words.join(' ')];
  }).map(text => {
    const terminal = /[.!?…][”’"']?$/.test(text);
    return { text, pause: terminal ? 380 : /[;:][”’"']?$/.test(text) ? 320 : 260, terminal };
  });
}

export function estimateNarrationSeconds(text, profile) {
  const clauses = narrationClauses(text);
  return text.trim().split(/\s+/).length * 0.40 / profile.rate +
    clauses.slice(0, -1).reduce((sum, clause) => sum + clause.pause / 1000, 0) + 0.75;
}

export function createNarration({ synth, Utterance, fetchAudio, createAudio, duck, report }) {
  const browser = !!synth && typeof Utterance === 'function';
  const cloud = typeof fetchAudio === 'function' && typeof createAudio === 'function';
  const unavailable = 'English voice unavailable · captions only';
  const blocked = 'Press Restart to allow narration';
  let current, cached, cloudDisabled = false;

  function releaseAudio(state) {
    const { audio, url } = state;
    state.audio = state.url = null;
    if (audio) {
      audio.onplaying = audio.onwaiting = audio.onended = audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    if (url) URL.revokeObjectURL(url);
  }

  function stop() {
    const state = current;
    current = null;
    if (state) {
      clearTimeout(state.timer);
      state.request?.abort();
      releaseAudio(state);
      if (state.utterance) {
        synth.cancel();
        if (synth.paused) synth.resume();
      }
    }
    duck(false);
  }

  function fail(message) {
    stop();
    report(message);
  }

  function arm(state, ms, callback) {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => { if (current === state && !state.paused) callback(); }, ms);
  }

  function startBrowser(state, message = unavailable) {
    state.useBrowser = true;
    if (!browser) return fail(message);
    if (state.paused) return;
    if (state.gap != null) {
      state.gapStarted = performance.now();
      return arm(state, state.gap, () => {
        state.gap = null;
        startBrowser(state);
      });
    }
    const clause = state.clauses[state.index];
    const { profile } = state;
    try {
      const voice = state.useDefault ? null : pickEnglishVoice(synth.getVoices(), profile.lang, profile.mood);
      const utterance = new Utterance(clause.text);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || profile.lang;
      utterance.rate = profile.rate * (clause.terminal ? 0.96 : state.index % 2 ? 1.02 : 1);
      utterance.pitch = profile.pitch * (clause.terminal ? 0.98 : 1.02);
      state.utterance = utterance;
      state.started = false;
      const active = () => current === state && state.utterance === utterance;
      state.browserError = error => {
        if (!active()) return;
        if (voice && /voice-unavailable|language-unavailable|synthesis-unavailable|synthesis-failed/.test(error)) {
          state.utterance = null;
          state.useDefault = true;
          clearTimeout(state.timer);
          duck(false);
          synth.cancel();
          if (synth.paused) synth.resume();
          startBrowser(state);
        } else {
          fail(error === 'not-allowed' ? blocked : unavailable);
        }
      };
      utterance.onstart = () => {
        if (!active()) return;
        state.started = true;
        report(voice?.name || 'Browser English', { source: 'browser', persona: profile.mood, voice: voice?.name || null });
        if (!state.paused) {
          duck(true);
          arm(state, 28000, () => fail('Narration interrupted'));
        }
      };
      utterance.onend = () => {
        if (!active()) return;
        clearTimeout(state.timer);
        state.utterance = null;
        duck(false);
        if (++state.index === state.clauses.length) return stop();
        state.gap = clause.pause;
        startBrowser(state);
      };
      utterance.onerror = event => { if (active()) state.browserError(event.error); };
      arm(state, 4500, () => state.browserError('synthesis-unavailable'));
      synth.speak(utterance);
    } catch {
      fail(unavailable);
    }
  }

  function playAudio(state, { blob, metadata }) {
    if (state.paused) return;
    const fallback = (message = unavailable, remember = true) => {
      clearTimeout(state.timer);
      if (remember) cached = { key: state.key };
      releaseAudio(state);
      duck(false);
      startBrowser(state, message);
    };
    try {
      if (!state.audio) {
        const audio = state.audio = createAudio();
        state.url = URL.createObjectURL(blob);
        audio.src = state.url;
        const active = () => current === state && state.audio === audio;
        audio.onplaying = () => {
          if (!active() || state.paused) return;
          clearTimeout(state.timer);
          duck(true);
          report('AI studio voice', metadata);
        };
        audio.onwaiting = () => {
          if (!active() || state.paused) return;
          duck(false);
          arm(state, 2000, fallback);
        };
        audio.onended = () => { if (active()) stop(); };
        audio.onerror = () => { if (active()) fallback(); };
      }
      const audio = state.audio;
      const attempt = state.attempt = {};
      arm(state, 2000, fallback);
      Promise.resolve(audio.play()).catch(error => {
        if (current !== state || state.audio !== audio || state.attempt !== attempt || state.paused) return;
        const denied = error?.name === 'NotAllowedError';
        fallback(denied ? blocked : unavailable, !denied);
      });
    } catch {
      fallback();
    }
  }

  async function loadAudio(state) {
    const request = state.request = new AbortController();
    const timeout = setTimeout(() => request.abort(), 5500);
    let blob, metadata;
    try {
      const response = await fetchAudio('/api/narration', {
        method: 'POST', signal: request.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: state.text, mood: state.profile.mood })
      });
      if (current !== state || request.signal.aborted) return;
      if (response.status === 204 || response.status === 404) cloudDisabled = true;
      if (response.ok && /^audio\/mpeg(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
        const result = await response.blob();
        if (!request.signal.aborted && result.size) {
          blob = result;
          metadata = {
            source: 'cloud',
            persona: response.headers.get('X-Narration-Persona') || state.profile.mood,
            provider: response.headers.get('X-Narration-Provider'),
            model: response.headers.get('X-Narration-Model')
          };
        }
      }
    } catch {
      // Provider and network errors are handled by the same browser fallback.
    } finally {
      clearTimeout(timeout);
      if (current === state) {
        state.request = null;
        cached = { key: state.key, blob, metadata };
        if (blob) playAudio(state, cached);
        else startBrowser(state);
      }
    }
  }

  return {
    supported: browser || cloud,
    get active() { return !!current; },
    speak(text, profile) {
      if (!(browser || cloud) || typeof text !== 'string') return false;
      const clauses = narrationClauses(text);
      if (!clauses.length) return false;
      stop();
      const key = JSON.stringify([text, profile.mood]);
      const state = current = { key, text, profile, clauses, index: 0 };
      if (cached?.key === key && cached.blob) playAudio(state, cached);
      else if (cloud && !cloudDisabled && cached?.key !== key) {
        report('Preparing AI studio voice…');
        loadAudio(state);
      } else startBrowser(state);
      return true;
    },
    stop,
    reset() { stop(); cached = null; },
    pause() {
      const state = current;
      if (!state || state.paused) return;
      state.paused = true;
      clearTimeout(state.timer);
      if (state.audio) state.audio.pause();
      else if (state.utterance) synth.pause();
      else if (state.gap != null) state.gap = Math.max(0, state.gap - (performance.now() - state.gapStarted));
      duck(false);
    },
    resume() {
      const state = current;
      if (!state?.paused) return;
      state.paused = false;
      if (state.request) return;
      if (!state.useBrowser && cached?.key === state.key && cached.blob) playAudio(state, cached);
      else if (state.utterance) {
        if (state.started) duck(true);
        arm(state, state.started ? 28000 : 4500, () => {
          if (state.started) fail('Narration interrupted');
          else state.browserError('synthesis-unavailable');
        });
        synth.resume();
      } else startBrowser(state);
    }
  };
}

// A small bass-onset envelope. No PCM reads, decoding, or network requests.
export function createBeatMeter(context, source) {
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.38;
  source.connect(analyser);
  const bins = new Uint8Array(analyser.frequencyBinCount);
  const hz = context.sampleRate / analyser.fftSize;
  const first = Math.max(1, Math.floor(45 / hz));
  const last = Math.max(first, Math.ceil(145 / hz));
  let previous = 0, baseline = 0, lastBeat = -Infinity;
  return now => {
    analyser.getByteFrequencyData(bins);
    let sum = 0;
    for (let i = first; i <= last; i++) sum += bins[i];
    const level = sum / (last - first + 1);
    if (now - lastBeat > 220 && level > Math.max(20, baseline * 1.19) && level - previous > 4) lastBeat = now;
    baseline += (level - baseline) * 0.055;
    previous = level;
    return Math.exp((lastBeat - now) / 125);
  };
}
