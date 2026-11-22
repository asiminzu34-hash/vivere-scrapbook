# Vivere Memory Studio

```sh
npm ci
npm start
```

Open `http://localhost:3000`. For development with automatic server restarts, run `npm run dev`.

## AI Atmosphere

Open **Studio tools → AI Atmosphere** to generate a style for the current draft. New scrapbooks also use the story and selected song automatically. To restyle an open memory, use **Scrapbook atmosphere → Generate**; leave the prompt blank to use its note and soundtrack. Older saved and shared scrapbooks keep their original styles until you restyle them.

- **No API key:** Local analysis uses mood clues to pick the paper treatment, colors, typography, and effects. Try “Rainy midnight” or write a birthday story.
- **Gemini:** Set `GEMINI_API_KEY` in `.env`, then restart. If you do not already have a `.env`, use `.env.example` as a starting point. Node 20.12+ loads the file automatically; on earlier Node 20 releases, set the variable in the server environment instead. `TEXT_MODEL` optionally overrides `gemini-2.5-flash`.
- **Failure:** Unavailable or invalid model output uses the local analysis. With Gemini configured, the submitted context is sent to Google. The key stays on the server.
- **Photo-driven design:** All uploaded photos contribute offscreen brightness, contrast and color samples. Melancholic text or dark, muted images override cheerful model suggestions with Midnight Noir; other memories can use Street Zine, Y2K Pop, Impressionist Paper Study, or Vintage Best Friends. Try “Monet watercolor” to steer a design.

## Background music

Search in the creation form or under **Studio tools**. Both use the same case-insensitive preview search; `Artist - Song Title` works best. You can also choose a local file with **Change audio** in a scrapbook. Each memory keeps its own preview metadata or locally uploaded audio. Uploaded files are stored in this browser, and sharing an uploaded soundtrack sends that file to the server. The studio plays the saved soundtrack rather than borrowing the current toolbar selection. iTunes and Deezer supply short previews, not full songs, and need no API key. If your browser blocks automatic playback, press **Play**. An uploaded soundtrack can be included in its own reel export; unrelated background previews are not included.

## Cinematic reels

Reels and scrapbooks share a short poetic title and original English captions. Gemini writes them along with the atmosphere when configured; local story and mood analysis works without a key. The original story stays in the scrapbook journal.

Choose one of the five **Visual Effects** looks and scrub with the reel position slider. The montage and animated captions render to the same canvas used for downloads. **Voiceover: On** reads the English script with mood-based pacing, inflection, and pauses. It lowers music during speech, and prefers natural English voices installed in your browser or operating system. Use **Voice mood** to override automatic selection with Reflective, Warm storyteller, or Bright & upbeat. The badge shows the active voice or cloud model. Narration is preview-only; downloads include captions and the applicable soundtrack.

Optional cloud narration: set `OPENAI_API_KEY` (optionally `OPENAI_TTS_MODEL` or `OPENAI_TTS_VOICE`) or `ELEVENLABS_API_KEY` (optionally `ELEVENLABS_VOICE_ID`) in the server’s `.env` and restart. If both are set, OpenAI is used unless you set `NARRATION_PROVIDER=elevenlabs`. Enabling Voiceover may send the short narration script to the configured provider and incur charges. If the service is unavailable or unconfigured, the browser voice is used. Rate-limit or protect `/api/narration` before exposing a paid key on a public deployment.

## Memory archive

Choose **Save to Archive Folder** in a scrapbook or reel. In browsers with folder access, pick a parent folder; Viverē creates `Vivere_Archive/YYYY-MM-DD_Title/`. Otherwise, download a ZIP with the same layout. Save directly from the scrapbook to include its current drag positions and added stickers. The archive includes `scrapbook.png`, `reel.webm` or `reel.mp4`, and `memory-details.txt`. If browser PNG rasterization fails, the archive preserves the artwork as a self-contained SVG instead. Keep the studio visible while it records the reel with the memory soundtrack.

## Checks

```sh
npm test
npm run check
```
