import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { ATMOSPHERE_RULES, generateAtmosphere } from "./atmosphere-service.js";
import { DEFAULT_ATMOSPHERE, analyzeAtmosphere, normalizeAtmosphere } from "./atmosphere-style.js";
import { REEL_COPY_RULES, resolveReelCopy } from "./reel-copy.js";
import { createNarrationHandler } from "./narration-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile?.(envFile);
const app = express();
app.set("trust proxy", 1);

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const AUDIO_DIR = path.join(DATA_DIR, "audio");
const SHARES_DIR = path.join(DATA_DIR, "shares");

fs.mkdirSync(AUDIO_DIR, { recursive: true });
fs.mkdirSync(SHARES_DIR, { recursive: true });

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

const TEXT_MODEL = process.env.TEXT_MODEL || "gemini-2.5-flash";
const IMAGE_MODEL = process.env.IMAGE_MODEL || "";

const MAX_PHOTOS = 6;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: MAX_PHOTOS
  }
});

const ID_RE = /^[a-f0-9]{10}$/;
const makeId = () => crypto.randomBytes(5).toString("hex");

const THEMES = ["kraft", "lilac", "noir", "sage", "sunset", "ocean", "pop"];
const FRAMES = ["polaroid", "torn", "film", "round", "arch", "taped", "blob", "heart", "star"];
const HARMONIES = ["analogous", "complementary", "triadic", "mono"];
const VIBES = ["pastel", "vivid", "muted", "dark"];
const TITLE_STYLES = ["ransom", "poster", "script", "serif", "cinzel"];

const STICKERS = [
  "daisy", "peony", "fern", "moth", "bunny", "stamp", "star", "moon",
  "cloud", "shell", "sun", "tulip", "mushroom", "cassette", "camera",
  "coffee", "plane", "heart", "cherries", "balloon", "sparkle", "leaf",
  "butterfly", "flower", "bow", "cat"
];

const STICKER_STYLES = {
  kraft: "vintage botanical watercolour, muted earthy colours",
  lilac: "soft pastel kawaii illustration, lilac and pink tones",
  noir: "moody retro illustration, deep blues, gold and cream accents",
  sage: "calm hand-painted nature illustration, sage greens and cream",
  sunset: "warm sunny retro illustration, coral, peach and golden yellow",
  ocean: "fresh seaside illustration, aqua blues and sand",
  pop: "bright playful kidcore collage sticker, glossy candy colours"
};

app.post("/api/atmosphere", express.json({ limit: "16kb" }), asyncRoute(async (req, res) => {
  const generate = ai ? async contents => {
    const result = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents,
      config: { responseMimeType: "application/json", abortSignal: AbortSignal.timeout(12000) }
    });
    return result.text;
  } : null;
  res.json(await generateAtmosphere(req.body, generate));
}));

app.post('/api/narration', express.json({ limit: '4kb' }), createNarrationHandler());

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

function asyncRoute(fn) {
  return (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
}

async function generateWithRetry(params, attempts = 3) {
  if (!ai) throw new Error("GEMINI_API_KEY is not configured");

  let lastError;

  for (let i = 0; i < attempts; i++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      lastError = err;
      const status = Number(err?.status || err?.code);

      if (![429, 500, 502, 503, 504].includes(status) || i === attempts - 1) {
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 1200 * (i + 1)));
    }
  }

  throw lastError;
}

function cleanList(value, maxItems, maxLength) {
  return (Array.isArray(value) ? value : [])
    .map(x => String(x ?? "").trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function parseModelJson(text) {
  const raw = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  return JSON.parse(raw);
}

// =============================================
// HEALTH CHECK
// =============================================

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    aiConfigured: Boolean(ai),
    textModel: TEXT_MODEL
  });
});

// =============================================
// AI SCRAPBOOK — UP TO 6 PHOTOS
// =============================================

