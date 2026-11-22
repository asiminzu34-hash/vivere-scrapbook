export const REEL_COPY_RULES = `Write in English, even when the diary is in another language. Use its details and mood as inspiration, not text to copy.
- title: an evocative title of 2–5 words and at most 48 characters. No ellipses, quotations, or partial diary sentences.
- captions: 3–6 distinct cinematic phrases of 2–6 words each, in chronological or emotional progression. Never quote the diary.
- voiceover: one or two complete, nostalgic sentences totaling 12–24 words. Keep them easy to read aloud and true to the story. Do not invent specific events or people.`;

const words = text => text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) || [];
const plain = (value, max) => {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return text.length <= max && !/[<>]|\.{2,}|…/.test(text) ? text : '';
};
const fold = text => words(text).join(' ').toLowerCase();
const echoesStory = (text, story) => !!story && !!text && ` ${fold(story)} `.includes(` ${fold(text)} `);
const brief = (value, max, minWords, maxWords) => {
  const text = plain(value, max);
  const count = words(text).length;
  return count >= minWords && count <= maxWords ? text : '';
};

export function localReelCopy({ story = '', style, song = '' } = {}) {
  const texture = style?.effects?.texture;
  const context = `${story} ${song}`;
  const late = /\b(late|night|midnight|sleepover)\b/i.test(story);
  let title, captions, voiceover;
  if (/\buno\b/i.test(story)) {
    title = late ? 'Late Night UNO & Laughter' : 'UNO & Little Joys';
    captions = ['Cards on the table', 'One more round', 'The laughter stayed', 'A little joy'];
    voiceover = 'I remember the game less than the feeling of being together. That is the part I would play again.';
  } else if (/\b(birthday\w*|cumpleaños|anniversaire)\b/i.test(story)) {
    title = 'A Birthday in Bloom';
    captions = ['A day for you', 'Joy in little things', 'Time moved softly', 'Keep this close'];
    voiceover = 'Of all the days that pass, this one still feels bright. I keep its warmth close.';
  } else if (/\bsleepover\b/i.test(story)) {
    title = /\bgolden hour\b/i.test(story) ? 'Golden Hour Sleepover' : 'The Night We Kept';
    captions = ['Settling into the night', 'No need to hurry', 'A little more time', 'Still feels close'];
    voiceover = 'The night felt like it belonged to us. Even now, I wish we could stay there a little longer.';
  } else if (/\b(coast|ocean|beach|seaside|shore|waves)\b/i.test(story)) {
    title = 'Where the Tide Lingers';
    captions = ['Along the shore', 'Time went quiet', 'Held by the tide', 'Take me back'];
    voiceover = 'Some days feel as if they move with the tide. This one keeps finding its way back to me.';
  } else if (/\b(rain\w*|midnight|storm\w*)\b/i.test(context) || texture === 'rain') {
    title = /\brain\w*\b/i.test(story) ? 'When the Rain Stayed' : 'Quiet After Midnight';
    captions = ['The world grew quiet', 'Still in the dark', 'A small warmth', 'Softly held'];
    voiceover = 'There was a quiet to that moment I still remember. The feeling stayed long after the day was gone.';
  } else if (/\b(golden hour|sunset|autumn|nostalgi\w*)\b/i.test(context) || texture === 'grain') {
    title = 'Where the Light Lingers';
    captions = ['Light on everything', 'An ordinary wonder', 'Time slowed down', 'A moment kept'];
    voiceover = 'I did not know how much I would miss the small things. Now they are what bring that day back.';
  } else if (texture === 'sparkles') {
    title = 'The Bright Little Things';
    captions = ['A little brighter', 'The feeling stayed', 'Joy in the details', 'Worth holding onto'];
    voiceover = 'What I remember most is how bright it felt. Some moments keep giving back long after they are over.';
  } else {
    title = 'The Space Between Moments';
    captions = ['The little things', 'Time held still', 'Closer than memory', 'Something to keep'];
    voiceover = 'It is the little things that come back to me. I am glad I got to keep this moment.';
  }
  return { title, captions, voiceover };
}

export function resolveReelCopy(value, context = {}) {
  const fallback = localReelCopy(context);
  const story = typeof context.story === 'string' ? context.story : '';
  const title = brief(value?.title, 48, 2, 5);
  const captions = [...new Set((Array.isArray(value?.captions) ? value.captions.slice(0, 6) : [])
    .map(caption => brief(caption, 46, 2, 6)).filter(caption => caption && !echoesStory(caption, story)))];
  const voiceover = brief(value?.voiceover, 180, 12, 24);
  const sentences = voiceover.match(/[.!?]+/g)?.length;
  return {
    title: title && !echoesStory(title, story) && !/^["“]|["”.!?]$/.test(title) ? title : fallback.title,
    captions: captions.length >= 3 ? captions : fallback.captions,
    voiceover: voiceover && /[.!?]$/.test(voiceover) && sentences <= 2 && !echoesStory(voiceover, story)
      ? voiceover : fallback.voiceover
  };
}

// Repair generated story fragments in old memories without replacing deliberately edited titles.
export function ensureReelCopy(ai = {}) {
  const story = typeof ai.journal_entry === 'string' ? ai.journal_entry : '';
  const copy = resolveReelCopy(ai, { story, song: ai.song?.title, style: ai.atmosphereStyle });
  const current = typeof ai.title === 'string' ? ai.title.trim() : '';
  const rawPrefix = current && fold(story).startsWith(`${fold(current)} `);
  const looksGenerated = /(?:\.{3}|…)$/.test(current) || rawPrefix || (current && fold(current) === fold(story));
  ai.title = current && !looksGenerated ? current : copy.title;
  ai.captions = copy.captions;
  ai.voiceover = copy.voiceover;
  return ai;
}
