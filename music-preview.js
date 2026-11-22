export function normalizeMusicQuery(query) {
  return query.trim().toLowerCase();
}

export async function findMusicPreview(input, { signal } = {}) {
  const query = normalizeMusicQuery(input);
  if (!query) return null;

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 18000);
  try {
    const response = await fetch(`/api/music?q=${encodeURIComponent(query)}`, { signal: controller.signal });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Music search failed');
    const result = await response.json();
    const title = typeof result?.title === 'string' ? result.title.trim() : '';
    const artist = typeof result?.artist === 'string' ? result.artist.trim() : '';
    if (!title || typeof result?.url !== 'string' || !result.url.startsWith('/api/preview?')) {
      throw new Error('Invalid preview');
    }
    return { query, title, artist, url: result.url, label: artist ? `${title} — ${artist}` : title };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
