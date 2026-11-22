import { findMusicPreview } from './music-preview.js';

const DB_NAME = 'vivere-memory-audio';
const STORE = 'blobs';
const isPreview = url => typeof url === 'string' && url.startsWith('/api/preview?');
const isUpload = url => typeof url === 'string' && /^\/api\/audio\/[a-f0-9]{10}\.(mp3|m4a|wav|ogg|webm)$/.test(url);

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Soundtrack storage is blocked. Close other Vivere tabs and retry.'));
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
  });
}

async function accessBlob(mode, operation) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = operation(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error || request.error || new Error('Soundtrack storage was interrupted.'));
    });
  } finally {
    db.close();
  }
}

export async function saveMemoryAudio(blob, title) {
  const blobId = crypto.randomUUID();
  await accessBlob('readwrite', store => store.add(blob, blobId));
  return { kind: 'upload', title, artist: 'Custom Audio', blobId };
}

export function previewSoundtrack({ title, artist, query, url }) {
  return { kind: 'preview', title, artist, query, url };
}

export function memorySoundtrackLabel(memory, fallback = 'Soundtrack') {
  const song = memory?.soundtrack?.title ? memory.soundtrack : memory?.ai?.song;
  return song?.title ? [song.title, song.artist].filter(Boolean).join(' — ') : fallback;
}

function legacyMediaUrl(value) {
  if (typeof value !== 'string') return null;
  if (isPreview(value) || isUpload(value) || value.startsWith('blob:')) return value;
  if (globalThis.location && value.startsWith(`${location.origin}/`)) {
    const path = value.slice(location.origin.length);
    if (isPreview(path) || isUpload(path)) return path;
  }
  return null;
}

export function memoryForStorage(memory) {
  const { audioUrl, ...saved } = memory;
  // Keep only durable legacy URLs; the studio's runtime source is not saved.
  const legacyUrl = legacyMediaUrl(audioUrl);
  if (!saved.soundtrack && legacyUrl && !legacyUrl.startsWith('blob:')) saved.audioUrl = legacyUrl;
  return saved;
}

const remote = (url, soundtrack) => ({ url, soundtrack, release() {} });

// Each call owns its result. The caller must release it after detaching its player.
// Ambient-only or unavailable memories have no media URL and resolve to null.
export async function resolveMemoryAudio(memory, { signal } = {}) {
  if (signal?.aborted || !memory) return null;
  const saved = memory.soundtrack;
  if (saved) {
    if (saved.kind === 'preview' && isPreview(saved.url)) return remote(saved.url, saved);
    if (saved.kind !== 'upload') return null;
    if (saved.blobId) {
      const blob = await accessBlob('readonly', store => store.get(saved.blobId)).catch(() => null);
      if (signal?.aborted) return null;
      if (blob) {
        const url = URL.createObjectURL(blob);
        let released = false;
        return { url, soundtrack: saved, release() {
          if (released) return;
          released = true;
          URL.revokeObjectURL(url);
        } };
      }
    }
    return isUpload(saved.url) ? remote(saved.url, saved) : null;
  }

  const legacyUrl = legacyMediaUrl(memory.audioUrl) || legacyMediaUrl(memory.ai?.audio_url);
  if (legacyUrl) {
    return remote(legacyUrl, { ...memory.ai?.song, kind: isPreview(legacyUrl) ? 'preview' : 'upload' });
  }
  if (typeof memory.previewQuery !== 'string' || !memory.previewQuery.trim()) return null;
  const match = await findMusicPreview(memory.previewQuery, { signal }).catch(() => null);
  return match && !signal?.aborted ? remote(match.url, previewSoundtrack(match)) : null;
}

export async function soundtrackForShare(memory) {
  const saved = memory.soundtrack;
  if (!saved) {
    const url = [memory.audioUrl, memory.ai?.audio_url].map(legacyMediaUrl).find(url => isUpload(url) || isPreview(url));
    if (url) return { ...memory.ai?.song, kind: isUpload(url) ? 'upload' : 'preview', url };
    if (memory.audioUrl?.startsWith?.('blob:')) throw new Error('Legacy local soundtrack is not available to share.');
    return undefined;
  }
  if (saved.kind !== 'upload') return saved;
  const { blobId, url, ...metadata } = saved;
  if (isUpload(url)) return { ...metadata, url };
  if (!blobId) throw new Error('Uploaded soundtrack is not available to share.');
  const blob = await accessBlob('readonly', store => store.get(blobId));
  if (!blob || blob.size > 15 * 1024 * 1024) throw new Error('Uploaded soundtrack is missing or too large to share.');
  const response = await fetch('/api/audio', {
    method: 'POST', headers: { 'Content-Type': blob.type || 'audio/mpeg' }, body: blob
  });
  if (!response.ok) throw new Error('Could not upload soundtrack.');
  const uploaded = await response.json();
  if (!isUpload(uploaded.url)) throw new Error('Invalid shared soundtrack URL.');
  return { ...metadata, url: uploaded.url };
}
