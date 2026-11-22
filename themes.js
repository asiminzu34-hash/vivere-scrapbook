import { FONTS, analyzeAtmosphere, luminance, normalizeAtmosphere, onColor } from './atmosphere-style.js';
import { bindAtmosphereForm } from './atmosphere-controls.js';
import { ensureReelCopy } from './reel-copy.js';
import { analyzePhotos, ARCHETYPES, chooseArchetype, composeLayout } from './scrapbook-design.js';

// Enhances the base scrapbook with generated art direction while rendering legacy memories as saved.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function div(cls) {
    const d = document.createElement("div");
    if (cls) d.className = cls;
    return d;
  }

  function hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // seeded random: the same seed always gives the same layout
  function mulberry(a) {
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function persist() {
    if (typeof persistMemories === "function") persistMemories();
  }


  function safe(fn) {
    try { fn(); } catch (e) { console.warn("themes.js:", e); }
  }

  // ---------------------------------------------------------------- fonts
  const fontLink = document.createElement("link");
  fontLink.rel = "stylesheet";
  fontLink.href =
    "https://fonts.googleapis.com/css2?family=Anton&family=Abril+Fatface&family=Permanent+Marker&family=Bungee&family=Rubik+Mono+One&family=Caveat+Brush&family=Special+Elite&family=Shadows+Into+Light&family=Cinzel:wght@500;700&family=Playfair+Display:ital,wght@0,600;1,500&display=swap";
  document.head.appendChild(fontLink);

  const FONT = {
    print: "'Special Elite','Courier New',monospace",
    serif: "Georgia,'Times New Roman',serif",
    hand: "'Caveat',cursive",
    marker: "'Permanent Marker','Caveat Brush',cursive",
    brush: "'Caveat Brush','Caveat',cursive",
    cinzel: "'Cinzel',Georgia,serif",
    soft: "'Shadows Into Light','Caveat',cursive"
  };

  const RANSOM_FONTS = [
    "'Anton',sans-serif", "'Abril Fatface',serif", "'Permanent Marker',cursive", "'Bungee',sans-serif",
    "'Special Elite',monospace", "'Rubik Mono One',sans-serif", "'Playfair Display',serif", "'Caveat Brush',cursive"
  ];

  // ---------------------------------------------------------------- colour tools
  function isHex(c) {
    return typeof c === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim());
  }
  function hexToRgb(hex) {
    let h = String(hex).trim().replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    const d = mx - mn;
    let h = 0, s = 0;
    if (d) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = clamp(s, 0, 1);
    l = clamp(l, 0, 1);
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
  }
  function hexHsl(hex) { return rgbToHsl.apply(null, hexToRgb(hex)); }
  function mixHex(a, b, t) {
    const x = hexToRgb(a), y = hexToRgb(b);
    return rgbToHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
  }
  function rgba(hex, a) {
    const c = hexToRgb(hex);
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
  }
  function shade(hex, dl) {
    const c = hexHsl(hex);
    return hslToHex(c[0], c[1], clamp(c[2] + dl, 0, 1));
  }
  function lumOf(hex) {
    const c = hexToRgb(hex).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function readableOn(bg) {
    return lumOf(bg) > 0.4 ? "#2a2030" : "#ffffff";
  }

  // ---------------------------------------------------------------- palette from the photo
  function extractDominant(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const sc = Math.min(1, 64 / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * sc));
          const h = Math.max(1, Math.round(img.naturalHeight * sc));
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const x = c.getContext("2d", { willReadFrequently: true });
          x.drawImage(img, 0, 0, w, h);
          const d = x.getImageData(0, 0, w, h).data;

          const bins = new Map();
          let sumL = 0, cnt = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] < 200) continue;
            const r = d[i], g = d[i + 1], b = d[i + 2];
            const hsl = rgbToHsl(r, g, b);
            sumL += hsl[2];
            cnt++;
            let wgt = 0.4 + hsl[1] * 2.2;               // saturated colours matter more
            if (hsl[2] < 0.1 || hsl[2] > 0.94) wgt *= 0.12; // almost black / white matter less
            const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
            const e = bins.get(key) || { w: 0, r: 0, g: 0, b: 0 };
            e.w += wgt; e.r += r * wgt; e.g += g * wgt; e.b += b * wgt;
            bins.set(key, e);
          }

          const sorted = Array.from(bins.values())
            .sort((a, b) => b.w - a.w)
            .map((e) => [e.r / e.w, e.g / e.w, e.b / e.w]);
          const picked = [];
          for (const col of sorted) {
            if (picked.every((p) => Math.hypot(p[0] - col[0], p[1] - col[1], p[2] - col[2]) > 70)) picked.push(col);
            if (picked.length >= 5) break;
          }
          resolve({ colors: picked.map((p) => rgbToHex(p[0], p[1], p[2])), light: cnt ? sumL / cnt : 0.5 });
        } catch (e) {
          resolve({ colors: [], light: 0.5 });
        }
      };
      img.onerror = () => resolve({ colors: [], light: 0.5 });
      img.src = src;
    });
  }

  const HARMONIES = ["analogous", "complementary", "triadic", "mono"];
  const VIBES = ["pastel", "vivid", "muted", "dark"];
  const VIBE_P = {
    pastel: { pS: 0.62, pL: 0.88, bS: 0.45, bL: 0.78, aS: 0.8, aL: 0.62 },
    vivid: { pS: 0.85, pL: 0.8, bS: 0.7, bL: 0.7, aS: 0.95, aL: 0.55 },
    muted: { pS: 0.3, pL: 0.86, bS: 0.24, bL: 0.72, aS: 0.5, aL: 0.5 },
    dark: { pS: 0.32, pL: 0.25, bS: 0.38, bL: 0.14, aS: 0.75, aL: 0.64 }
  };

  // photo colours + AI choice (harmony, vibe) -> full scrapbook palette
  function buildScheme(ai, T, style) {
    if (T.id === 'noir') {
      const dominant = ai.photoColors?.dominant;
      const [h, s] = isHex(dominant) ? hexHsl(dominant) : [220, 0];
      const hue = s > .12 ? clamp(h, 205, 235) : 220;
      const slate = (saturation, lightness) => hslToHex(hue, saturation, lightness);
      const ink = '#e2e5e9';
      const jpBg = slate(.11, .16);
      return {
        board: [slate(.12, .08), slate(.13, .15)],
        paper: [jpBg, slate(.08, .18), slate(.12, .27), slate(.10, .20), slate(.10, .23), slate(.10, .15)],
        accent: [slate(.13, .72), slate(.12, .57), slate(.12, .42)],
        ink, jpBg, accentDark: ink, dark: true
      };
    }
    if (style) {
      let { background, surface, text, primary, secondary, accent } = style.palette;
      let board = [style.effects.gradient.from, style.effects.gradient.to];
      const photo = ai.photoColors;
      if (photo && isHex(photo.dominant)) {
        const [h, s] = hexHsl(photo.dominant);
        const [accentHue, accentSat] = isHex(photo.accent) ? hexHsl(photo.accent) : [h, 0];
        const sourceHue = s > .12 ? h : accentSat > .18 ? accentHue : hexHsl(primary)[0];
        const darkPaper = T.id === 'zine' || luminance(text) > luminance(background);
        primary = hslToHex(sourceHue, clamp(s, .34, .88), darkPaper ? .63 : .42);
        secondary = hslToHex(s > .12 && accentSat > .18 ? accentHue : sourceHue + (T.id === 'painter' ? 104 : 28), .42, darkPaper ? .52 : .80);
        const counterHue = T.id === 'zine' ? sourceHue + 218 : T.id === 'pop' ? sourceHue + 118 : T.id === 'painter' ? sourceHue + 44 : sourceHue + 152;
        accent = hslToHex(counterHue, T.id === 'zine' ? .87 : .53, darkPaper ? .69 : .46);
        background = hslToHex(sourceHue, darkPaper ? .14 : .32, darkPaper ? .11 : .91);
        surface = hslToHex(T.id === 'cozy' ? 43 : sourceHue, .30, darkPaper ? .18 : .97);
        text = onColor(surface);
        board = [background, mixHex(background, secondary, darkPaper ? .18 : .25)];
      }
      return {
        board,
        paper: [surface, secondary, mixHex(surface, primary, 0.35), mixHex(surface, accent, 0.24), background, mixHex(background, secondary, 0.5)],
        accent: [accent, primary, secondary],
        ink: text, jpBg: surface, accentDark: text, dark: luminance(text) > luminance(background)
      };
    }
    const dom = (Array.isArray(ai.dom) ? ai.dom : []).filter(isHex);
    const base = dom[0] || T.base;
    let hsl = hexHsl(base);
    let h = hsl[0];
    if (hsl[1] < 0.1) h = hexHsl(T.base)[0]; // grey photo -> use the theme hue
    const h2 = dom[1] ? hexHsl(dom[1])[0] : h + 30;

    const harmony = HARMONIES.includes(ai.harmony) ? ai.harmony : T.harmony;
    let vibe = VIBES.includes(ai.vibe) ? ai.vibe : T.vibe;
    if (T.dark) vibe = "dark";
    const V = VIBE_P[vibe];
    const dark = vibe === "dark";

    let H;
    if (harmony === "complementary") H = [h + 180, h, h + 165, h + 15, h + 195];
    else if (harmony === "triadic") H = [h + 120, h, h + 240, h + 60, h + 300];
    else if (harmony === "mono") H = [h, h + 6, h - 6, h + 12, h - 12];
    else H = [h, h2, h - 28, h + 50, h - 55];

    const board = [hslToHex(H[0], V.bS, V.bL), hslToHex(H[1], V.bS, V.bL + (dark ? 0.05 : -0.07))];
    const paper = [0, 1, 2, 3, 4, 0].map((k, i) =>
      hslToHex(H[k % 5] + (i === 5 ? 8 : 0), V.pS, clamp(V.pL + ((i % 3) - 1) * 0.035, 0, 1))
    );
    const accent = [2, 3, 4].map((k) => hslToHex(H[k], V.aS, V.aL));
    const ink = dark ? hslToHex(h, 0.3, 0.93) : hslToHex(h, 0.38, 0.16);
    const jpBg = dark ? hslToHex(h, 0.22, 0.17) : hslToHex(h, 0.55, 0.97);
    const accentDark = shade(accent[0], dark ? 0.12 : -0.2);

    return { board, paper, accent, ink, jpBg, accentDark, dark, vibe, harmony };
  }

  // ---------------------------------------------------------------- CSS
  const css = document.createElement("style");
  css.textContent = `
  #collageBoard { container-type:inline-size; }
  #collageBoard > .scrap-newsprint-left, #collageBoard > .scrap-newsprint-tr, #collageBoard > .scrap-houndstooth,
  #collageBoard > .scrap-torn-cream, #collageBoard > .scrap-grid-br { display:none !important; }

  #vtBackdrop { position:absolute; inset:0; z-index:1; pointer-events:none; overflow:hidden; }
  .vt-scrap { position:absolute; filter:drop-shadow(.5cqw .9cqw 1cqw rgba(30,20,10,.26)); }
  .vt-scrap > .in { width:100%; height:100%; overflow:hidden; }
  .vt-scrap .txt { padding:2.4cqw 2.2cqw; line-height:1.5; }
  .vt-scrap .tix { height:calc(100% - 1.8cqw); margin:.9cqw; padding:.6cqw; display:flex; flex-direction:column; align-items:center;
    justify-content:center; text-align:center; border:.3cqw dashed currentColor; font-family:'Special Elite','Courier New',monospace; }
  .vt-scrap .tix b { font-size:2.3cqw; letter-spacing:.14em; }
  .vt-scrap .tix span { font-size:1.7cqw; margin-top:.6cqw; }

  .vt-photo, .vt-eph, .vt-note, .vt-strip, .vt-title, .vt-doodle, .vt-clip { position:absolute; cursor:grab; touch-action:none;
    user-select:none; -webkit-user-select:none; }
  .vt-photo:active, .vt-eph:active, .vt-note:active, .vt-strip:active, .vt-title:active { cursor:grabbing; }
  .vt-photo, .vt-eph { filter:drop-shadow(0 1.5cqw 2.2cqw rgba(30,20,10,.34)); }
  .vt-note, .vt-strip { filter:drop-shadow(0 1cqw 1.6cqw rgba(30,20,10,.3)); }

  .vt-photo .box { width:100%; overflow:hidden; position:relative; background:#e4dcd0; }
  .vt-photo .box img { width:100%; height:100%; object-fit:cover; display:block; pointer-events:none; }
  .vt-photo .cap { position:absolute; left:1cqw; right:1cqw; bottom:.7cqw; text-align:center; line-height:1.08;
    font-family:var(--f-hand,'Caveat',cursive); font-size:clamp(8px,1.95cqw,15px); text-wrap:balance; color:#463a2e; pointer-events:none; }

  .vt-polaroid { background:#fcfaf5; padding:1.1cqw 1.1cqw 5.4cqw; }
  .vt-taped { background:#fcfaf5; padding:.8cqw; }
  .vt-arch { background:#fcfaf5; padding:1.1cqw 1.1cqw 5.4cqw; border-radius:999px 999px 1cqw 1cqw; }
  .vt-arch .box { border-radius:999px 999px .5cqw .5cqw; }
  .vt-round { background:#fcfaf5; padding:1.1cqw; border-radius:50%; }
  .vt-round .box { border-radius:50%; }
  .vt-blob { background:#fff; padding:1cqw; border-radius:46% 54% 52% 48% / 52% 44% 56% 48%; }
  .vt-blob .box { border-radius:44% 56% 50% 50% / 54% 46% 54% 46%; }
  .vt-film { background:#15111a; padding:2.4cqw 1.1cqw; }
  .vt-film::before, .vt-film::after { content:""; position:absolute; left:0; right:0; height:1.1cqw; opacity:.92;
    background:repeating-linear-gradient(90deg,#f1ece2 0 1.1cqw,transparent 1.1cqw 2.3cqw); }
  .vt-film::before { top:.6cqw; } .vt-film::after { bottom:.6cqw; }
  .vt-heart, .vt-star { filter:drop-shadow(.5cqw 0 0 #fff) drop-shadow(-.5cqw 0 0 #fff) drop-shadow(0 .5cqw 0 #fff)
    drop-shadow(0 -.5cqw 0 #fff) drop-shadow(0 1.5cqw 2cqw rgba(30,20,10,.34)); }
  .vt-heart .box { clip-path:url(#vtHeart); }
  .vt-star .box { clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%); }

  .vt-tape { position:absolute; width:10.6cqw; height:3cqw; opacity:.92; pointer-events:none; z-index:3;
    clip-path:polygon(0 0,3% 25%,0 50%,3% 75%,0 100%,100% 100%,97% 75%,100% 50%,97% 25%,100% 0); box-shadow:0 .3cqw .6cqw rgba(0,0,0,.18); }

  .vt-eph { padding:.8cqw; }
  .vt-eph img { display:block; width:100%; height:auto; max-height:30cqw; object-fit:contain; mix-blend-mode:multiply; pointer-events:none; }

  .vt-st { position:absolute; }
  .vt-st svg { width:100%; height:auto; display:block; pointer-events:none; }

  .vt-note { padding:2cqw 2cqw 2.4cqw; }
  .vt-note .nt { font-size:2.8cqw; line-height:1.1; margin-bottom:.8cqw; }
  .vt-note .ni { font-size:2.5cqw; line-height:1.28; }
  .vt-strip { padding:1cqw 2.4cqw; text-align:center; letter-spacing:.08em; text-transform:uppercase; line-height:1.15; }

  .vt-title { left:2%; right:2%; bottom:1%; display:flex; flex-wrap:wrap; justify-content:center; align-items:center; gap:.6cqw 1.8cqw; }
  .vt-title .w { display:inline-flex; align-items:center; }
  .vt-title .l { display:inline-block; line-height:1.05; padding:.2cqw .9cqw; box-shadow:0 .4cqw .8cqw rgba(0,0,0,.25); margin:0 .15cqw; }
  .vt-title .one { line-height:1.05; }

  .vt-doodle svg { width:100%; height:auto; display:block; pointer-events:none; overflow:visible; }
  .vt-doodle path { fill:none; stroke-width:4; stroke-linecap:round; stroke-linejoin:round; stroke-dasharray:1; stroke-dashoffset:1;
    animation:vtDraw 1.1s ease forwards; animation-delay:calc(var(--i,0)*90ms + 700ms); }
  @keyframes vtDraw { to { stroke-dashoffset:0; } }

  .vt-clip svg { width:100%; height:auto; display:block; pointer-events:none; filter:drop-shadow(.3cqw .5cqw .5cqw rgba(0,0,0,.3)); }


  #bookSpread .vintage-journal-page { background-color:var(--jp-bg,#fbf8f1);
    background-image:repeating-linear-gradient(transparent,transparent 25px,var(--jp-line,rgba(138,118,96,.16)) 26px);
    border-left:2px dashed var(--jp-dash,rgba(138,118,96,.35)); }
  #bookSpread .sb-title { font-family:var(--f-title,Georgia,serif); font-weight:var(--vt-heading-weight,700); color:var(--jp-ink,#2f251c); }
  #bookSpread .journal-note { font-family:var(--f-hand,'Caveat',cursive); font-weight:var(--vt-body-weight,400); color:var(--jp-ink,#2f251c); }
  #bookSpread .journal-date { color:var(--jp-accent,#7a6148); }
  #bookSpread .journal-atmosphere { color:var(--jp-ink,#635345); opacity:.82; }
  .vt-credit { margin-top:6px; text-align:center; font-size:.68rem; opacity:.7; }
  `;
  document.head.appendChild(css);

  // clip-path for heart-shaped photos
  const defs = document.createElement("div");
  defs.innerHTML =
    '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><clipPath id="vtHeart" clipPathUnits="objectBoundingBox">' +
    '<path d="M0.5,0.95 C0.1,0.65 0,0.4 0,0.28 C0,0.1 0.12,0 0.27,0 C0.38,0 0.46,0.06 0.5,0.15 C0.54,0.06 0.62,0 0.73,0 C0.88,0 1,0.1 1,0.28 C1,0.4 0.9,0.65 0.5,0.95Z"/></clipPath></svg>';
  document.body.appendChild(defs);

  // ---------------------------------------------------------------- stickers
  let gid = 0;

  function glitterStar(c1, c2) {
    const id = "gs" + ++gid;
    return '<svg viewBox="0 0 100 100"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c1 +
      '"/><stop offset="1" stop-color="' + c2 + '"/></linearGradient></defs><path d="M50 6l13 29 31 3-23 21 7 31-28-16-28 16 7-31L6 38l31-3z" fill="url(#' + id +
      ')" stroke="' + shade(c2, -0.18) + '" stroke-width="2.5" stroke-linejoin="round"/><circle cx="40" cy="40" r="2.4" fill="#fff"/><circle cx="58" cy="52" r="1.9" fill="#fff"/>' +
      '<circle cx="46" cy="63" r="1.7" fill="#fff"/><path d="M62 28l1.6 4.4 4.4 1.6-4.4 1.6L62 40l-1.6-4.4-4.4-1.6 4.4-1.6z" fill="#fff"/></svg>';
  }

  function glitterHeart(c1, c2) {
    const id = "gh" + ++gid;
    return '<svg viewBox="0 0 100 100"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c1 +
      '"/><stop offset="1" stop-color="' + c2 + '"/></linearGradient></defs><path d="M50 90C20 66 8 49 8 33 8 19 19 9 31 9c8 0 15 4 19 11 4-7 11-11 19-11 12 0 23 10 23 24 0 16-12 33-42 57z" fill="url(#' + id +
      ')" stroke="' + shade(c2, -0.18) + '" stroke-width="3" stroke-linejoin="round"/><path d="M22 30c0-6 4-10 10-10" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".7"/>' +
      '<circle cx="62" cy="42" r="2.2" fill="#fff"/><circle cx="48" cy="60" r="1.8" fill="#fff"/></svg>';
  }

  const SVG_STATIC = {
    moon: '<svg viewBox="0 0 100 100"><path d="M62 8A42 42 0 1 0 92 66 34 34 0 0 1 62 8z" fill="#ffe08a" stroke="#e2b94a" stroke-width="3"/><circle cx="40" cy="58" r="5" fill="#f3cf6b"/><circle cx="52" cy="76" r="3.5" fill="#f3cf6b"/><path d="M78 20l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#fff"/></svg>',
    cloud: '<svg viewBox="0 0 100 100"><path d="M26 74a18 18 0 0 1-1-36 24 24 0 0 1 46-4 19 19 0 0 1 5 40z" fill="#fff" stroke="#b9c9e6" stroke-width="3"/><path d="M30 66c8 3 22 3 34 0" stroke="#dce6f7" stroke-width="5" stroke-linecap="round" fill="none"/></svg>',
    shell: '<svg viewBox="0 0 100 100"><path d="M50 88L12 52C8 30 26 14 50 14s42 16 38 38z" fill="#f7c6c0" stroke="#e29a92" stroke-width="3" stroke-linejoin="round"/><g stroke="#e29a92" stroke-width="3" stroke-linecap="round"><path d="M50 86V20M50 86L26 26M50 86L74 26M50 86L14 46M50 86L86 46"/></g><rect x="40" y="84" width="20" height="9" rx="3" fill="#e29a92"/></svg>',
    sun: '<svg viewBox="0 0 100 100"><g stroke="#ffb703" stroke-width="6" stroke-linecap="round"><path d="M50 6v12M50 82v12M6 50h12M82 50h12M19 19l8 8M73 73l8 8M81 19l-8 8M27 73l-8 8"/></g><circle cx="50" cy="50" r="24" fill="#ffd166" stroke="#f4a261" stroke-width="3"/><circle cx="42" cy="45" r="3" fill="#8a4b2a"/><circle cx="58" cy="45" r="3" fill="#8a4b2a"/><path d="M42 57q8 7 16 0" stroke="#8a4b2a" stroke-width="3" fill="none" stroke-linecap="round"/></svg>',
    tulip: '<svg viewBox="0 0 100 100"><path d="M50 94V52" stroke="#5aa469" stroke-width="5" stroke-linecap="round"/><path d="M50 84c-18-2-26-14-28-22 12 0 24 6 28 22z" fill="#6fbf7d"/><path d="M50 70c14-2 22-10 26-18-10-2-22 4-26 18z" fill="#5aa469"/><path d="M28 24c0 22 10 34 22 34s22-12 22-34c-8 6-14 2-22-6-8 8-14 12-22 6z" fill="#f48fb1" stroke="#d96a92" stroke-width="3" stroke-linejoin="round"/></svg>',
    mushroom: '<svg viewBox="0 0 100 100"><path d="M38 56h24l3 30c0 5-6 8-15 8s-15-3-15-8z" fill="#f6e7d0" stroke="#d3b896" stroke-width="3"/><path d="M8 56C8 28 28 10 50 10s42 18 42 46z" fill="#e5484d" stroke="#b02a30" stroke-width="3" stroke-linejoin="round"/><circle cx="32" cy="36" r="7" fill="#fff"/><circle cx="58" cy="26" r="6" fill="#fff"/><circle cx="72" cy="44" r="5" fill="#fff"/><circle cx="48" cy="46" r="4" fill="#fff"/></svg>',
    cassette: '<svg viewBox="0 0 100 100"><rect x="8" y="24" width="84" height="54" rx="6" fill="#f2e3c6" stroke="#8c6e46" stroke-width="3"/><rect x="16" y="32" width="68" height="22" rx="3" fill="#e5484d"/><rect x="16" y="56" width="68" height="14" rx="3" fill="#fff8e8"/><circle cx="34" cy="43" r="8" fill="#fff8e8" stroke="#8c6e46" stroke-width="2"/><circle cx="66" cy="43" r="8" fill="#fff8e8" stroke="#8c6e46" stroke-width="2"/><circle cx="34" cy="43" r="3" fill="#8c6e46"/><circle cx="66" cy="43" r="3" fill="#8c6e46"/><path d="M30 78l6-10h28l6 10z" fill="#d8c29c" stroke="#8c6e46" stroke-width="2"/></svg>',
    camera: '<svg viewBox="0 0 100 100"><rect x="8" y="30" width="84" height="54" rx="9" fill="#3a3340" stroke="#1d1823" stroke-width="3"/><path d="M32 30l6-10h24l6 10z" fill="#554c5d"/><rect x="8" y="42" width="84" height="12" fill="#f2e3c6"/><circle cx="50" cy="58" r="20" fill="#1d1823" stroke="#cfc6d6" stroke-width="4"/><circle cx="50" cy="58" r="12" fill="#4a6fa5"/><circle cx="45" cy="53" r="4" fill="#fff" opacity=".7"/><circle cx="80" cy="38" r="3.5" fill="#ff6b6b"/></svg>',
    coffee: '<svg viewBox="0 0 100 100"><path d="M30 14c-6 8 6 12 0 20M46 10c-6 8 6 12 0 20M62 14c-6 8 6 12 0 20" stroke="#cdbba0" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M16 42h58v22c0 14-10 24-29 24S16 78 16 64z" fill="#fff8ee" stroke="#8c6e46" stroke-width="3"/><path d="M74 48h8a10 10 0 0 1 0 20h-9" fill="none" stroke="#8c6e46" stroke-width="4"/><ellipse cx="45" cy="42" rx="29" ry="5" fill="#8a5a3b"/><path d="M26 64q19 8 38 0" stroke="#e5484d" stroke-width="3" fill="none"/></svg>',
    plane: '<svg viewBox="0 0 100 100"><path d="M6 46L94 8 70 90 48 62z" fill="#fff" stroke="#9fb6d6" stroke-width="3" stroke-linejoin="round"/><path d="M48 62L94 8 38 54z" fill="#dbe7f7" stroke="#9fb6d6" stroke-width="3" stroke-linejoin="round"/><path d="M48 62l-4 20 14-12z" fill="#c4d4ec" stroke="#9fb6d6" stroke-width="3" stroke-linejoin="round"/></svg>',
    cherries: '<svg viewBox="0 0 100 100"><path d="M28 72C36 42 50 24 62 12M74 68C72 42 67 26 62 12" stroke="#4e8f5b" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M62 12c10-6 22-2 26 6-10 4-20 2-26-6z" fill="#5bb174"/><circle cx="28" cy="74" r="17" fill="#d7263d"/><circle cx="74" cy="70" r="17" fill="#d7263d"/><circle cx="22" cy="68" r="4" fill="#fff" opacity=".55"/><circle cx="68" cy="64" r="4" fill="#fff" opacity=".55"/></svg>',
    balloon: '<svg viewBox="0 0 100 100"><ellipse cx="50" cy="40" rx="26" ry="31" fill="#f57c9b" stroke="#d85a7c" stroke-width="3"/><path d="M46 70h8l-4 7z" fill="#d85a7c"/><path d="M50 77c-6 8 6 12 0 20" stroke="#9a8aa8" stroke-width="2.5" fill="none"/><ellipse cx="40" cy="28" rx="6" ry="9" fill="#fff" opacity=".4" transform="rotate(20 40 28)"/></svg>',
    leaf: '<svg viewBox="0 0 100 100"><path d="M20 80C14 40 40 14 84 16c2 44-22 70-56 66z" fill="#7bc58e" stroke="#4e9b64" stroke-width="3"/><path d="M20 82C38 60 56 42 80 22" stroke="#4e9b64" stroke-width="3" fill="none" stroke-linecap="round"/></svg>',
    cat: '<svg viewBox="0 0 100 100"><path d="M18 40L14 10l24 14c8-3 16-3 24 0L86 10l-4 30c4 8 4 18 0 26-6 16-20 24-32 24S24 82 18 66c-4-8-4-18 0-26z" fill="#f3e4d0" stroke="#b08968" stroke-width="3" stroke-linejoin="round"/><circle cx="38" cy="50" r="4" fill="#3a2f26"/><circle cx="62" cy="50" r="4" fill="#3a2f26"/><path d="M46 60h8l-4 5z" fill="#e58f9b"/><path d="M50 65q-6 8-14 4M50 65q6 8 14 4" stroke="#3a2f26" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M8 56l22 4M8 66l22-2M92 56l-22 4M92 66l-22-2" stroke="#b08968" stroke-width="2" stroke-linecap="round"/><path d="M22 28l8 6M78 28l-8 6" stroke="#f2b8c0" stroke-width="5" stroke-linecap="round"/></svg>',
    icecream: '<svg viewBox="0 0 100 100"><path d="M30 52h40L50 94z" fill="#e8b36a" stroke="#c48a3f" stroke-width="3" stroke-linejoin="round"/><path d="M38 58l12 26M50 56v30M62 58l-12 26" stroke="#c48a3f" stroke-width="2"/><circle cx="50" cy="40" r="22" fill="#f9a8c9" stroke="#e57aa6" stroke-width="3"/><circle cx="40" cy="30" r="14" fill="#fff0d6" stroke="#e8cfa0" stroke-width="3"/><circle cx="52" cy="14" r="5" fill="#e5484d"/></svg>',
    donut: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="38" fill="#e8b36a" stroke="#c48a3f" stroke-width="3"/><path d="M50 18c18 0 32 14 32 32S68 82 50 82 18 68 18 50s14-32 32-32z" fill="#f48fb1"/><circle cx="50" cy="50" r="11" fill="#fff" stroke="#c48a3f" stroke-width="3"/><g stroke-width="3" stroke-linecap="round"><path d="M32 32l5-3" stroke="#fff"/><path d="M68 34l4 4" stroke="#ffd166"/><path d="M30 62l5 3" stroke="#9cccf5"/><path d="M66 68l-4 5" stroke="#fff"/><path d="M50 26v-6" stroke="#ffd166"/></g></svg>',
    cupcake: '<svg viewBox="0 0 100 100"><path d="M24 54h52l-6 34H30z" fill="#f4a261" stroke="#c7783a" stroke-width="3" stroke-linejoin="round"/><path d="M36 54v34M50 54v34M64 54v34" stroke="#c7783a" stroke-width="2"/><path d="M20 54c0-14 10-18 18-20 2-10 20-10 24 0 10 2 18 8 18 20z" fill="#ffb8d1" stroke="#e57aa6" stroke-width="3" stroke-linejoin="round"/><circle cx="50" cy="22" r="6" fill="#e5484d"/></svg>',
    pizza: '<svg viewBox="0 0 100 100"><path d="M12 28Q50 6 88 28L50 94z" fill="#ffd166" stroke="#e0a526" stroke-width="3" stroke-linejoin="round"/><path d="M12 28Q50 6 88 28" fill="none" stroke="#c7783a" stroke-width="7" stroke-linecap="round"/><circle cx="40" cy="40" r="6" fill="#e5484d"/><circle cx="60" cy="44" r="6" fill="#e5484d"/><circle cx="50" cy="62" r="5" fill="#e5484d"/><circle cx="48" cy="30" r="2.5" fill="#5bb174"/></svg>',
    croissant: '<svg viewBox="0 0 100 100"><path d="M8 62C14 36 36 22 50 22s36 14 42 40c-6 8-16 12-24 8-4 6-12 8-18 4-6 4-14 2-18-4-8 4-18 0-24-8z" fill="#e8b36a" stroke="#b9772f" stroke-width="3" stroke-linejoin="round"/><path d="M34 28c-4 14-2 28 4 44M50 22v52M66 28c4 14 2 28-4 44" stroke="#b9772f" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>',
    boba: '<svg viewBox="0 0 100 100"><path d="M56 8L50 40" stroke="#e5484d" stroke-width="6" stroke-linecap="round"/><path d="M24 36h52l-6 56H30z" fill="#f6e3cf" stroke="#b08968" stroke-width="3" stroke-linejoin="round"/><path d="M22 36h56" stroke="#b08968" stroke-width="5" stroke-linecap="round"/><g fill="#4a3426"><circle cx="38" cy="82" r="5"/><circle cx="50" cy="84" r="5"/><circle cx="62" cy="82" r="5"/><circle cx="44" cy="74" r="5"/><circle cx="56" cy="74" r="5"/></g></svg>',
    gift: '<svg viewBox="0 0 100 100"><rect x="14" y="42" width="72" height="46" rx="4" fill="#f48fb1" stroke="#d96a92" stroke-width="3"/><rect x="10" y="30" width="80" height="16" rx="4" fill="#ffb8d1" stroke="#d96a92" stroke-width="3"/><rect x="44" y="30" width="12" height="58" fill="#ffd166"/><path d="M50 30c-14-16-26-12-22-4s14 6 22 4zM50 30c14-16 26-12 22-4s-14 6-22 4z" fill="#ffd166" stroke="#e0a526" stroke-width="2.5"/></svg>',
    pencil: '<svg viewBox="0 0 100 100"><path d="M20 78L14 90l12-6z" fill="#f6e7d0" stroke="#b08968" stroke-width="2.5" stroke-linejoin="round"/><path d="M20 78L72 26l14 14-52 52z" fill="#ffd166" stroke="#e0a526" stroke-width="3" stroke-linejoin="round"/><path d="M72 26l8-8a6 6 0 0 1 8 0l6 6a6 6 0 0 1 0 8l-8 8z" fill="#f48fb1" stroke="#d96a92" stroke-width="3" stroke-linejoin="round"/></svg>',
    book: '<svg viewBox="0 0 100 100"><path d="M10 22c14-6 28-6 40 2 12-8 26-8 40-2v58c-14-6-28-6-40 2-12-8-26-8-40-2z" fill="#fff8e8" stroke="#8c6e46" stroke-width="3" stroke-linejoin="round"/><path d="M50 24v58" stroke="#8c6e46" stroke-width="3"/><path d="M20 36c8-2 16-2 24 2M20 48c8-2 16-2 24 2M56 38c8-4 16-4 24-2M56 50c8-4 16-4 24-2" stroke="#c9b794" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>',
    envelope: '<svg viewBox="0 0 100 100"><rect x="10" y="26" width="80" height="52" rx="5" fill="#fff8e8" stroke="#8c6e46" stroke-width="3"/><path d="M12 30l38 28 38-28" fill="none" stroke="#8c6e46" stroke-width="3" stroke-linejoin="round"/><path d="M50 52c-5-8-14-4-10 3 3 5 10 9 10 9s7-4 10-9c4-7-5-11-10-3z" fill="#e5484d"/></svg>',
    key: '<svg viewBox="0 0 100 100"><circle cx="30" cy="36" r="20" fill="#ffd166" stroke="#e0a526" stroke-width="3"/><circle cx="30" cy="36" r="8" fill="#fff"/><path d="M44 50l40 40M70 76l8-8M80 86l8-8" stroke="#e0a526" stroke-width="9" stroke-linecap="round"/><path d="M44 50l40 40" stroke="#ffd166" stroke-width="4" stroke-linecap="round"/></svg>',
    headphones: '<svg viewBox="0 0 100 100"><path d="M18 62V52a32 32 0 0 1 64 0v10" fill="none" stroke="#3a3340" stroke-width="7" stroke-linecap="round"/><rect x="10" y="56" width="20" height="30" rx="8" fill="#e5484d" stroke="#b02a30" stroke-width="3"/><rect x="70" y="56" width="20" height="30" rx="8" fill="#e5484d" stroke="#b02a30" stroke-width="3"/></svg>',
    vinyl: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="#2a2433" stroke="#15111a" stroke-width="3"/><circle cx="50" cy="50" r="32" fill="none" stroke="#4a4258" stroke-width="1.5"/><circle cx="50" cy="50" r="24" fill="none" stroke="#4a4258" stroke-width="1.5"/><circle cx="50" cy="50" r="15" fill="#f48fb1"/><circle cx="50" cy="50" r="3.5" fill="#fff"/><path d="M26 30a30 30 0 0 1 22-14" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".4"/></svg>',
    laptop: '<svg viewBox="0 0 100 100"><rect x="18" y="22" width="64" height="44" rx="5" fill="#cfd6e4" stroke="#6b7690" stroke-width="3"/><rect x="23" y="27" width="54" height="34" rx="2" fill="#2f3a56"/><path d="M30 38h22M30 46h34M30 54h16" stroke="#7fe0a5" stroke-width="3" stroke-linecap="round"/><path d="M8 72h84l-6 10H14z" fill="#e5e9f2" stroke="#6b7690" stroke-width="3" stroke-linejoin="round"/></svg>',
    lightbulb: '<svg viewBox="0 0 100 100"><path d="M50 8C32 8 20 22 20 38c0 12 6 18 12 26 3 4 4 8 4 12h28c0-4 1-8 4-12 6-8 12-14 12-26C80 22 68 8 50 8z" fill="#ffe08a" stroke="#e2b94a" stroke-width="3" stroke-linejoin="round"/><rect x="36" y="78" width="28" height="8" rx="3" fill="#cfc6d6" stroke="#8a8396" stroke-width="2.5"/><rect x="40" y="88" width="20" height="6" rx="3" fill="#cfc6d6" stroke="#8a8396" stroke-width="2.5"/><path d="M42 40c0-6 4-10 10-10" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".7"/></svg>',
    rocket: '<svg viewBox="0 0 100 100"><path d="M50 6c16 12 22 32 18 56H32C28 38 34 18 50 6z" fill="#e9eef7" stroke="#8a96ad" stroke-width="3" stroke-linejoin="round"/><circle cx="50" cy="36" r="8" fill="#9cccf5" stroke="#5a8fc2" stroke-width="3"/><path d="M32 52l-14 18 16-2zM68 52l14 18-16-2z" fill="#e5484d" stroke="#b02a30" stroke-width="3" stroke-linejoin="round"/><path d="M42 66h16l-8 24z" fill="#ffb703" stroke="#f4a261" stroke-width="3" stroke-linejoin="round"/></svg>',
    umbrella: '<svg viewBox="0 0 100 100"><path d="M8 50C10 24 30 10 50 10s40 14 42 40c-6-6-14-6-21 0-7-6-14-6-21 0-7-6-14-6-21 0-7-6-15-6-21 0z" fill="#9cccf5" stroke="#5a8fc2" stroke-width="3" stroke-linejoin="round"/><path d="M50 10v6M50 52v32a8 8 0 0 1-16 0" fill="none" stroke="#5a6a85" stroke-width="5" stroke-linecap="round"/></svg>',
    rainbow: '<svg viewBox="0 0 100 100"><g fill="none" stroke-width="8" stroke-linecap="round"><path d="M10 78a40 40 0 0 1 80 0" stroke="#ef6f6c"/><path d="M20 78a30 30 0 0 1 60 0" stroke="#ffd166"/><path d="M30 78a20 20 0 0 1 40 0" stroke="#7bc58e"/></g><path d="M2 84c4-8 14-8 18 0 4-8 14-8 18 0z" fill="#fff" stroke="#c9d6ee" stroke-width="2"/><path d="M62 84c4-8 14-8 18 0 4-8 14-8 18 0z" fill="#fff" stroke="#c9d6ee" stroke-width="2"/></svg>',
    snowflake: '<svg viewBox="0 0 100 100"><g stroke="#8fb8de" stroke-width="5" stroke-linecap="round"><path d="M50 8v84M14 29l72 42M14 71l72-42"/><path d="M50 20l-8-8M50 20l8-8M50 80l-8 8M50 80l8 8M22 34l-2-10M22 34l-10 2M78 66l2 10M78 66l10-2M22 66l-2 10M22 66l-10-2M78 34l2-10M78 34l10 2"/></g><circle cx="50" cy="50" r="6" fill="#fff" stroke="#8fb8de" stroke-width="3"/></svg>',
    maple: '<svg viewBox="0 0 100 100"><path d="M50 8l8 16 14-6-4 20 18-6-10 18 10 6-24 8 2 20-14-10-14 10 2-20-24-8 10-6-10-18 18 6-4-20 14 6z" fill="#e8742f" stroke="#b0481a" stroke-width="3" stroke-linejoin="round"/><path d="M50 40v52M50 56l-14-10M50 56l14-10" stroke="#b0481a" stroke-width="3" stroke-linecap="round"/></svg>',
    pine: '<svg viewBox="0 0 100 100"><path d="M50 6L26 38h12L18 66h20L14 90h72L62 66h20L62 38h12z" fill="#4e9b64" stroke="#2f6f43" stroke-width="3" stroke-linejoin="round"/><rect x="45" y="86" width="10" height="10" fill="#8c6e46"/></svg>',
    sunflower: '<svg viewBox="0 0 100 100"><g fill="#ffcf3f" stroke="#e0a526" stroke-width="2"><ellipse cx="50" cy="20" rx="8" ry="16"/><ellipse cx="50" cy="80" rx="8" ry="16"/><ellipse cx="20" cy="50" rx="16" ry="8"/><ellipse cx="80" cy="50" rx="16" ry="8"/><ellipse cx="29" cy="29" rx="8" ry="16" transform="rotate(-45 29 29)"/><ellipse cx="71" cy="71" rx="8" ry="16" transform="rotate(-45 71 71)"/><ellipse cx="71" cy="29" rx="8" ry="16" transform="rotate(45 71 29)"/><ellipse cx="29" cy="71" rx="8" ry="16" transform="rotate(45 29 71)"/></g><circle cx="50" cy="50" r="16" fill="#8a5a3b" stroke="#5e3b24" stroke-width="3"/><circle cx="45" cy="46" r="2" fill="#b98a64"/><circle cx="55" cy="54" r="2" fill="#b98a64"/><circle cx="54" cy="45" r="2" fill="#b98a64"/></svg>',
    cactus: '<svg viewBox="0 0 100 100"><path d="M40 92V30a10 10 0 0 1 20 0v62z" fill="#6fbf7d" stroke="#3f8a55" stroke-width="3" stroke-linejoin="round"/><path d="M40 62H28a6 6 0 0 1-6-6V40a6 6 0 0 1 12 0v10h6M60 52h12a6 6 0 0 0 6-6V32a6 6 0 0 0-12 0v8h-6" fill="#6fbf7d" stroke="#3f8a55" stroke-width="3" stroke-linejoin="round"/><path d="M30 92h40l-4 6H34z" fill="#e8b36a" stroke="#b9772f" stroke-width="2.5"/><circle cx="50" cy="16" r="5" fill="#f48fb1"/></svg>',
    palm: '<svg viewBox="0 0 100 100"><path d="M52 92c-2-20 0-40 4-56" stroke="#8c6e46" stroke-width="7" stroke-linecap="round" fill="none"/><path d="M56 36C40 22 22 24 12 36c14-4 28-2 44 0zM56 36C70 20 88 22 94 36c-12-4-26-2-38 0zM56 36C48 18 52 6 62 2c-2 12 2 22 0 34zM56 36C38 32 26 44 24 58c8-10 20-18 32-22zM56 36c16-2 28 10 30 24-8-10-20-18-30-24z" fill="#5bb174" stroke="#3f8a55" stroke-width="2.5" stroke-linejoin="round"/></svg>',
    lightning: '<svg viewBox="0 0 100 100"><path d="M58 4L22 54h24L38 96l40-56H54z" fill="#ffd166" stroke="#e0a526" stroke-width="3.5" stroke-linejoin="round"/></svg>',
    acorn: '<svg viewBox="0 0 100 100"><path d="M24 44h52c0 28-14 46-26 50-12-4-26-22-26-50z" fill="#c98f52" stroke="#8c5a28" stroke-width="3" stroke-linejoin="round"/><path d="M20 46c0-18 14-26 30-26s30 8 30 26z" fill="#8c5a28" stroke="#5e3b18" stroke-width="3" stroke-linejoin="round"/><path d="M50 20V8" stroke="#5e3b18" stroke-width="5" stroke-linecap="round"/><path d="M30 34l8 6M46 28l6 8M62 30l6 8" stroke="#b07a40" stroke-width="2.5" stroke-linecap="round"/></svg>'
  };

  const SVG_PAL = {
    star: (P) => glitterStar(P.accent[0], P.accent[1]),
    heart: (P) => glitterHeart(P.accent[1], P.accent[0]),
    sparkle: (P) => '<svg viewBox="0 0 100 100"><path d="M50 4c4 26 20 42 46 46-26 4-42 20-46 46-4-26-20-42-46-46 26-4 42-20 46-46z" fill="' + P.accent[2] + '" stroke="' + shade(P.accent[2], -0.18) + '" stroke-width="3" stroke-linejoin="round"/></svg>',
    flower: (P) => '<svg viewBox="0 0 100 100"><g fill="' + P.accent[0] + '" stroke="' + shade(P.accent[0], -0.15) + '" stroke-width="2"><circle cx="50" cy="22" r="17"/><circle cx="78.5" cy="42.7" r="17"/><circle cx="67.6" cy="76.3" r="17"/><circle cx="32.4" cy="76.3" r="17"/><circle cx="21.5" cy="42.7" r="17"/></g><circle cx="50" cy="52" r="13" fill="' + P.accent[2] + '" stroke="' + shade(P.accent[2], -0.15) + '" stroke-width="2"/></svg>',
    bow: (P) => '<svg viewBox="0 0 100 100"><path d="M50 46L8 24v44z" fill="' + P.accent[1] + '"/><path d="M50 46l42-22v44z" fill="' + P.accent[1] + '"/><path d="M46 56L34 90l14-9 6 11 4-36z" fill="' + shade(P.accent[1], -0.12) + '"/><path d="M54 56l12 34-14-9-2 11-4-36z" fill="' + shade(P.accent[1], -0.12) + '"/><rect x="40" y="35" width="20" height="24" rx="6" fill="' + shade(P.accent[1], -0.12) + '"/></svg>',
    butterfly: (P) => '<svg viewBox="0 0 100 100"><ellipse cx="30" cy="34" rx="24" ry="19" transform="rotate(-25 30 34)" fill="' + P.accent[0] + '"/><ellipse cx="70" cy="34" rx="24" ry="19" transform="rotate(25 70 34)" fill="' + P.accent[0] + '"/><ellipse cx="34" cy="66" rx="17" ry="14" transform="rotate(25 34 66)" fill="' + P.accent[2] + '"/><ellipse cx="66" cy="66" rx="17" ry="14" transform="rotate(-25 66 66)" fill="' + P.accent[2] + '"/><rect x="46.5" y="24" width="7" height="56" rx="3.5" fill="' + shade(P.accent[1], -0.25) + '"/><path d="M48 26C44 14 38 10 34 9M52 26C56 14 62 10 66 9" stroke="' + shade(P.accent[1], -0.25) + '" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>'
  };

  const CLIP_SVG = '<svg viewBox="0 0 60 120"><path d="M20 98V28a12 12 0 0 1 24 0v66a8 8 0 0 1-16 0V36" fill="none" stroke="#9aa3ad" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function allStickerIds() {
    const ids = Object.keys(SVG_STATIC).concat(Object.keys(SVG_PAL));
    if (typeof CUTOUT_SVGS !== "undefined") {
      Object.keys(CUTOUT_SVGS).forEach((k) => { if (!ids.includes(k)) ids.push(k); });
    }
    return ids;
  }

  function svgFor(id, P) {
    if (SVG_PAL[id] && P) return SVG_PAL[id](P);
    if (SVG_STATIC[id]) return SVG_STATIC[id];
    if (typeof CUTOUT_SVGS !== "undefined" && CUTOUT_SVGS[id]) return CUTOUT_SVGS[id];
    return P ? SVG_PAL.star(P) : SVG_STATIC.cloud;
  }

  // ---------------------------------------------------------------- doodles (drawn in by the browser)
  const DOODLES = {
    arrow: '<path pathLength="1" d="M6 70C22 20 60 8 92 40M92 40L72 34M92 40L88 60"/>',
    loop: '<path pathLength="1" d="M20 55C8 25 40 5 70 12C98 20 96 70 60 88C25 100 2 70 20 40C30 22 55 14 76 22"/>',
    squiggle: '<path pathLength="1" d="M5 50q10-22 20 0t20 0 20 0 20 0 15 0"/>',
    heartline: '<path pathLength="1" d="M50 86C10 56 12 20 35 18C45 17 50 25 50 30C50 25 55 17 65 18C88 20 90 56 50 86Z"/>',
    starline: '<path pathLength="1" d="M50 8l12 28 30 3-22 20 7 30-27-16-27 16 7-30L8 39l30-3z"/>',
    zigzag: '<path pathLength="1" d="M5 70L25 30L45 70L65 30L85 70"/>',
    burst: '<path pathLength="1" d="M50 10V30M50 70V90M10 50H30M70 50H90M22 22L36 36M64 64L78 78M78 22L64 36M36 64L22 78"/>'
  };
  const DOODLE_IDS = Object.keys(DOODLES);

  // ---------------------------------------------------------------- torn paper edges (random but seeded)
  function tornPoly(R, amp) {
    const pts = [];
    const n = 9;
    for (let i = 0; i <= n; i++) pts.push([(i / n) * 100, R() * amp]);
    for (let i = 1; i <= n; i++) pts.push([100 - R() * amp, (i / n) * 100]);
    for (let i = 1; i <= n; i++) pts.push([100 - (i / n) * 100, 100 - R() * amp]);
    for (let i = 1; i < n; i++) pts.push([R() * amp, 100 - (i / n) * 100]);
    return "polygon(" + pts.map((p) => p[0].toFixed(1) + "% " + p[1].toFixed(1) + "%").join(",") + ")";
  }

  // ---------------------------------------------------------------- the seven worlds
  // Kept only to reproduce older saved and shared scrapbooks that name a preset.
  const THEMES = {
    kraft: {
      label: "Paper & Ink", base: "#c9a77c", harmony: "analogous", vibe: "muted", titleStyle: "ransom",
      edge: "airmail", frames: ["polaroid", "torn", "taped"],
      fTitle: "'Cormorant Garamond',Georgia,serif", fHand: "'Caveat',cursive", noteFont: "brush",
      stickers: ["flower", "cat", "star", "heart", "coffee", "cassette", "bow", "cloud"],
      extras: ["note", "clip", "doodles"],
      queries: ["vintage botanical flower print", "antique postage stamp engraving"],
      scraps: [
        { k: "text", x: -3, y: 3, w: 25, h: 46, r: -2, bg: "p0", font: "print", src: "board", fs: 11 },
        { k: "text", x: 70, y: 1, w: 32, h: 36, r: 4, bg: "p1", font: "serif", src: "journal", fs: 13 },
        { k: "checker", x: 7, y: 52, w: 11, h: 38, r: -7, bg: "p2" },
        { k: "grid", x: 64, y: 68, w: 44, h: 38, r: -3, bg: "p3" },
        { k: "solid", x: 12, y: 90, w: 50, h: 14, r: 0, bg: "p4" }
      ]
    },
    lilac: {
      label: "Soft Pastel", base: "#b79ad8", harmony: "analogous", vibe: "pastel", titleStyle: "script",
      edge: "scallop", frames: ["arch", "round", "heart", "polaroid"],
      fTitle: "'Cormorant Garamond',Georgia,serif", fHand: "'Shadows Into Light','Caveat',cursive", noteFont: "soft",
      stickers: ["heart", "sparkle", "tulip", "moon", "cloud", "butterfly", "flower", "bow"],
      extras: ["note", "doodles", "glitter"],
      queries: ["pressed flower botanical illustration", "japanese flower woodblock print"],
      scraps: [
        { k: "lined", x: -2, y: 2, w: 26, h: 48, r: -3, bg: "p0", acc: 0 },
        { k: "gingham", x: 70, y: 0, w: 32, h: 34, r: 4, bg: "p1", acc: 1 },
        { k: "text", x: 4, y: 56, w: 30, h: 30, r: -4, bg: "p2", font: "soft", src: "journal", fs: 17 },
        { k: "dots", x: 62, y: 66, w: 42, h: 36, r: -3, bg: "p3", acc: 2 },
        { k: "solid", x: 20, y: 90, w: 50, h: 14, r: 0, bg: "p4" }
      ]
    },
    noir: {
      label: "Midnight", base: "#6f5fb0", harmony: "complementary", vibe: "dark", dark: true, titleStyle: "cinzel",
      edge: "film", frames: ["film", "polaroid", "taped"],
      fTitle: "'Cinzel',Georgia,serif", fHand: "'Caveat',cursive", noteFont: "hand",
      stickers: ["moon", "star", "sparkle", "cassette", "camera", "cat", "coffee", "cloud"],
      extras: ["strip", "clip", "doodles"],
      queries: ["night sky constellation chart print", "art deco ornament design"],
      scraps: [
        { k: "stars", x: -2, y: 2, w: 28, h: 50, r: -2, bg: "b1" },
        { k: "ticket", x: 68, y: 2, w: 32, h: 20, r: 5, bg: "p0", s: 5 },
        { k: "text", x: 70, y: 26, w: 30, h: 30, r: -3, bg: "p1", font: "print", src: "board", fs: 11 },
        { k: "checker", x: 6, y: 58, w: 10, h: 34, r: 6, bg: "p2" },
        { k: "solid", x: 22, y: 90, w: 56, h: 14, r: 0, bg: "p3" }
      ]
    },
    sage: {
      label: "Botanical", base: "#8fae84", harmony: "analogous", vibe: "muted", titleStyle: "serif",
      edge: "scallop", frames: ["torn", "arch", "polaroid"],
      fTitle: "'Cormorant Garamond',Georgia,serif", fHand: "'Shadows Into Light','Caveat',cursive", noteFont: "soft",
      stickers: ["leaf", "mushroom", "flower", "tulip", "butterfly", "cat", "sun", "heart"],
      extras: ["note", "doodles"],
      queries: ["fern botanical plate illustration", "mushroom fungi illustration print"],
      scraps: [
        { k: "lined", x: -3, y: 3, w: 25, h: 46, r: -2, bg: "p0", acc: 0 },
        { k: "text", x: 68, y: 2, w: 34, h: 34, r: 3, bg: "p1", font: "serif", src: "board", fs: 12 },
        { k: "grid", x: 66, y: 64, w: 40, h: 40, r: -3, bg: "p2" },
        { k: "stripes", x: 6, y: 58, w: 12, h: 36, r: -6, bg: "p3", acc: 1 },
        { k: "solid", x: 20, y: 90, w: 50, h: 14, r: 0, bg: "p4" }
      ]
    },
    sunset: {
      label: "Golden Hour", base: "#f0955f", harmony: "analogous", vibe: "vivid", titleStyle: "poster",
      edge: "scallop", frames: ["polaroid", "round", "star", "blob"],
      fTitle: "'Playfair Display',Georgia,serif", fHand: "'Caveat',cursive", noteFont: "marker",
      stickers: ["sun", "heart", "star", "balloon", "cherries", "camera", "plane", "sparkle"],
      extras: ["strip", "glitter", "doodles"],
      queries: ["tropical bird illustration print", "sunset landscape woodblock print"],
      scraps: [
        { k: "rays", x: -3, y: 4, w: 24, h: 44, r: -3, bg: "p0", acc: 0 },
        { k: "ticket", x: 68, y: 3, w: 32, h: 20, r: 4, bg: "p1", s: 5 },
        { k: "text", x: 70, y: 27, w: 30, h: 30, r: -2, bg: "p2", font: "serif", src: "board", fs: 12 },
        { k: "dots", x: 62, y: 66, w: 44, h: 38, r: -3, bg: "p3", acc: 1 },
        { k: "solid", x: 8, y: 88, w: 44, h: 16, r: 0, bg: "p4" }
      ]
    },
    ocean: {
      label: "Salt & Sky", base: "#6fa8c8", harmony: "mono", vibe: "pastel", titleStyle: "serif",
      edge: "waves", frames: ["polaroid", "taped", "arch", "blob"],
      fTitle: "'Playfair Display',Georgia,serif", fHand: "'Caveat',cursive", noteFont: "hand",
      stickers: ["shell", "cloud", "plane", "sun", "star", "camera", "cat", "moon"],
      extras: ["strip", "note", "doodles"],
      queries: ["seashell illustration print", "sailing ship engraving"],
      scraps: [
        { k: "waves", x: -3, y: 3, w: 26, h: 46, r: -2, bg: "p0", acc: 0 },
        { k: "text", x: 68, y: 2, w: 34, h: 34, r: 3, bg: "p1", font: "serif", src: "board", fs: 12 },
        { k: "grid", x: 64, y: 66, w: 42, h: 38, r: -3, bg: "p2" },
        { k: "ticket", x: 4, y: 58, w: 30, h: 18, r: -5, bg: "p3", s: 5 },
        { k: "solid", x: 30, y: 90, w: 48, h: 14, r: 0, bg: "p4" }
      ]
    },
    pop: {
      label: "Pop Collage", base: "#e0679a", harmony: "triadic", vibe: "vivid", titleStyle: "ransom", patchwork: true,
      edge: "none", frames: ["blob", "polaroid", "heart", "star", "taped"],
      fTitle: "'Abril Fatface',Georgia,serif", fHand: "'Caveat Brush','Caveat',cursive", noteFont: "marker",
      stickers: ["star", "heart", "butterfly", "bow", "flower", "cat", "cherries", "balloon"],
      extras: ["note", "strip", "doodles", "glitter", "clip"],
      queries: ["vintage kitten illustration print", "antique valentine card design"],
      scraps: [
        { k: "text", x: 70, y: 1, w: 30, h: 22, r: 4, bg: "p5", font: "marker", src: "journal", fs: 12 }
      ]
    }
  };

  const THEME_IDS = Object.keys(THEMES);
  const FRAMES = ["polaroid", "torn", "film", "round", "arch", "taped", "blob", "heart", "star"];
  const SAFE_MAIN = ["polaroid", "torn", "taped", "arch", "round", "blob", "film"];
  const TITLE_STYLES = ["ransom", "poster", "script", "serif", "cinzel"];

  // ---------------------------------------------------------------- layouts (x, y, w in % of the board)
  const LAYOUTS = [
    {
      slots: [
        { x: 8, y: 6, w: 34, r: -4, ar: "1/1.08" },
        { x: 55, y: 10, w: 30, r: 3, ar: "4/5" },
        { x: 30, y: 46, w: 32, r: -2, ar: "5/4" },
        { x: 6, y: 56, w: 24, r: 5, ar: "1/1" }
      ],
      eph: [{ x: 38, y: 79, w: 20, r: -4 }, { x: 86, y: 2, w: 13, r: 5 }],
      note: { x: 66, y: 57, w: 31, r: 3 }
    },
    {
      slots: [
        { x: 5, y: 8, w: 36, r: -6, ar: "4/5" },
        { x: 38, y: 30, w: 34, r: 4, ar: "1/1" },
        { x: 62, y: 6, w: 28, r: -3, ar: "4/5" },
        { x: 8, y: 62, w: 26, r: 3, ar: "5/4" }
      ],
      eph: [{ x: 42, y: 3, w: 17, r: -5 }, { x: 42, y: 75, w: 22, r: 4 }],
      note: { x: 73, y: 52, w: 25, r: 3 }
    },
    {
      slots: [
        { x: 22, y: 8, w: 46, r: -2, ar: "4/5" },
        { x: 2, y: 50, w: 24, r: 6, ar: "1/1" },
        { x: 70, y: 12, w: 26, r: 5, ar: "1/1" },
        { x: 68, y: 55, w: 28, r: -5, ar: "5/4" }
      ],
      eph: [{ x: 30, y: 79, w: 18, r: 3 }, { x: 77, y: 46, w: 14, r: 5 }],
      note: { x: 0, y: 4, w: 22, r: -4 }
    },
    {
      slots: [
        { x: 4, y: 6, w: 42, r: -3, ar: "4/5" },
        { x: 52, y: 7, w: 30, r: 4, ar: "1/1" },
        { x: 50, y: 44, w: 34, r: -4, ar: "5/4" },
        { x: 10, y: 60, w: 26, r: 5, ar: "5/4" }
      ],
      eph: [{ x: 84, y: 6, w: 15, r: 5 }, { x: 38, y: 58, w: 11, r: -5 }],
      note: { x: 60, y: 74, w: 34, r: 2 }
    },
    {
      slots: [
        { x: 6, y: 5, w: 52, r: -2, ar: "3/2" },
        { x: 62, y: 8, w: 28, r: 4, ar: "4/5" },
        { x: 4, y: 52, w: 30, r: -3, ar: "5/4" },
        { x: 40, y: 54, w: 34, r: 3, ar: "5/4" }
      ],
      eph: [{ x: 35, y: 80, w: 15, r: 4 }, { x: 91, y: 3, w: 9, r: 5 }],
      note: { x: 76, y: 54, w: 23, r: 3 }
    }
  ];

  const LARGE_PHOTO_LAYOUT = {
    slots: [
      { x: 5, y: 10, w: 26, r: -4, ar: "5/4" },
      { x: 36, y: 8, w: 27, r: 3, ar: "5/4" },
      { x: 68, y: 11, w: 26, r: -2, ar: "5/4" },
      { x: 6, y: 46, w: 26, r: 3, ar: "5/4" },
      { x: 36, y: 48, w: 27, r: -3, ar: "5/4" },
      { x: 67, y: 46, w: 26, r: 4, ar: "5/4" }
    ],
    eph: [{ x: 5, y: 78, w: 15, r: -4 }, { x: 25, y: 76, w: 15, r: 5 }],
    note: { x: 65, y: 76, w: 30, r: 3 }
  };

  const mirrorSlot = slot => ({ ...slot, x: 100 - slot.x - slot.w, r: -slot.r });
  const LARGE_LAYOUTS = [LARGE_PHOTO_LAYOUT, {
    slots: LARGE_PHOTO_LAYOUT.slots.map(mirrorSlot),
    eph: LARGE_PHOTO_LAYOUT.eph.map(mirrorSlot),
    note: mirrorSlot(LARGE_PHOTO_LAYOUT.note)
  }];

  // ---------------------------------------------------------------- top edge of the spread
  function waveUri(ink) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><path d="M0 10 Q10 0 20 10 T40 10" fill="none" stroke="' + ink + '" stroke-width="2.5"/></svg>';
    return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")';
  }

  function applyEdge(el, T, P) {
    if (!el) return;
    let h = "12px";
    let bg = "none";
    if (T.edge === "airmail") {
      bg = "repeating-linear-gradient(135deg," + P.accent[0] + " 0 14px,#f7f3ea 14px 26px," + P.accent[1] + " 26px 40px,#f7f3ea 40px 52px)";
    } else if (T.edge === "scallop") {
      h = "14px";
      bg = "radial-gradient(circle at 10px 0," + P.paper[0] + " 9px,transparent 10px) 0 0 / 20px 14px repeat-x";
    } else if (T.edge === "film") {
      h = "16px";
      bg = "repeating-linear-gradient(90deg,#15111a 0 10px,#f1ece2 10px 18px)";
    } else if (T.edge === "waves") {
      h = "20px";
      bg = waveUri("#ffffff") + " 0 0 / 40px 20px repeat-x";
    } else {
      h = "0px";
    }
    el.style.height = h;
    el.style.background = bg;
  }

  // ---------------------------------------------------------------- colour tokens used by the themes
  function tok(t, P) {
    if (!t) return "#ffffff";
    if (t[0] === "#") return t;
    const m = /^([pab])(\d)$/.exec(t);
    if (m) {
      const arr = m[1] === "p" ? P.paper : m[1] === "a" ? P.accent : P.board;
      return arr[Number(m[2]) % arr.length];
    }
    if (t === "ink") return P.ink;
    return "#ffffff";
  }

  // ---------------------------------------------------------------- paper pieces
  function makeScrap(sp, S, idx) {
    const P = S.P;
    const bg = tok(sp.bg, P);
    const ink = readableOn(bg);
    const pat = mixHex(bg, P.accent[(sp.acc || 0) % 3], 0.5);

    const wrap = div("vt-scrap");
    wrap.style.left = sp.x + "%";
    wrap.style.top = sp.y + "%";
    wrap.style.width = sp.w + "%";
    wrap.style.height = sp.h + "%";
    wrap.style.transform = "rotate(" + sp.r + "deg)";

    const inn = div("in");
    inn.style.clipPath = sp.s === 5 ? "none" : tornPoly(S.R, 3 + S.R() * 2.5);
    inn.style.backgroundColor = bg;
    inn.style.color = ink;

    switch (sp.k) {
      case 'charcoal':
        inn.style.backgroundImage = `radial-gradient(circle, ${rgba(ink, .16)} .55px, transparent 1.2px), repeating-linear-gradient(161deg, transparent 0 6px, ${rgba(ink, .07)} 6px 8px)`;
        inn.style.backgroundSize = '4px 5px, auto';
        break;
      case 'vellum':
        inn.style.backgroundImage = `linear-gradient(128deg, ${rgba(ink, .16)}, transparent 65%), repeating-linear-gradient(90deg, ${rgba(ink, .07)} 0 1px, transparent 1px 5px)`;
        break;
      case 'wash':
        inn.style.backgroundImage = `radial-gradient(ellipse at 20% 35%, ${rgba(P.accent[1], .44)}, transparent 65%), radial-gradient(ellipse at 70% 75%, ${rgba(P.accent[2], .65)}, transparent 70%), repeating-linear-gradient(148deg, transparent 0 4px, ${rgba(P.accent[0], .11)} 5px 7px)`;
        break;
      case 'newsprint':
        inn.style.backgroundImage = `repeating-linear-gradient(${rgba(ink, .17)} 0 1px, transparent 1px 5px), repeating-linear-gradient(90deg, transparent 0 30px, ${bg} 30px 36px)`;
        inn.style.backgroundBlendMode = 'multiply';
        break;
      case 'halftone':
        inn.style.backgroundImage = `radial-gradient(circle, ${pat} 0 26%, transparent 32%)`;
        inn.style.backgroundSize = '5px 5px';
        break;
      case 'floral':
        inn.style.backgroundImage = `radial-gradient(circle at 36% 38%, ${pat} 0 9%, transparent 13%), radial-gradient(circle at 64% 38%, ${pat} 0 9%, transparent 13%), radial-gradient(circle at 50% 63%, ${pat} 0 10%, transparent 14%), radial-gradient(circle at 50% 48%, ${P.accent[2]} 0 10%, transparent 14%)`;
        inn.style.backgroundSize = '26px 24px';
        break;
      case "grid": {
        const line = mixHex(bg, P.ink, 0.2);
        inn.style.backgroundImage = "linear-gradient(" + line + " 1px,transparent 1px),linear-gradient(90deg," + line + " 1px,transparent 1px)";
        inn.style.backgroundSize = "2.5cqw 2.5cqw";
        break;
      }
      case "lined":
        inn.style.backgroundImage = "linear-gradient(90deg,transparent 3.4cqw,#e58f8f 3.4cqw,#e58f8f 3.6cqw,transparent 3.6cqw),repeating-linear-gradient(transparent 0 3.4cqw," + pat + " 3.4cqw 3.6cqw)";
        break;
      case "gingham":
        inn.style.backgroundImage = "linear-gradient(90deg," + pat + "aa 50%,transparent 50%),linear-gradient(" + pat + "aa 50%,transparent 50%)";
        inn.style.backgroundSize = "2.8cqw 2.8cqw";
        break;
      case "checker": {
        const c = P.dark ? mixHex(bg, "#000000", 0.45) : P.ink;
        inn.style.backgroundImage =
          "linear-gradient(45deg," + c + " 25%,transparent 25%),linear-gradient(-45deg," + c + " 25%,transparent 25%)," +
          "linear-gradient(45deg,transparent 75%," + c + " 75%),linear-gradient(-45deg,transparent 75%," + c + " 75%)";
        inn.style.backgroundSize = "1.9cqw 1.9cqw";
        inn.style.backgroundPosition = "0 0,0 .95cqw,.95cqw -.95cqw,-.95cqw 0";
        break;
      }
      case "stripes":
        inn.style.backgroundImage = "repeating-linear-gradient(45deg," + bg + " 0 1.6cqw," + pat + " 1.6cqw 3.2cqw)";
        break;
      case "dots":
        inn.style.backgroundImage = "radial-gradient(" + pat + " 22%,transparent 24%)";
        inn.style.backgroundSize = "2.2cqw 2.2cqw";
        break;
      case "rays":
        inn.style.backgroundImage = "repeating-conic-gradient(from 0deg at 50% 100%," + bg + " 0 7deg," + pat + " 7deg 14deg)";
        break;
      case "stars": {
        const pts = [[12, 18], [30, 60], [55, 25], [75, 70], [20, 85], [88, 30], [45, 50], [65, 10], [8, 45], [82, 90]];
        inn.style.backgroundImage = pts.map((p) => "radial-gradient(.25cqw .25cqw at " + p[0] + "% " + p[1] + "%,#fff,transparent)").join(",");
        break;
      }
      case "waves":
        inn.style.backgroundImage = waveUri(pat);
        inn.style.backgroundSize = "6.2cqw 3.1cqw";
        break;
      case "ticket": {
        const t = div("tix");
        const b = document.createElement("b");
        b.textContent = "ADMIT ONE";
        const s1 = document.createElement("span");
        s1.textContent = S.ticket;
        const s2 = document.createElement("span");
        s2.textContent = S.dateStr;
        t.appendChild(b);
        t.appendChild(s1);
        t.appendChild(s2);
        inn.appendChild(t);
        break;
      }
      case "text": {
        const t = div("txt");
        t.style.fontFamily = FONT[sp.font || "serif"];
        t.style.fontSize = ((sp.fs || 11) / 6.4).toFixed(2) + "cqw";
        if (sp.font === "serif") t.style.fontStyle = "italic";
        t.textContent = sp.src === "journal" ? S.journal : S.boardText;
        inn.appendChild(t);
        break;
      }
    }

    wrap.appendChild(inn);
    return wrap;
  }

  // big patchwork of torn coloured papers (the "pop" world)
  function addPatchwork(bd, S) {
    const P = S.P;
    const tiles = [
      { x: -4, y: -4, w: 46, h: 60 }, { x: 36, y: -4, w: 46, h: 52 }, { x: 70, y: -4, w: 36, h: 60 },
      { x: -4, y: 46, w: 42, h: 60 }, { x: 32, y: 42, w: 40, h: 64 }, { x: 64, y: 46, w: 44, h: 60 }
    ];
    const kinds = ["dots", "solid", "stripes", "gingham", "solid", "grid"];
    const order = tiles.map((_, i) => i).sort(() => S.R() - 0.5);
    tiles.forEach((tl, i) => {
      const k = kinds[order[i] % kinds.length];
      const bg = P.paper[i % P.paper.length];
      const sp = { k, x: tl.x, y: tl.y, w: tl.w, h: tl.h, r: S.R() * 4 - 2, bg: "#" + bg.slice(1), acc: i % 3, s: 1 };
      const el = makeScrap(sp, S, i);
      el.style.filter = "drop-shadow(.4cqw .6cqw .8cqw rgba(30,20,10,.22))";
      bd.appendChild(el);
    });
  }

  // ---------------------------------------------------------------- the scene for one memory
  function themeFor(ai) {
    return !normalizeAtmosphere(ai.atmosphereStyle) && Object.hasOwn(THEMES, ai.theme) ? ai.theme : null;
  }

  function memoryAtmosphere(ai) {
    return normalizeAtmosphere(ai.atmosphereStyle) || analyzeAtmosphere({
      prompt: ai.designPrompt, story: ai.sourceStory || ai.journal_entry || ai.title || '', song: ai.song?.title || ''
    });
  }

  function dynamicDesign(style, seed, id) {
    const random = mulberry(seed ^ hash(style.palette.primary + style.palette.accent));
    const design = ARCHETYPES[id];
    const heading = {
      zine: "'Bungee', 'Anton', sans-serif", pop: "'Abril Fatface', Georgia, serif",
      painter: "'Playfair Display', Georgia, serif", cozy: FONTS[style.typography.heading], noir: FONT.cinzel
    }[id];
    const placements = [[-4, 2, 34, 45, -5], [62, 0, 42, 40, 6], [61, 52, 44, 49, -3], [-5, 71, 54, 35, 5]];
    return {
      ...design, id, titleStyle: design.heading, fTitle: heading, fHand: design.hand, noteFont: 'hand', queries: [],
      scraps: design.papers.map((k, i) => {
        const [x, y, w, h, r] = placements[i];
        return { k, x: x + random() * 5, y, w, h, r, bg: `p${i + 1}`, acc: i % 3 };
      })
    };
  }

  function buildScene(memory) {
    const ai = memory.ai || {};
    const candidate = memoryAtmosphere(ai);
    const design = chooseArchetype(candidate, ai, ai.photoColors);
    const themeId = design === 'noir' ? null : themeFor(ai);
    const style = themeId ? null : candidate;
    const seed = ai.layoutSeed ?? hash(memory.id || ai.title || 'viv');
    const archetype = style ? design : null;
    const T = themeId ? THEMES[themeId] : dynamicDesign(style, seed, archetype);
    const P = buildScheme(ai, T, style);
    const R = mulberry(seed);

    const photos = Array.isArray(memory.photos) ? memory.photos : [];
    const large = photos.length > LAYOUTS[0].slots.length;
    const layouts = large ? LARGE_LAYOUTS : LAYOUTS;
    const layoutCount = archetype ? 4 : layouts.length;
    const seeded = R();
    const layoutIndex = Number.isInteger(ai.layoutIndex) && ai.layoutIndex >= 0 && ai.layoutIndex < layoutCount
      ? ai.layoutIndex : large && !archetype ? 0 : Math.floor(seeded * layoutCount);
    const layout = archetype ? composeLayout(T, mulberry(seed), layoutIndex, large) : layouts[layoutIndex];
    const nSlots = Math.max(2, photos.length + (large || (archetype && photos.length > 1) ? 0 : 1));
    const slots = layout.slots.slice(0, nSlots);

    const fx = Number(ai.focus && ai.focus.x);
    const fy = Number(ai.focus && ai.focus.y);
    const F = { x: isFinite(fx) ? clamp(fx, 0, 100) : 50, y: isFinite(fy) ? clamp(fy, 0, 100) : 42 };

    // real photos first, then different close-ups of the same photo
    const presets = [{ zoom: 1.9, dx: 8, dy: -6 }, { zoom: 2.4, dx: -10, dy: 8 }];
    const crops = slots.map((_, i) => {
      if (i < photos.length) return { src: photos[i], fx: i === 0 ? F.x : 50, fy: i === 0 ? F.y : 45, zoom: 1 };
      const base = photos[(i - photos.length) % Math.max(1, photos.length)] || photos[0];
      const p = presets[(i - photos.length) % presets.length];
      return { src: base, fx: clamp(F.x + p.dx, 0, 100), fy: clamp(F.y + p.dy, 0, 100), zoom: p.zoom };
    });

    // frames: the main photo always gets a "safe" frame, small ones can be hearts/stars
    const pool = archetype ? T.frames : [ai.frame].concat(T.frames).filter((f, i, a) => FRAMES.includes(f) && a.indexOf(f) === i);
    const safePool = pool.filter((f) => SAFE_MAIN.includes(f));
    const offset = archetype ? Math.floor(R() * pool.length) : 0;
    const frames = slots.map((_, i) => {
      if (i === 0) return archetype ? pool[0] : safePool[0] || 'polaroid';
      return pool[archetype ? 1 + (i - 1 + offset) % (pool.length - 1) : (i + Math.floor(R() * 3)) % pool.length];
    });

    // stickers
    const valid = allStickerIds();
    const list = (Array.isArray(ai.stickers) ? ai.stickers : [])
      .map((s) => String(s).toLowerCase())
      .filter((s, i, a) => valid.includes(s) && a.indexOf(s) === i);
    if (archetype) {
      const artwork = T.stickers.filter(id => valid.includes(id));
      list.splice(0, list.length, ...(archetype === 'noir' ? artwork : new Set([...artwork.slice(0, 4), ...list.slice(0, 2), ...artwork])));
    }
    T.stickers.forEach((s) => {
      if (list.length < 8 && !list.includes(s) && valid.includes(s)) list.push(s);
    });

    const caps = (Array.isArray(ai.captions) ? ai.captions : []).filter((c) => typeof c === "string" && c.trim());
    const captions = caps.length ? caps : ['The little things', 'Time held still', 'Something to keep'];

    const items = (Array.isArray(ai.list_items) ? ai.list_items : []).filter((c) => typeof c === "string" && c.trim()).slice(0, 5);

    return {
      themeId, archetype, style, T, P, R, layout, layoutIndex, layoutCount, slots, crops, frames,
      stickers: list.slice(0, 8),
      captions,
      title: ai.title || "One day to remember",
      titleStyle: archetype || !TITLE_STYLES.includes(ai.title_style) ? T.titleStyle : ai.title_style,
      journal: ai.journal_entry || "A day worth keeping between these pages.",
      boardText: ai.board_text || ai.atmosphere || "Keep the small things: the light, the laughter, the song that was playing.",
      ticket: ai.ticket_text || ai.mood || "a good day",
      listTitle: ai.list_title || "things that made this day",
      listItems: items.length ? items : captions.slice(0, 4),
      stripText: ai.strip_text || captions[1],
      dateStr: memory.dateStr || "",
      density: clamp(Number(ai.density) || 1, 0.2, 1.4)
    };
  }

  // ---------------------------------------------------------------- tape
  function tapeBg(P, R) {
    const a = P.accent[Math.floor(R() * 3)];
    const b = P.paper[Math.floor(R() * 6)];
    const t = R();
    if (t < 0.4) return rgba(a, 0.78);
    if (t < 0.75) return "repeating-linear-gradient(45deg," + rgba(a, 0.8) + " 0 .9cqw," + rgba(b, 0.85) + " .9cqw 1.8cqw)";
    return rgba(a, 0.75) + " radial-gradient(rgba(255,255,255,.7) 22%,transparent 24%) 0 0 / 1.6cqw 1.6cqw";
  }

  function addTape(parent, S) {
    const t = div("vt-tape");
    t.style.background = tapeBg(S.P, S.R);
    t.style.left = 28 + S.R() * 22 + "%";
    t.style.top = "-1.4cqw";
    t.style.transform = "rotate(" + (S.R() * 16 - 8).toFixed(1) + "deg)";
    parent.appendChild(t);
  }

  // ---------------------------------------------------------------- photos
  function addFrame(layer, S, i) {
    const sl = S.slots[i];
    const frame = S.frames[i];
    const crop = S.crops[i];

    const el = div("vt-photo vt-" + frame);
    el.style.left = sl.x + "%";
    el.style.top = sl.y + "%";
    el.style.width = sl.w + "%";
    el.style.transform = "rotate(" + sl.r + "deg)";
    el.style.zIndex = 10 + i;
    el.style.setProperty("--i", i);

    const box = div("box");
    const ar = frame === "round" || frame === "star" ? "1/1" : frame === "heart" ? "1/.95" : frame === "arch" ? "4/5" : frame === "blob" ? "1/1.08" : sl.ar;
    box.style.aspectRatio = ar;

    const img = document.createElement("img");
    img.src = crop.src;
    img.alt = "";
    img.draggable = false;
    img.style.objectPosition = crop.fx + "% " + crop.fy + "%";
    if (crop.zoom > 1) {
      img.style.transformOrigin = crop.fx + "% " + crop.fy + "%";
      img.style.transform = "scale(" + crop.zoom + ")";
    }
    if (frame === "film") img.style.filter = "grayscale(1) contrast(1.08)";
    box.appendChild(img);

    if (frame === "torn") box.style.clipPath = tornPoly(S.R, 2.4);
    el.appendChild(box);

    if (frame === "polaroid" || frame === "arch") {
      const cap = div("cap");
      cap.textContent = S.captions[i % S.captions.length] || '';
      el.appendChild(cap);
    }
    if (frame !== "film" && frame !== "heart" && frame !== "star") addTape(el, S);

    makeDraggable(el);
    layer.appendChild(el);
  }

  // ---------------------------------------------------------------- stickers
  function addSticker(layer, id, xPct, yPct, sizePx, rot, idx, P) {
    const el = div("diecut-sticker vt-st");
    el.style.left = clamp(xPct, 0, 90) + "%";
    el.style.top = clamp(yPct, 0, 88) + "%";
    el.style.width = (sizePx / 6.4).toFixed(2) + "cqw";
    el.style.transform = "rotate(" + rot + "deg)";
    el.style.setProperty("--i", idx);

    el.innerHTML = svgFor(id, P); // our own drawings, not user text

    el.ondblclick = () => el.remove();
    makeDraggable(el);
    layer.appendChild(el);
    return el;
  }

  function slotHeightPct(sl) {
    const parts = sl.ar.split("/").map(Number);
    return sl.w * 1.2 * (parts[1] / parts[0]);
  }

  function placeStickers(layer, S) {
    S.stickers.slice(0, Math.max(1, Math.round(7 * S.density))).forEach((id, i) => {
      const sl = S.slots[i % S.slots.length];
      const hPct = slotHeightPct(sl);
      const corner = (i * 3 + Math.floor(S.R() * 4)) % 4;
      let x, y;
      if (corner === 0) { x = sl.x + sl.w - 6; y = sl.y - 6; }
      else if (corner === 1) { x = sl.x - 6; y = sl.y + hPct - 8; }
      else if (corner === 2) { x = sl.x + sl.w - 8; y = sl.y + hPct - 10; }
      else { x = sl.x - 7; y = sl.y - 7; }
      const size = 56 + Math.floor(S.R() * 40);
      addSticker(layer, id, x, y, size, Math.round(S.R() * 40 - 20), 5 + i, S.P);
    });
  }

  function placeGlitter(layer, S) {
    const count = Math.max(2, Math.round((S.themeId === "pop" ? 14 : 8) * S.density));
    for (let i = 0; i < count; i++) {
      const id = ["star", "star", "heart", "sparkle"][i % 4];
      const el = addSticker(layer, id, 2 + S.R() * 92, 2 + S.R() * 90, 20 + Math.floor(S.R() * 18), Math.round(S.R() * 50 - 25), i, S.P);
      el.classList.remove("vt-st");
      el.classList.add("vt-glit");
      el.style.zIndex = 24;
    }
  }

  function placeDoodles(layer, S) {
    const P = S.P;
    const cols = [P.accent[0], P.accent[1], P.dark ? P.ink : P.accentDark, P.accent[2]];
    const nDoodles = Math.max(1, Math.round(5 * S.density));
    for (let i = 0; i < nDoodles; i++) {
      const sl = S.slots[i % S.slots.length];
      const hPct = slotHeightPct(sl);
      const kind = DOODLE_IDS[Math.floor(S.R() * DOODLE_IDS.length)];
      const corner = (i + Math.floor(S.R() * 4)) % 4;
      let x, y;
      if (corner === 0) { x = sl.x + sl.w + 1; y = sl.y + 2; }
      else if (corner === 1) { x = sl.x - 10; y = sl.y + hPct * 0.4; }
      else if (corner === 2) { x = sl.x + sl.w * 0.5; y = sl.y + hPct + 1; }
      else { x = sl.x + sl.w * 0.3; y = sl.y - 9; }

      const el = div("vt-doodle");
      el.style.left = clamp(x, 0, 90) + "%";
      el.style.top = clamp(y, 0, 88) + "%";
      el.style.width = (7 + S.R() * 5).toFixed(1) + "cqw";
      el.style.transform = "rotate(" + Math.round(S.R() * 50 - 25) + "deg)";
      el.style.zIndex = 20;
      el.style.setProperty("--i", 6 + i);
      el.innerHTML = '<svg viewBox="0 0 100 100" style="stroke:' + cols[i % cols.length] + '">' + DOODLES[kind] + "</svg>";
      el.ondblclick = () => el.remove();
      makeDraggable(el);
      layer.appendChild(el);
    }
  }

  // ---------------------------------------------------------------- title, note, label, clip
  function addTitle(layer, S) {
    const P = S.P, R = S.R;
    const style = S.titleStyle;
    const wrap = div("vt-title vt-title-" + style);
    wrap.style.zIndex = 26;
    wrap.style.setProperty("--i", 14);

    if (style === "ransom") {
      const chips = P.paper.concat(P.accent, ["#ffffff", "#ffffff"]);
      S.title.split(/\s+/).filter(Boolean).forEach((word) => {
        const w = div("w");
        Array.from(word).forEach((ch, ci) => {
          const l = document.createElement("span");
          l.className = "l";
          l.textContent = ci === 0 || R() < 0.55 ? ch.toUpperCase() : ch.toLowerCase();
          l.style.fontFamily = RANSOM_FONTS[Math.floor(R() * RANSOM_FONTS.length)];
          l.style.fontSize = (4.2 + R() * 2.4).toFixed(2) + "cqw";
          l.style.transform = "rotate(" + (R() * 14 - 7).toFixed(1) + "deg) translateY(" + (R() * 1.2 - 0.6).toFixed(2) + "cqw)";
          if (R() < 0.68) {
            const bg = chips[Math.floor(R() * chips.length)];
            l.style.background = bg;
            l.style.color = readableOn(bg);
            if (R() < 0.3) l.style.borderRadius = ".6cqw";
          } else {
            l.style.color = P.dark ? "#ffffff" : P.ink;
            l.style.textShadow = ".2cqw .2cqw 0 " + rgba(P.accent[1], 0.8);
            l.style.boxShadow = "none";
          }
          w.appendChild(l);
        });
        wrap.appendChild(w);
      });
    } else {
      const t = div("one");
      t.textContent = S.title;
      if (style === "poster") {
        t.textContent = S.title.toUpperCase();
        t.style.fontFamily = "'Bungee','Anton',sans-serif";
        t.style.fontSize = "6.6cqw";
        t.style.color = P.accent[0];
        t.style.textShadow = ".5cqw .5cqw 0 " + P.accent[1] + ",1cqw 1cqw 0 " + P.ink;
      } else if (style === "script") {
        t.style.fontFamily = FONT.soft;
        t.style.fontSize = "8cqw";
        t.style.color = P.dark ? "#ffffff" : P.ink;
        t.style.textShadow = ".4cqw .4cqw 0 " + rgba("#ffffff", 0.8) + ",-.2cqw -.2cqw 0 " + rgba(P.accent[1], 0.8);
      } else if (style === "cinzel") {
        t.textContent = S.title.toUpperCase();
        t.style.fontFamily = FONT.cinzel;
        t.style.fontSize = "4.8cqw";
        t.style.letterSpacing = ".32em";
        t.style.color = P.dark ? "#ffffff" : P.ink;
        t.style.textShadow = "0 .3cqw 1cqw rgba(0,0,0,.45)";
      } else {
        t.style.fontFamily = "'Playfair Display',Georgia,serif";
        t.style.fontStyle = "italic";
        t.style.fontSize = "7cqw";
        t.style.color = P.dark ? "#ffffff" : P.ink;
        t.style.textShadow = ".3cqw .3cqw 0 " + rgba("#ffffff", 0.7);
      }
      wrap.appendChild(t);
    }

    makeDraggable(wrap);
    layer.appendChild(wrap);
  }

  function addNote(layer, S) {
    const z = S.layout.note;
    if (!z) return;
    const P = S.P;
    const bg = P.paper[1 + Math.floor(S.R() * 3)];
    const ink = readableOn(bg);

    const el = div("vt-note");
    el.style.left = z.x + "%";
    el.style.top = z.y + "%";
    el.style.width = z.w + "%";
    el.style.transform = "rotate(" + z.r + "deg)";
    el.style.zIndex = 14;
    el.style.setProperty("--i", 9);
    el.style.background = bg;
    el.style.color = ink;
    el.style.clipPath = tornPoly(S.R, 1.6);
    el.style.fontFamily = FONT[S.T.noteFont] || FONT.marker;

    const nt = div("nt");
    nt.textContent = S.listTitle;
    nt.style.color = P.dark ? P.accent[0] : P.accentDark;
    el.appendChild(nt);

    S.listItems.slice(0, 4).forEach((txt) => {
      const row = div("ni");
      row.textContent = "♡ " + txt;
      el.appendChild(row);
    });

    // the torn clip would cut the tape, so the tape lives on a wrapper-less sibling
    makeDraggable(el);
    layer.appendChild(el);
  }

  function addStrip(layer, S) {
    const sl = S.slots[Math.min(1, S.slots.length - 1)];
    const hPct = slotHeightPct(sl);
    const P = S.P;
    const bg = P.accent[1 + Math.floor(S.R() * 2)];
    const el = div("vt-strip");
    el.style.left = sl.x - 3 + "%";
    el.style.top = sl.y + hPct - 3 + "%";
    el.style.width = sl.w + 6 + "%";
    el.style.transform = "rotate(" + (S.R() * 8 - 4).toFixed(1) + "deg)";
    el.style.zIndex = 16;
    el.style.setProperty("--i", 10);
    el.style.background = bg;
    el.style.color = readableOn(bg);
    el.style.fontFamily = "'Bungee','Anton',sans-serif";
    el.style.fontSize = "2.6cqw";
    el.style.clipPath = "polygon(0 8%,3% 0,97% 6%,100% 0,98% 50%,100% 100%,3% 94%,0 100%,2% 50%)";
    el.textContent = S.stripText;
    makeDraggable(el);
    layer.appendChild(el);
  }

  function addClip(layer, S) {
    const sl = S.slots[0];
    const el = div("vt-clip");
    el.style.left = sl.x + sl.w * 0.12 + "%";
    el.style.top = sl.y - 5 + "%";
    el.style.width = "4.2cqw";
    el.style.transform = "rotate(" + (S.R() * 20 - 10).toFixed(1) + "deg)";
    el.style.zIndex = 30;
    el.style.setProperty("--i", 11);
    el.innerHTML = CLIP_SVG;
    makeDraggable(el);
    layer.appendChild(el);
  }

  // ---------------------------------------------------------------- vintage illustrations (Met Museum, CC0)
  function placeEphemera(memory, S) {
    const layer = $("collageItemsLayer");
    if (!layer) return;
    layer.querySelectorAll(".vt-eph").forEach((e) => e.remove());

    const items = S.archetype !== 'noir' && Array.isArray(memory.ai.eph) ? memory.ai.eph : [];
    items.slice(0, 3).forEach((it, i) => {
      const z = S.layout.eph[i];
      if (!z || !it.url) return;
      const card = div("vt-eph");
      card.style.left = z.x + "%";
      card.style.top = z.y + "%";
      card.style.width = z.w + "%";
      card.style.transform = "rotate(" + z.r + "deg)";
      card.style.zIndex = 8;
      card.style.background = S.P.paper[0];
      card.style.setProperty("--i", 12 + i);

      const im = new Image();
      im.src = it.url;
      im.alt = it.title || "";
      im.draggable = false;
      im.onerror = () => card.remove();
      card.appendChild(im);

      addTape(card, S);
      card.ondblclick = () => card.remove();
      makeDraggable(card);
      layer.appendChild(card);
    });

    const jp = document.querySelector("#bookSpread .vintage-journal-page");
    if (jp && jp.children[1]) {
      let c = jp.querySelector(".vt-credit");
      if (!c) { c = div("vt-credit"); jp.children[1].appendChild(c); }
      c.textContent = items.length ? "Vintage art: The Met Open Access (CC0)" : "";
      c.style.color = S.P.accentDark;
    }
  }

  async function loadEphemera(memory, scene) {
    if (scene.archetype === 'noir') return;
    const ai = memory.ai;
    if (!Array.isArray(ai.eph) || !ai.eph.length) {
      const T = THEMES[themeFor(ai)];
      const qs = (Array.isArray(ai.element_queries) && ai.element_queries.length ? ai.element_queries : T?.queries || []).slice(0, 2);
      if (!qs.length) return;
      try {
        const results = await Promise.all(
          qs.map((q) =>
            fetch("/api/elements?n=2&q=" + encodeURIComponent(q))
              .then((r) => (r.ok ? r.json() : { items: [] }))
              .catch(() => ({ items: [] }))
          )
        );
        const found = results.reduce((acc, r) => acc.concat(r.items || []), []).slice(0, 3);
        if (found.length) {
          ai.eph = found;
          persist();
        }
      } catch (e) {}
    }
    if (typeof activeMemory === "undefined" || activeMemory !== memory) return;
    if (Array.isArray(ai.eph) && ai.eph.length) placeEphemera(memory, buildScene(memory));
  }

  // ---------------------------------------------------------------- render the whole board
  let lastScene = null;
  function renderBook(memory) {
    const ai = memory.ai || (memory.ai = {});
    const S = buildScene(memory);
    lastScene = S;
    const T = S.T;
    const P = S.P;

    const spread = $("bookSpread");
    const board = $("collageBoard");
    const layer = $("collageItemsLayer");
    if (!spread || !board || !layer) return S;

    // board + journal page colours (all derived from the photo)
    spread.style.backgroundColor = P.board[0];
    const angle = S.style?.effects.gradient.angle ?? 135;
    const dots = `rgba(255,255,255,${P.dark ? 0.08 : 0.35})`;
    spread.style.backgroundImage = S.style ? '' : `radial-gradient(${dots} 1.2px, transparent 0), linear-gradient(${angle}deg, ${P.board[0]}, ${P.board[1]})`;
    spread.style.backgroundSize = S.style ? '' : '16px 16px,100% 100%';
    spread.style.borderRadius = S.style ? `${S.style.layout.radius}px` : '';
    if (S.style) {
      const { glow, motion, particles, texture } = S.style.effects;
      const noir = S.archetype === 'noir';
      spread.dataset.archetype = S.archetype;
      spread.dataset.texture = noir ? 'rain' : texture;
      spread.dataset.motion = motion && !noir ? 'on' : 'off';
      const cream = mixHex(P.jpBg, P.accent[0], P.dark ? 0.24 : 0.10);
      const properties = {
        from: P.board[0], to: P.board[1], angle: `${angle}deg`,
        accent: P.accent[0], secondary: P.accent[2], cream,
        'on-cream': onColor(cream), 'on-accent': onColor(P.accent[0]),
        glow: noir ? .07 : glow, grain: noir ? .13 : particles, cycle: `${motion || 27}s`
      };
      for (const [key, value] of Object.entries(properties)) spread.style.setProperty(`--book-${key}`, value);
    } else {
      delete spread.dataset.archetype;
      delete spread.dataset.texture;
      delete spread.dataset.motion;
      spread.style.removeProperty('--book-cycle');
    }
    spread.style.setProperty('--vt-heading-weight', S.style?.typography.headingWeight ?? 700);
    spread.style.setProperty('--vt-body-weight', S.style?.typography.bodyWeight ?? 400);
    spread.style.borderColor = S.style ? mixHex(P.jpBg, P.accent[0], 0.65)
      : P.dark ? mixHex(P.board[0], '#ffffff', 0.7) : '#fffaf3';
    spread.style.setProperty("--f-title", T.fTitle);
    spread.style.setProperty("--f-hand", T.fHand);
    spread.style.setProperty("--jp-bg", P.jpBg);
    spread.style.setProperty("--jp-ink", P.ink);
    spread.style.setProperty("--jp-line", rgba(P.ink, 0.1));
    spread.style.setProperty("--jp-dash", rgba(P.ink, 0.28));
    spread.style.setProperty("--jp-accent", P.accentDark);

    applyEdge(spread.querySelector(".airmail-border"), T, P);

    let bd = $("vtBackdrop");
    if (!bd) {
      bd = div("");
      bd.id = "vtBackdrop";
      board.insertBefore(bd, board.firstChild);
    }
    bd.innerHTML = "";
    if (T.patchwork) safe(() => addPatchwork(bd, S));
    T.scraps.forEach((sp, i) => safe(() => bd.appendChild(makeScrap(sp, S, i))));

    layer.innerHTML = "";
    S.slots.forEach((_, i) => addFrame(layer, S, i));
    placeStickers(layer, S);

    if (T.extras.includes("note") && S.density > 0.45) safe(() => addNote(layer, S));
    if (T.extras.includes("strip") && S.density > 0.45) safe(() => addStrip(layer, S));
    if (T.extras.includes("doodles") && S.density > 0.3) safe(() => placeDoodles(layer, S));
    if (T.extras.includes("glitter") && S.density > 0.5) safe(() => placeGlitter(layer, S));
    if (T.extras.includes("clip") && S.density > 0.6) safe(() => addClip(layer, S));
    safe(() => addTitle(layer, S));

    // journal page text colours (readable on dark worlds too)
    const jp = document.querySelector("#bookSpread .vintage-journal-page");
    if (jp) {
      jp.querySelectorAll("div, p").forEach((n) => {
        const t = n.textContent || "";
        if (t.indexOf("Add vintage cutouts") === 0 || t.indexOf("Drag photos") === 0) n.style.color = P.accentDark;
      });
    }

    // buttons: stickers of this world + style controls
    const bar = document.querySelector("#scrapbookModal .sticker-bar");
    if (bar) {
      bar.innerHTML = "";
      const mk = (label, fn) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cutout-add-btn";
        b.textContent = label;
        b.onclick = () => fn(b);
        bar.appendChild(b);
      };
      T.stickers.slice(0, 5).forEach((id) => mk("+ " + id, () => window.spawnCutout(id)));
      mk('🎲 Layout', async button => {
        button.disabled = true;
        await turnPage(memory, () => { ai.layoutIndex = (S.layoutIndex + 1) % S.layoutCount; });
        button.disabled = false;
      });
      if (S.themeId) mk("🌈 Colors", () => {
        const order = ["analogous", "complementary", "triadic", "mono"];
        ai.harmony = order[(order.indexOf(S.P.harmony) + 1) % order.length];
        persist();
        refresh(memory);
      });

    }

    if (Array.isArray(ai.eph) && ai.eph.length) safe(() => placeEphemera(memory, S));

    // Atmosphere Engine adds its artistic technique (impressionism, film, geometry...) and live effects
    if (typeof window.__vtAfterRender === "function") safe(() => window.__vtAfterRender(memory, S));
    return S;
  }

  function refresh(memory) {
    const S = renderBook(memory);
    const d = $("liveDate");
    if (d) d.textContent = (memory.dateStr || "") + " • " + S.T.label.toUpperCase();
    const atmosphere = $('liveAtmosphere');
    if (atmosphere) atmosphere.textContent = S.archetype === 'noir' ? 'Rain on charcoal paper' : S.style?.vibe || memory.ai?.atmosphere || '';
    return S;
  }

  const scrapbook = $('scrapbookModal');
  const isOpenMemory = memory => activeMemory === memory && scrapbook.classList.contains('open');

  async function turnPage(memory, update) {
    if (!isOpenMemory(memory)) return false;
    const layer = $('collageItemsLayer');
    const fade = !matchMedia('(prefers-reduced-motion: reduce)').matches && layer.animate?.(
      [{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'ease-out', fill: 'forwards' }
    );
    try {
      if (fade) await fade.finished;
      if (!isOpenMemory(memory)) return false;
      update();
      persist();
      refresh(memory);
      return true;
    } finally {
      fade?.cancel?.();
    }
  }

  bindAtmosphereForm($('scrapbookAtmosphereForm'), prompt => {
    const memory = activeMemory;
    if (!memory || !isOpenMemory(memory)) return null;
    const story = $('liveStory').textContent.trim();
    return {
      context: { prompt, story, song: window.backgroundMusic?.title || memory.ai.song?.title, page: 'Scrapbook paper collage' },
      apply: style => turnPage(memory, () => {
        const ai = memory.ai;
        ai.title = $('liveTitle').textContent.trim() || ai.title;
        ai.journal_entry = story;
        ai.atmosphereStyle = style;
        ai.designPrompt = prompt;
        delete ai.layoutIndex;
        delete ai.theme;
      })
    };
  });

  async function ensurePalette(memory) {
    const ai = memory.ai || (memory.ai = {});
    if (Array.isArray(ai.dom) && ai.dom.length) return;
    if (!memory.photos || !memory.photos[0]) return;
    const d = await extractDominant(memory.photos[0]);
    if (d.colors.length) {
      ai.dom = d.colors;
      persist();
    }
  }

  // ---------------------------------------------------------------- overrides of the old functions
  window.spawnCutout = function (type) {
    const layer = $("collageItemsLayer");
    if (!layer) return;
    addSticker(layer, type, 25 + Math.random() * 45, 22 + Math.random() * 45, 64 + Math.floor(Math.random() * 36),
      Math.round(Math.random() * 24 - 12), 1, lastScene?.P);
  };

  let scrapbookReady;
  window.openScrapbookModal = function (memory, isShared) {
    closeAllModals();
    activeMemory = memory;
    const ai = ensureReelCopy(memory.ai || (memory.ai = {}));

    // freeze the look, so friends see exactly what you see
    if (ai.layoutSeed == null) ai.layoutSeed = hash(memory.id || ai.title || "viv");
    if (!themeFor(ai)) ai.atmosphereStyle = memoryAtmosphere(ai);
    persist();

    $("sharedBadge").style.display = isShared ? "inline-block" : "none";

    $("liveTitle").textContent = ai.title || "One day to remember.";
    $("liveAtmosphere").textContent = ai.atmosphereStyle?.vibe || ai.atmosphere || '';
    $('bookAtmospherePanel').open = false;
    $('scrapbookAtmosphereForm').elements.prompt.value = '';
    $('scrapbookAtmosphereStatus').textContent = '';
    $("liveStory").textContent = ai.journal_entry || "";

    const songLabel = ai.song && ai.song.title
      ? ai.song.title + (ai.song.artist ? " — " + ai.song.artist : "")
      : "Sweater Weather — The Neighbourhood";
    $("liveSongTitle").textContent = songLabel;
    $("youtubeSearchLink").href = "https://www.youtube.com/results?search_query=" + encodeURIComponent(songLabel);

    $("scrapbookModal").classList.add("open");
    startModalMusic(memory);

    const paletteReady = Promise.all([
      themeFor(ai) && ensurePalette(memory),
      !Object.hasOwn(ai, 'photoColors') && analyzePhotos(memory.photos).then(colors => {
        ai.photoColors = colors;
        persist();
      })
    ]);
    scrapbookReady = paletteReady.then(() => {
      if (!isOpenMemory(memory)) return;
      loadEphemera(memory, refresh(memory));
    });
    return scrapbookReady;
  };

  // the other modules (atmosphere.js, reel.js, diary.js) use these
  window.VT = {
    THEMES, THEME_IDS, buildScene, buildScheme, themeFor, svgFor, allStickerIds,
    mixHex, rgba, shade, readableOn, hexHsl, hslToHex, isHex, hash, mulberry, refresh, analyzePhotos, ready: () => scrapbookReady
  };
})();