app.post("/api/scrapbook", (req, res, next) => {
  upload.array("photos", MAX_PHOTOS)(req, res, err => {
    if (!err) return next();

    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;

    res.status(status).json({
      error:
        err.code === "LIMIT_FILE_SIZE"
          ? "A photo is too large (8 MB maximum each)."
          : err.code === "LIMIT_FILE_COUNT" || (err.code === "LIMIT_UNEXPECTED_FILE" && err.field === "photos")
            ? `You can upload up to ${MAX_PHOTOS} photos.`
            : "Could not read the photos."
    });
  });
}, asyncRoute(async (req, res) => {

  if (!ai) {
    return res.status(503).json({
      error: "AI is not configured. Add GEMINI_API_KEY to the server environment."
    });
  }

  const photos = Array.isArray(req.files) ? req.files : [];

  if (!photos.length) {
    return res.status(400).json({
      error: "Please attach at least one photo."
    });
  }

  if (photos.some(file => !file.mimetype?.startsWith("image/"))) {
    return res.status(415).json({
      error: "All uploaded files must be images."
    });
  }

  const description = String(req.body.description || "").slice(0, 4000);
  const song = String(req.body.song || "").slice(0, 300);

  const prompt = `You are the art director of viverē, a coherent personal memory scrapbook.

Create art direction for THIS exact day.

Study ALL attached photos together:
- Identify their shared visual atmosphere.
- Identify important differences and recurring colours.
- Notice meaningful details and subjects.
- Consider how the photos work together as one memory.

The photos' real colours matter.
The diary text and song are mood clues.

Diary entry:
${description || "(No diary text; infer carefully from the photos.)"}

Song supplied by user:
${song || "(No song supplied.)"}

Generate the nested atmosphereStyle field using these rules:
${ATMOSPHERE_RULES}

Keep a stable scrapbook identity:
paper collage, handmade details, readable typography, clear hierarchy.
For the title, captions and voiceover:
${REEL_COPY_RULES}

Return ONLY valid JSON with this shape:

{
  "atmosphereStyle": ${JSON.stringify(DEFAULT_ATMOSPHERE)},
  "harmony": "${HARMONIES.join("|")}",
  "vibe": "${VIBES.join("|")}",
  "title": "poetic English title, 2–5 words",
  "voiceover": "English narration, one or two sentences, 12–24 words total",
  "title_style": "${TITLE_STYLES.join("|")}",
  "mood": "one or two words",
  "atmosphere": "one evocative sentence, same language as diary",
  "journal_entry": "two short first-person sentences, same language as diary, max 220 chars",
  "captions": ["3–6 short English phrases in sequence"],
  "board_text": "short poetic paper fragment, max 140 chars",
  "ticket_text": "place/time detail, max 30 chars",
  "list_title": "short heading, max 36 chars",
  "list_items": ["3-4 short details, max 32 chars each"],
  "strip_text": "short collage label, max 42 chars",
  "frame": "${FRAMES.join("|")}",
  "stickers": ["up to 8 ids from: ${STICKERS.join(", ")}"],
  "sticker_ideas": ["3 specific sticker illustration subjects in English"],
  "element_queries": ["2 short English searches for public-domain print/illustration"],
  "focus": {"x": 50, "y": 42},
  "song": {
    "title": "song title if known, otherwise supplied title or empty",
    "artist": "artist if known, otherwise empty"
  }
}

Do not invent a song if the user supplied one.
Use the supplied title as-is when the artist is unknown.
The focus point is the main subject in the image, in percent (0-100).`;

  const result = await generateWithRetry({
    model: TEXT_MODEL,
    contents: [
      ...photos.map(file => ({
        inlineData: {
          mimeType: file.mimetype,
          data: file.buffer.toString("base64")
        }
      })),
      { text: prompt }
    ],
    config: {
      responseMimeType: "application/json",
      temperature: 0.75
    }
  });

  const data = parseModelJson(result.text);

  delete data.theme;
  data.atmosphereStyle = normalizeAtmosphere(data.atmosphereStyle) || analyzeAtmosphere({ story: description, song });
  if (!FRAMES.includes(data.frame)) data.frame = "polaroid";
  if (!HARMONIES.includes(data.harmony)) data.harmony = "analogous";
  if (!VIBES.includes(data.vibe)) data.vibe = "muted";
  if (!TITLE_STYLES.includes(data.title_style)) data.title_style = "serif";

  Object.assign(data, resolveReelCopy(data, { story: description, song, style: data.atmosphereStyle }));
  data.mood = String(data.mood || "nostalgic").slice(0, 50);
  data.atmosphere = String(data.atmosphere || "").slice(0, 240);
  data.journal_entry = String(data.journal_entry || description).slice(0, 400);
  data.board_text = String(data.board_text || "").slice(0, 160);
  data.ticket_text = String(data.ticket_text || "").slice(0, 40);
  data.list_title = String(data.list_title || "").slice(0, 45);
  data.strip_text = String(data.strip_text || "").slice(0, 50);


  data.list_items = cleanList(data.list_items, 4, 40);
  data.stickers = cleanList(data.stickers, 8, 30)
    .map(x => x.toLowerCase())
    .filter(x => STICKERS.includes(x));

  data.sticker_ideas = cleanList(data.sticker_ideas, 3, 120);
  data.element_queries = cleanList(data.element_queries, 3, 80);

  const fx = Number(data.focus?.x);
  const fy = Number(data.focus?.y);

  data.focus = {
    x: Number.isFinite(fx) ? Math.max(0, Math.min(100, fx)) : 50,
    y: Number.isFinite(fy) ? Math.max(0, Math.min(100, fy)) : 42
  };

  data.song = {
    title: String(data.song?.title || song).slice(0, 160),
    artist: String(data.song?.artist || "").slice(0, 120)
  };

  res.json(data);
}));

