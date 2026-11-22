import { exportMemoryArchive } from './archive-export.js';
import { memorySoundtrackLabel } from './memory-audio.js';

const buttons = document.querySelectorAll('[data-archive]');
const statuses = document.querySelectorAll('[data-archive-status]');
const scrapbook = document.getElementById('scrapbookModal');
const video = document.getElementById('videoModal');
let busy = false;
const report = message => statuses.forEach(el => { el.textContent = message; });

async function saveArchive() {
  if (busy || !activeMemory) return;
  const studio = window.reelStudio;
  if (studio.busy) return report('Wait for the current reel recording to finish.');
  // Unlock audio and invoke the picker before giving up the click's activation.
  window.backgroundMusic?.prepareAudio();
  saveScrapbookEdits();
  const memory = activeMemory;
  const startedInBook = scrapbook.classList.contains('open');
  const ai = memory.ai || {};
  const metadata = {
    title: ai.title, date: memory.dateStr, story: ai.sourceStory || ai.journal_entry, journal: ai.journal_entry,
    song: memorySoundtrackLabel(memory, 'Soft ambient'), query: memory.soundtrack?.query || memory.previewQuery
  };
  busy = true;
  buttons.forEach(button => { button.disabled = true; });
  report('Choose where to save the archive.');
  function checkOpen(view) {
    if (activeMemory !== memory || !view.classList.contains('open')) throw new DOMException('Archive cancelled', 'AbortError');
  }
  try {
    const result = await exportMemoryArchive({
      metadata,
      async ensureScrapbookOpen() {
        checkOpen(startedInBook ? scrapbook : video);
        report('Taking a high-resolution scrapbook snapshot…');
        if (startedInBook) await window.VT?.ready();
        else await openScrapbookModal(memory, false);
        checkOpen(scrapbook);
        return document.getElementById('bookSpread');
      },
      async captureReel() {
        checkOpen(scrapbook);
        report('Recording the reel with its soundtrack. Keep this tab open…');
        if (!await studio.open(memory)) throw new DOMException('Archive cancelled', 'AbortError');
        return studio.captureReel({ requireAudio: true });
      }
    });
    if (result.mode === 'cancelled') return report('Archive cancelled.');
    const warning = [result.scrapbook !== 'scrapbook.png' ? 'This browser saved the artwork as SVG.' : '',
      result.missingImages ? `${result.missingImages} external image(s) could not be included.` : ''].filter(Boolean).join(' ');
    const where = result.mode === 'folder' ? `Saved in Vivere_Archive/${result.name}.` : 'Archive ZIP downloaded.';
    report([where, warning].filter(Boolean).join(' '));
  } catch (error) {
    report(error.name === 'AbortError' ? 'Archive cancelled.' : `Could not save the archive: ${error.message}`);
  } finally {
    busy = false;
    buttons.forEach(button => { button.disabled = false; });
  }
}

buttons.forEach(button => button.addEventListener('click', saveArchive));
