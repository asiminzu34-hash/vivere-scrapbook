import { findMusicPreview, normalizeMusicQuery } from './music-preview.js';
import { previewSoundtrack, memorySoundtrackLabel, memoryForStorage, saveMemoryAudio, resolveMemoryAudio, soundtrackForShare } from './memory-audio.js';

const form = document.getElementById('backgroundMusicForm');
const query = document.getElementById('backgroundTrackQuery');
const preview = document.getElementById('backgroundAudio');
const toggle = document.getElementById('backgroundPlayToggle');
const volume = document.getElementById('backgroundVolume');
const track = document.getElementById('backgroundTrack');
const status = document.getElementById('backgroundMusicStatus');

let globalTrack;
let search;
let studio;
let ducked = false;
let volumeFrame;
const targetVolume = () => volume.valueAsNumber * (ducked ? 0.58 : 1);
function applyVolume(smooth = false) {
  cancelAnimationFrame(volumeFrame);
  const player = studio?.player || preview;
  const target = targetVolume();
  const other = player === preview ? customAudioEl : preview;
  other.volume = target;
  if (!smooth || player.paused) {
    player.volume = target;
    return;
  }
  const start = performance.now();
  const initial = player.volume;
  const fade = now => {
    const progress = Math.min(1, (now - start) / 190);
    player.volume = initial + (target - initial) * progress;
    if (progress < 1) volumeFrame = requestAnimationFrame(fade);
  };
  volumeFrame = requestAnimationFrame(fade);
}
applyVolume();
volume.addEventListener('input', () => applyVolume());

function prepareAudio() {
  // Unlock the graph in the user gesture so the reel can observe the beat later.
  if (window.AudioContext || window.webkitAudioContext) ensureAudioGraph();
}

function syncToggle() {
  const label = preview.paused ? 'Play' : 'Pause';
  toggle.textContent = preview.paused ? '▶' : 'Ⅱ';
  toggle.setAttribute('aria-label', `${label} background music`);
  toggle.title = label;
  updateModalPlayerUI();
}

async function playGlobal() {
  const url = preview.src;
  try {
    await preview.play();
    if (!search && preview.src === url && !preview.paused) status.textContent = 'Playing preview on loop';
  } catch (error) {
    if (preview.src !== url || error.name === 'AbortError' || search) return;
    status.textContent = error.name === 'NotAllowedError'
      ? 'Press Play to start the audio.'
      : 'Could not play this audio. Try another track.';
    syncToggle();
  }
}

function togglePlayback() {
  if (!globalTrack || (studio && studio.player !== preview)) return;
  if (preview.paused) {
    prepareAudio();
    void playGlobal();
  } else preview.pause();
}

const absoluteUrl = url => new URL(url, location.href).href;

function playPreview(result) {
  search?.abort();
  search = null;
  globalTrack = result;
  track.textContent = result.label;
  track.title = result.label;
  toggle.disabled = false;
  preview.loop = true;
  const url = absoluteUrl(result.url);
  if (studio?.player === preview && preview.src !== url) {
    // Do not replace the media a studio is currently borrowing.
    studio.resumeGlobal = true;
    return;
  }
  if (preview.src !== url || preview.error) preview.src = url;
  if (studio) {
    studio.resumeGlobal = true;
    return;
  }
  stopAmbientSynth();
  isPlayingAmbient = false;
  syncToggle();
  if (!preview.paused) {
    status.textContent = 'Playing preview on loop';
    return;
  }
  status.textContent = 'Loading audio…';
  void playGlobal();
}

function detachStudioFile() {
  if (studio?.player !== customAudioEl) return;
  customAudioEl.pause();
  customAudioEl.removeAttribute('src');
  customAudioEl.load();
}

function matchingPreview(url) {
  if (typeof url !== 'string' || !globalTrack || preview.error) return null;
  try { return preview.src === absoluteUrl(url) ? preview : null; }
  catch { return null; }
}

function beginStudio(url) {
  const resumeGlobal = studio ? studio.resumeGlobal : !preview.paused;
  detachStudioFile();
  const player = matchingPreview(url);
  studio = { player, resumeGlobal };
  if (!player && !preview.paused) preview.pause();
}

function useStudioAudio(url) {
  const next = absoluteUrl(url);
  const player = matchingPreview(next) || customAudioEl;
  studio.player = player;
  if (player !== preview && !preview.paused) preview.pause();
  if (player.src !== next || player.error) player.src = next;
  player.loop = true;
  applyVolume();
  return player;
}

function endStudio() {
  if (!studio) return;
  const { resumeGlobal } = studio;
  detachStudioFile();
  studio = null;
  if (!globalTrack) return;
  const url = absoluteUrl(globalTrack.url);
  if (preview.src !== url || !resumeGlobal) preview.pause();
  if (preview.src !== url) preview.src = url;
  if (resumeGlobal && preview.paused) void playGlobal();
}

window.memoryAudio = { previewSoundtrack, memorySoundtrackLabel, memoryForStorage, saveMemoryAudio, resolveMemoryAudio, soundtrackForShare };
window.backgroundMusic = {
  get title() { return globalTrack?.label || ''; },
  get soundtrack() { return globalTrack ? previewSoundtrack(globalTrack) : null; },
  get playing() { return !!globalTrack && !preview.paused; },
  get element() { return studio ? studio.player : globalTrack ? preview : null; },
  get searching() { return !!search; },
  prepareAudio,
  findPreview: findMusicPreview,
  playPreview,
  beginStudio,
  useStudioAudio,
  endStudio,
  setDucked(value) {
    if (ducked === value) return;
    ducked = value;
    applyVolume(true);
  },
  toggle: togglePlayback
};
toggle.addEventListener('click', togglePlayback);
for (const [event, message] of [['playing', 'Playing preview on loop'], ['pause', 'Paused'], ['error', 'Audio unavailable. Try another track.']]) {
  preview.addEventListener(event, () => {
    if (!search && (event !== 'pause' || !preview.error)) status.textContent = message;
    syncToggle();
  });
  customAudioEl.addEventListener(event, () => updateModalPlayerUI());
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!normalizeMusicQuery(query.value)) {
    status.textContent = 'Enter a track or artist name.';
    return;
  }

  prepareAudio();
  search?.abort();
  const controller = new AbortController();
  search = controller;
  status.textContent = 'Searching for a preview…';
  try {
    const result = await findMusicPreview(query.value, { signal: controller.signal });
    if (search !== controller) return;
    if (!result) {
      status.textContent = 'No preview found. Try a track and artist together.';
      return;
    }
    playPreview(result);
  } catch {
    if (search === controller) status.textContent = 'Music search unavailable. Try again in a moment.';
  } finally {
    if (search === controller) search = null;
  }
});