// =============================================
// PUBLIC-DOMAIN ART — THE MET MUSEUM
// =============================================

const MET_API = "https://collectionapi.metmuseum.org/public/collection/v1";
const metCache = new Map();
const preferredClass = /print|drawing|paint|illustrat|book|textile|photograph|ornament/i;

function shuffled(items) {
  const a = [...items];

  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }

  return a;
}

app.get("/api/elements", asyncRoute(async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 80);

  if (!q) {
    return res.status(400).json({
      error: "q required",
      items: []
    });
  }

  const n = Math.max(1, Math.min(4, Number.parseInt(req.query.n, 10) || 2));

  let ids = metCache.get(q);

  if (!ids) {
    const response = await fetch(
      `${MET_API}/search?hasImages=true&q=${encodeURIComponent(q)}`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!response.ok) {
      throw new Error(`The Met search failed (${response.status})`);
    }

    const json = await response.json();
    ids = (json.objectIDs || []).slice(0, 250);

    if (metCache.size > 80) {
      metCache.delete(metCache.keys().next().value);
    }

    metCache.set(q, ids);
  }

  if (!ids.length) return res.json({ items: [] });

  const idsToTry = shuffled(ids).slice(0, 12);

  const objects = await Promise.all(
    idsToTry.map(id =>
      fetch(`${MET_API}/objects/${id}`, {
        signal: AbortSignal.timeout(9000)
      })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    )
  );

  const usable = objects.filter(
    o => o?.isPublicDomain && o?.primaryImageSmall
  );

  const ordered = usable
    .filter(o => preferredClass.test(o.classification || ""))
    .concat(usable.filter(o => !preferredClass.test(o.classification || "")));

  res.json({
    items: ordered.slice(0, n).map(o => ({
      url: o.primaryImageSmall,
      title: String(o.title || "").slice(0, 140),
      credit: "The Met Open Access (CC0)",
      link: o.objectURL || ""
    }))
  });
}));

// =============================================
// AI-GENERATED STICKERS
// =============================================

