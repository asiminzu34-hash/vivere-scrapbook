import { localReelCopy, ensureReelCopy } from './reel-copy.js';
import { createBeatMeter, createNarration, estimateNarrationSeconds, voiceProfile } from './reel-audio.js';
import { createReelRenderer, REEL_EFFECTS } from './reel-renderer.js';

const $ = id => document.getElementById(id);
const modal = $('videoModal');
const canvas = $('reelCanvas');
const voiceButton = $('reelVoiceToggle');
const voiceBadge = $('reelVoiceBadge');
const voiceMood = $('reelVoiceMood');
const positionSlider = $('videoProgress');
const playButton = $('videoPlayPauseBtn');
const restartButton = $('videoRestartBtn');
const downloadButton = $('downloadVideoBtn');
const exportStatus = $('exportStatusText');
const effectButtons = [...document.querySelectorAll('#effectsGrid [data-fx]')];
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const formatTime = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

let pendingOpen = 0;
let reel, render, profile, record;
let preparing = false;
let duration = 15, position = 0, anchor = 0, frame, playing = false, narrationSeconds = 0;
let effect = 'film', voiceEnabled = false, narrated = false, seeking = false, lastSecond = -1;
const meters = new WeakMap();
const narration = createNarration({
  synth: window.speechSynthesis,
  Utterance: window.SpeechSynthesisUtterance,
  fetchAudio: window.fetch?.bind(window),
  createAudio: typeof window.Audio === 'function' ? () => new window.Audio() : undefined,
  duck: setNarrationDucked,
  report: (message, detail) => {
    if (!profile) return;
    const model = detail?.source === 'cloud' ? [detail.provider, detail.model, detail.persona].filter(Boolean).join(' · ') : detail?.voice;
    voiceBadge.textContent = `${profile.label} · ${model || message}`;
  }
});

function beatPulse(now) {
  if (reduced.matches || !playing) return 0;
  const player = modalMusic?.player;
  if (player && !player.paused && audioCtx?.state === 'running') {
    if (!meters.has(player)) {
      try {
        const source = getSoundtrackSource(player);
        meters.set(player, source ? createBeatMeter(audioCtx, source) : null);
      } catch { meters.set(player, null); }
    }
    return meters.get(player)?.(now) || 0;
  }
  if (isPlayingAmbient && audioCtx?.state === 'running') {
    // The built-in synth plays a four-beat bar every 2.5 seconds.
    const phase = Math.max(0, audioCtx.currentTime - ambientBeatStart) % 0.625;
    return Math.exp(-phase / 0.14);
  }
  return 0;
}

function showPosition(now = performance.now()) {
  render?.(Math.min(position, duration - 0.001), effect, { pulse: beatPulse(now), reducedMotion: reduced.matches });
  positionSlider.value = Math.round(position / duration * 1000);
  const second = Math.floor(position);
  if (second !== lastSecond) {
    lastSecond = second;
    $('videoTimeCurrent').textContent = formatTime(position);
    positionSlider.setAttribute('aria-valuetext', `${formatTime(position)} of ${formatTime(duration)}`);
  }
}

function syncButtons() {
  playButton.textContent = playing ? '❚❚ Pause' : '▶ Play';
  voiceButton.textContent = voiceEnabled ? 'Voiceover: On' : 'Voiceover: Off';
  voiceButton.setAttribute('aria-pressed', String(voiceEnabled));
  voiceMood.disabled = voiceButton.disabled = !narration.supported || !!record || preparing;
  for (const button of [playButton, restartButton, downloadButton, positionSlider, ...effectButtons]) button.disabled = !!record || preparing;
}

function showVoiceStyle() {
  voiceBadge.textContent = narration.supported ? `${profile.label} · English` : 'English voice unavailable · captions only';
}

function maybeNarrate() {
  if (!voiceEnabled || narrated || !playing || seeking || record || preparing || !reel) return;
  if (position > 0.15 && duration - position < narrationSeconds) return;
  narrated = narration.speak(reel.ai.voiceover, profile);
}

