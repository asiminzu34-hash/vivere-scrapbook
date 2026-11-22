/* =====================================================================
   viverē · music fix
   Подключается ПОСЛЕ основного скрипта (и после themes.js).

   Что было не так:
   1) страница вообще не обращалась к /api/music, поэтому играли только тихие синтезаторные аккорды;
   2) сервер не пускал настоящие ссылки на превью (они лежат на audio-ssl.itunes.apple.com);
   3) браузеры блокируют автозапуск звука, а кнопки «нажми, чтобы играть» не было.

   Теперь: по названию песни ищется 30-секундное превью (iTunes, запасной вариант Deezer),
   своё аудио загружается на сервер (чтобы друзья его тоже слышали),
   а если браузер не дал запустить звук, кнопка ▶ начинает пульсировать.
   ===================================================================== */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const toast = (m) => { if (typeof showToast === "function") showToast(m); };
  const persist = () => { if (typeof persistMemories === "function") persistMemories(); };

  const found = new Map(); // query -> result (only for this visit; Deezer links expire)
  let token = 0;

  // pulsing play button when the browser blocked autoplay
  const css = document.createElement("style");
  css.textContent =
    "#modalPlayBtn.vt-attn{animation:vtAttn 1.1s ease-in-out infinite;box-shadow:0 0 0 0 rgba(122,97,72,.55)}" +
    "@keyframes vtAttn{0%{box-shadow:0 0 0 0 rgba(122,97,72,.55)}70%{box-shadow:0 0 0 14px rgba(122,97,72,0)}100%{box-shadow:0 0 0 0 rgba(122,97,72,0)}}";
  document.head.appendChild(css);

  function attn(on) {
    const b = $("modalPlayBtn");
    if (b) b.classList.toggle("vt-attn", !!on);
  }

  function setPlaying(v) {
    modalMusicPlaying = v;
    updateModalPlayerUI();
    if (v) attn(false);
  }

  function songQuery(ai) {
    const s = ai.song || {};
    const t = String(s.title || "").trim();
    if (!t) return "";
    const a = String(s.artist || "").trim();
    return (t + " " + (a && a !== "Custom Audio" ? a : "")).trim();
  }

  async function findPreview(q) {
    if (found.has(q)) return found.get(q);
    const r = await fetch("/api/music?q=" + encodeURIComponent(q));
    if (!r.ok) return null;
    const j = await r.json();
    found.set(q, j);
    return j;
  }

  // the user's own audio file: send it to the server so friends can hear it too
  async function uploadForSharing(memory) {
    const url = memory.audioUrl;
    memory._uploadedFor = url;
    try {
      const blob = await (await fetch(url)).blob();
      if (blob.size > 15 * 1024 * 1024) {
        toast("Your audio is over 15 MB, so friends will not hear it");
        return;
      }
      const type = blob.type && blob.type.indexOf("audio/") === 0 ? blob.type : "audio/mpeg";
      const r = await fetch("/api/audio", { method: "POST", headers: { "Content-Type": type }, body: blob });
      if (!r.ok) throw new Error("upload failed");
      const j = await r.json();
      memory.ai.audio_url = j.url;
      persist();
    } catch (e) {
      memory._uploadedFor = null;
    }
  }

  async function resolveSource(memory) {
    const ai = memory.ai || (memory.ai = {});
    if (memory.audioUrl) {
      if (memory._uploadedFor !== memory.audioUrl) uploadForSharing(memory);
      return { url: memory.audioUrl, kind: "upload" };
    }
    if (ai.audio_url) return { url: ai.audio_url, kind: "upload" };
    const q = songQuery(ai);
    if (!q) return null;
    try {
      const m = await findPreview(q);
      if (m && m.url) return { url: m.url, kind: "preview", meta: m };
    } catch (e) {}
    return null;
  }

  function wire() {
    ensureAudioGraph();
    if (!customAudioSourceConnected) {
      const node = audioCtx.createMediaElementSource(customAudioEl);
      if (window.AtmoAudio) {
        node.connect(window.AtmoAudio.input()); // goes through the analyser, so the scrapbook can dance to it
      } else {
        node.connect(audioCtx.destination);
        if (audioStreamDest) node.connect(audioStreamDest); // so the downloaded video has sound
      }
      customAudioSourceConnected = true;
    }
  }

  async function playAudio() {
    try {
      wire();
      if (audioCtx && audioCtx.state === "suspended") await audioCtx.resume();
      await customAudioEl.play();
      setPlaying(true);
      return true;
    } catch (e) {
      setPlaying(false);
      attn(true);
      return false;
    }
  }

  function fallbackAmbient(memory) {
    try {
      ensureAudioGraph();
      isPlayingAmbient = true;
      startAmbientSynth((memory && memory.trackIdx) || 0);
      setPlaying(true);
    } catch (e) {}
    toast("Could not find this song, so soft ambient sound is playing. Use “Change audio” to add your own.");
  }

  window.startModalMusic = function (memory) {
    const my = ++token;
    stopAmbientSynth();
    isPlayingAmbient = false;
    customAudioEl.pause();
    setPlaying(false);

    resolveSource(memory).then(async (src) => {
      if (my !== token) return;
      if (!src) { fallbackAmbient(memory); return; }

      customAudioEl.loop = true;
      customAudioEl.onerror = () => { if (my === token) fallbackAmbient(memory); };
      customAudioEl.src = src.url;

      const label = $("liveSongTitle");
      if (src.kind === "preview" && src.meta && label) {
        label.textContent = (src.meta.title || "") + (src.meta.artist ? " — " + src.meta.artist : "") + " · 30s preview";
      }

      const ok = await playAudio();
      if (my === token && !ok) toast("Tap ▶ to play the song");
    });
  };

  window.toggleModalMusic = async function () {
    if (modalMusicPlaying) {
      customAudioEl.pause();
      isPlayingAmbient = false;
      stopAmbientSynth();
      setPlaying(false);
      return;
    }
    if (customAudioEl.getAttribute("src") && !customAudioEl.error) {
      await playAudio();
      return;
    }
    if (activeMemory) window.startModalMusic(activeMemory);
  };

  // closing a window must also cancel a song that is still being looked up
  const originalClose = window.closeAllModals;
  window.closeAllModals = function () {
    token++;
    attn(false);
    originalClose();
  };
})();