app.post("/api/sticker", asyncRoute(async (req, res) => {
  if (!ai) {
    return res.status(503).json({
      error: "No GEMINI_API_KEY",
      detail: "Set GEMINI_API_KEY on the server."
    });
  }

  if (!IMAGE_MODEL) {
    return res.status(501).json({
      error: "IMAGE_MODEL is not configured",
      detail: "Set IMAGE_MODEL to an image-generation model available to your API key."
    });
  }

  const subject = String(req.body?.subject || "").trim().slice(0, 120);
  const theme = THEMES.includes(req.body?.theme) ? req.body.theme : "kraft";
  const atmosphere = normalizeAtmosphere(req.body?.atmosphereStyle);
  const stickerStyle = atmosphere
    ? `${atmosphere.mood}, ${atmosphere.vibe}, handmade cutout in ${atmosphere.palette.primary}, ${atmosphere.palette.secondary} and ${atmosphere.palette.accent}`
    : STICKER_STYLES[theme];

  if (!subject) {
    return res.status(400).json({
      error: "subject required",
      detail: "Describe the sticker subject."
    });
  }

  const prompt = `One isolated die-cut sticker illustration of: ${subject}.
Style: ${stickerStyle}.
Thick clean white sticker outline, centered, generous margin.
Flat pure magenta (#FF00FF) background for easy removal.
No text, no letters, no frame, no other objects.`;

  const result = await generateWithRetry({
    model: IMAGE_MODEL,
    contents: prompt,
    config: {
      responseModalities: ["TEXT", "IMAGE"]
    }
  });

  const parts = result.candidates?.[0]?.content?.parts || [];
  const part = parts.find(p => p.inlineData?.data);

  if (!part) {
    return res.status(502).json({
      error: "No image returned",
      detail: "The image model returned no image."
    });
  }

  res.json({
    image: `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}`
  });
}));

// =============================================
// MUSIC SEARCH — ITUNES + DEEZER
// =============================================

const PREVIEW_HOSTS = [
  "itunes.apple.com",
  "mzstatic.com",
  "dzcdn.net"
];

const hostAllowed = host =>
  PREVIEW_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`));

async function findPreview(query) {
  const term = encodeURIComponent(query);

  try {
    const r = await fetch(
      `https://itunes.apple.com/search?media=music&entity=song&limit=8&term=${term}`,
      { signal: AbortSignal.timeout(8000) }
    );

    if (r.ok) {
      const j = await r.json();
      const hit = (j.results || []).find(x => x.previewUrl);

      if (hit) {
        return {
          title: hit.trackName,
          artist: hit.artistName,
          art: hit.artworkUrl100,
          src: hit.previewUrl
        };
      }
    }
  } catch (e) {
    console.warn("iTunes search:", e.message);
  }

  try {
    const r = await fetch(
      `https://api.deezer.com/search?q=${term}&limit=8`,
      { signal: AbortSignal.timeout(8000) }
    );

    if (r.ok) {
      const j = await r.json();
      const hit = (j.data || []).find(x => x.preview);

      if (hit) {
        return {
          title: hit.title,
          artist: hit.artist?.name || "",
          art: hit.album?.cover_small || "",
          src: hit.preview
        };
      }
    }
  } catch (e) {
    console.warn("Deezer search:", e.message);
  }

  return null;
}

app.get("/api/music", asyncRoute(async (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase().slice(0, 120);

  if (!q) return res.status(400).json({ error: "q required" });

  const hit = await findPreview(q);

  if (!hit) {
    return res.status(404).json({
      error: "No preview found"
    });
  }

  res.json({
    title: hit.title,
    artist: hit.artist,
    art: hit.art,
    url: `/api/preview?u=${encodeURIComponent(hit.src)}`
  });
}));

// =============================================
// AUDIO PREVIEW PROXY
// =============================================

const previewCache = new Map();

app.get("/api/preview", asyncRoute(async (req, res) => {
  let source;

  try {
    source = new URL(String(req.query.u || ""));
  } catch {
    return res.status(400).end();
  }

  if (source.protocol === "http:") {
    source.protocol = "https:";
  }

  if (source.protocol !== "https:" || !hostAllowed(source.hostname)) {
    return res.status(400).end();
  }

  let entry = previewCache.get(source.href);

  if (!entry) {
    const r = await fetch(source.href, {
      signal: AbortSignal.timeout(12000)
    });

    if (!r.ok) return res.status(502).end();

    const contentType = r.headers.get("content-type") || "audio/mpeg";

    if (!contentType.startsWith("audio/") && contentType !== "application/octet-stream") {
      return res.status(415).end();
    }

    entry = {
      buffer: Buffer.from(await r.arrayBuffer()),
      type: contentType
    };

    if (entry.buffer.length > 12 * 1024 * 1024) {
      return res.status(413).end();
    }

    if (previewCache.size >= 30) {
      previewCache.delete(previewCache.keys().next().value);
    }

    previewCache.set(source.href, entry);
  }

  const { buffer, type } = entry;
  const total = buffer.length;

  res.set({
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=1800"
  });

  if (req.headers.range) {
    const ranges = req.range(total);
    if (!Array.isArray(ranges) || ranges.type !== "bytes" || ranges.length !== 1) {
      return res.status(416).set("Content-Range", `bytes */${total}`).end();
    }
    const [{ start, end }] = ranges;

    res.status(206).set({
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Content-Length": end - start + 1
    });

    return res.end(buffer.subarray(start, end + 1));
  }

  res.set("Content-Length", total);
  res.end(buffer);
}));