function tick(now) {
  if (!playing || !reel) return;
  position = Math.max(0, (now - anchor) / 1000);
  if (position >= duration) {
    if (record) {
      position = duration;
      showPosition(now);
      playing = false;
      if (record.recorder.state !== 'inactive') record.recorder.stop();
      return;
    }
    position %= duration;
    anchor = now - position * 1000;
    // Loading or delivering a voiceover can outlast a short reel loop.
    narrated = narration.active;
  }
  showPosition(now);
  maybeNarrate();
  frame = requestAnimationFrame(tick);
}

function play() {
  cancelAnimationFrame(frame);
  playing = true;
  anchor = performance.now() - position * 1000;
  syncButtons();
  narration.resume();
  maybeNarrate();
  frame = requestAnimationFrame(tick);
}

function restart() {
  position = 0;
  narrated = seeking = false;
  narration.stop();
  showPosition();
  play();
}

function close() {
  pendingOpen++;
  cancelAnimationFrame(frame);
  playing = false;
  reel = render = null;
  narration.reset();
  if (record) {
    record.discard = true;
    if (record.recorder.state !== 'inactive') record.recorder.stop();
  }
}

function loadPhoto(src) {
  return new Promise(resolve => {
    const photo = new Image();
    photo.crossOrigin = 'anonymous';
    const timer = setTimeout(() => finish(null), 5000);
    function finish(result) {
      clearTimeout(timer);
      photo.onload = photo.onerror = null;
      resolve(result);
    }
    photo.onload = () => finish(photo);
    photo.onerror = () => finish(null);
    photo.src = src;
  });
}

async function open(memory) {
  const id = ++pendingOpen;
  const [photos] = await Promise.all([
    Promise.all((memory.photos || []).map(loadPhoto)),
    !Object.hasOwn(memory.ai || {}, 'photoColors') && window.VT?.analyzePhotos(memory.photos).then(colors => {
      (memory.ai ||= {}).photoColors = colors;
    })
  ]);
  if (id !== pendingOpen) return;
  closeAllModals();
  activeMemory = reel = memory;
  const ai = ensureReelCopy(memory.ai || (memory.ai = {}));
  persistMemories();
  const seconds = Number(memory.duration);
  duration = Number.isFinite(seconds) && seconds >= 1 ? Math.min(seconds, 60) : 15;
  render = createReelRenderer(canvas, photos, { ...memory, duration });
  voiceMood.value = 'auto';
  updateVoiceProfile();
  // Shared reels never start speaking without the viewer opting in.
  voiceEnabled = false;
  lastSecond = -1;
  $('videoMetaBadge').textContent = `${duration} SEC • CINEMATIC MONTAGE`;
  $('videoTitlePreview').textContent = ai.title;
  $('videoStoryPreview').textContent = ai.voiceover;
  $('videoTimeTotal').textContent = formatTime(duration);
  exportStatus.textContent = '';
  modal.classList.add('open');
  startModalMusic(memory);
  restart();
  return true;
}

function updateVoiceProfile() {
  const ai = reel.ai;
  const scene = window.VT?.buildScene(reel);
  profile = voiceProfile(scene?.archetype === 'noir' ? { ...ai, mood: 'noir' } : ai, voiceMood.value);
  narrationSeconds = estimateNarrationSeconds(ai.voiceover, profile);
  showVoiceStyle();
}