// =============================================
// USER AUDIO UPLOAD
// =============================================

const AUDIO_EXT = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "webm"
};

app.post(
  "/api/audio",
  express.raw({ type: "audio/*", limit: "15mb" }),
  (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({
        error: "No audio data received."
      });
    }

    const mime = String(req.headers["content-type"] || "")
      .split(";")[0]
      .toLowerCase();

    const ext = AUDIO_EXT[mime];

    if (!ext) {
      return res.status(415).json({
        error: "Unsupported audio format."
      });
    }

    const file = `${makeId()}.${ext}`;
    fs.writeFileSync(path.join(AUDIO_DIR, file), req.body, { flag: 'wx' });
    res.json({ url: `/api/audio/${file}` });
  }
);

app.get("/api/audio/:file", (req, res) => {
  const file = String(req.params.file || "");

  if (!/^[a-f0-9]{10}\.(mp3|m4a|wav|ogg|webm)$/.test(file)) {
    return res.status(404).end();
  }

  const fullPath = path.join(AUDIO_DIR, file);

  if (!fs.existsSync(fullPath)) {
    return res.status(404).end();
  }

  res.sendFile(fullPath);
});

// =============================================
// SHARE MEMORIES
// =============================================

app.post("/api/share", (req, res) => {
  try {
    const body = req.body;

    if (!body || !Array.isArray(body.photos) || !body.photos.length) {
      return res.status(400).json({
        error: "Invalid memory payload."
      });
    }

    if (body.photos.length > MAX_PHOTOS) {
      return res.status(400).json({
        error: `You can share up to ${MAX_PHOTOS} photos.`
      });
    }

    const encodedSize = Buffer.byteLength(
      JSON.stringify(body),
      "utf8"
    );

    if (encodedSize > 18 * 1024 * 1024) {
      return res.status(413).json({
        error: "Memory is too large to share (18 MB maximum)."
      });
    }

    const id = makeId();

    fs.writeFileSync(
      path.join(SHARES_DIR, `${id}.json`),
      JSON.stringify(body)
    );

    res.json({
      id,
      url: `/s/${id}`
    });
  } catch (err) {
    console.error("share save:", err);

    res.status(500).json({
      error: "Could not save this memory."
    });
  }
});

app.get("/api/share/:id", (req, res) => {
  const id = String(req.params.id || "");

  if (!ID_RE.test(id)) {
    return res.status(404).json({
      error: "Memory not found."
    });
  }

  const file = path.join(SHARES_DIR, `${id}.json`);

  if (!fs.existsSync(file)) {
    return res.status(404).json({
      error: "Memory not found."
    });
  }

  res.type("json").send(fs.readFileSync(file, "utf8"));
});

app.get("/s/:id", (req, res) => {
  const id = String(req.params.id || "");

  if (!ID_RE.test(id)) return res.redirect("/");

  res.redirect(`/?m=${id}`);
});

// =============================================
// STATIC FRONTEND
// =============================================

app.use(express.static(__dirname));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// =============================================
// ERROR HANDLER
// =============================================

app.use((err, _req, res, _next) => {
  console.error("Server error:", err?.stack || err);

  if (res.headersSent) return;

  const status = err?.type === "entity.too.large" ? 413 : 500;

  res.status(status).json({
    error: status === 413
      ? "Request is too large."
      : "Server error. Check the terminal logs."
  });
});

// =============================================
// START SERVER
// =============================================

app.listen(PORT, "0.0.0.0", () => {
  console.log(`vivere is running at http://localhost:${PORT}`);

  if (!ai) {
    console.warn(
      "GEMINI_API_KEY is missing: AI scrapbook generation is disabled."
    );
  }
});