async function captureReel({ requireAudio = false } = {}) {
  if (record || preparing || !reel) throw new Error('A reel is not ready to record.');
  window.backgroundMusic?.prepareAudio();
  if (!canvas.captureStream || typeof MediaRecorder === 'undefined') throw new Error('This browser does not support video recording.');
  const memory = reel;
  preparing = true;
  narration.stop();
  syncButtons();
  exportStatus.textContent = 'Preparing soundtrack…';
  let selectedSoundtrack;
  try {
    selectedSoundtrack = await prepareModalRecording(memory);
    if (reel !== memory) throw new DOMException('Recording cancelled', 'AbortError');
    if (requireAudio && (!audioStreamDest || audioCtx?.state !== 'running' || (!selectedSoundtrack && !isPlayingAmbient))) {
      throw new Error('The saved soundtrack is unavailable. Play it in the studio before saving the archive.');
    }
  } finally {
    preparing = false;
    syncButtons();
  }
  const mime = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported?.(type));
  return new Promise((resolve, reject) => {
    let videoTracks = [], connected = false, deadline;
    const cleanup = () => {
      clearTimeout(deadline);
      if (connected) selectedSoundtrack.disconnect(audioStreamDest);
      videoTracks.forEach(track => track.stop());
      record = null;
      if (reel) syncButtons();
    };
    try {
      videoTracks = canvas.captureStream(30).getVideoTracks();
      const audioTracks = audioStreamDest?.stream.getAudioTracks() || [];
      const recorder = new MediaRecorder(new MediaStream([...videoTracks, ...audioTracks]), mime ? { mimeType: mime } : undefined);
      const session = { recorder, discard: false };
      const chunks = [];
      record = session;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { session.error = new Error('Could not record this reel.'); };
      recorder.onstop = () => {
        cleanup();
        if (session.discard) return reject(new DOMException('Recording cancelled', 'AbortError'));
        if (session.error) return reject(session.error);
        if (!chunks.length) return reject(new Error('No video was recorded.'));
        exportStatus.textContent = 'Reel recorded.';
        resolve(new Blob(chunks, { type: recorder.mimeType || chunks[0].type || 'video/webm' }));
      };
      if (selectedSoundtrack && audioStreamDest) {
        selectedSoundtrack.connect(audioStreamDest);
        connected = true;
      }
      position = 0;
      showPosition();
      recorder.start(250);
      deadline = setTimeout(() => {
        session.error = new Error('Recording timed out. Keep the studio visible and try again.');
        if (recorder.state !== 'inactive') recorder.stop();
      }, duration * 1000 + 8000);
      exportStatus.textContent = `Recording ${duration}s… Keep this tab open. Narration is preview-only.`;
      restart();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

async function exportReel() {
  try {
    const blob = await captureReel();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vivere-reel.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    exportStatus.textContent = 'Video saved. English captions are included.';
  } catch (error) {
    if (error.name !== 'AbortError') exportStatus.textContent = error.message;
  }
}

playButton.addEventListener('click', () => {
  if (!reel || record) return;
  if (!playing) {
    if (position >= duration - 0.002) restart();
    else play();
    return;
  }
  playing = false;
  cancelAnimationFrame(frame);
  narration.pause();
  syncButtons();
});
restartButton.addEventListener('click', restart);
downloadButton.addEventListener('click', exportReel);
voiceButton.addEventListener('click', () => {
  if (!reel || !narration.supported || record) return;
  voiceEnabled = !voiceEnabled;
  narrated = false;
  narration.stop();
  showVoiceStyle();
  if (voiceEnabled && !playing) play();
  else maybeNarrate();
  if (voiceEnabled && !narrated) voiceBadge.textContent = `${profile.label} · Narration starts on the next loop`;
  syncButtons();
});
voiceMood.addEventListener('change', () => {
  if (!reel || record || preparing) return;
  narration.stop();
  narrated = false;
  updateVoiceProfile();
  maybeNarrate();
});
positionSlider.addEventListener('input', () => {
  if (!reel || record) return;
  narration.stop();
  narrated = false;
  seeking = true;
  position = Math.min(duration - 0.001, duration * positionSlider.valueAsNumber / 1000);
  anchor = performance.now() - position * 1000;
  showPosition();
});
positionSlider.addEventListener('change', () => {
  seeking = false;
  maybeNarrate();
});
for (const button of effectButtons) {
  button.addEventListener('click', () => {
    if (record || !Object.hasOwn(REEL_EFFECTS, button.dataset.fx)) return;
    effect = button.dataset.fx;
    for (const item of effectButtons) {
      item.classList.toggle('active', item === button);
      item.setAttribute('aria-pressed', String(item === button));
    }
    if (render) showPosition();
  });
}
reduced.addEventListener('change', () => { if (render) showPosition(); });

window.reelStudio = { close, open, captureReel, get busy() { return preparing || !!record; }, localCopy: localReelCopy, ensureCopy: ensureReelCopy };
window.openVideoModal = open;
