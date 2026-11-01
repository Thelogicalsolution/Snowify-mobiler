// Looks for signs that an audiobook is voiced by AI. This only catches the ones that admit it.
const PHRASES = [
  'text to speech',
  'text-to-speech',
  'synthetic voice',
  'synthesized voice',
  'synthesised voice',
  'synthetic narrat',
  'elevenlabs',
  'artificial intelligence',
  'neural voice',
  'neural narrat',
  'ai voice',
  'ai-voice',
  'ai narrat',
  'ai-narrat',
  'ai-generated',
  'ai generated',
  'штучний інтелект',
  'штучного інтелекту',
  'штучним інтелектом',
  'нейромереж',
  'нейроозвуч',
  'нейро-озвуч',
  'нейро озвуч',
  'синтезован',
  'искусственный интеллект',
  'искусственного интеллекта',
  'нейросет',
  'синтезирован',
];

const CONTEXT_EN = /voice|voiced|narrat|generat|creat|translat|speech|dubb|synthes|clone/i;
const CONTEXT_CYR = /озвуч|голос|диктор|переклад|читає|читан|створен|згенеров|генерац|нейро|синтез|клон|речь|чита/i;

function isLetter(ch: string): boolean {
  return /[A-Za-zА-Яа-яІіЇїЄєҐґ]/.test(ch);
}

// Text around every standalone occurrence of the token (so "AI" does not match inside other words).
function tokenWindows(text: string, token: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const i = text.indexOf(token, from);
    if (i < 0) break;
    const before = i > 0 ? text[i - 1] : ' ';
    const after = i + token.length < text.length ? text[i + token.length] : ' ';
    if (!isLetter(before) && !isLetter(after)) {
      out.push(text.slice(Math.max(0, i - 32), i + token.length + 32));
    }
    from = i + token.length;
  }
  return out;
}

// Returns what was found (for the tag) or null.
export function detectAiVoice(text: string): string | null {
  const lower = text.toLowerCase();
  for (const p of PHRASES) {
    if (lower.includes(p)) return p;
  }
  if (/\btts\b/i.test(text)) return 'TTS';
  for (const w of tokenWindows(text, 'AI')) {
    if (CONTEXT_EN.test(w)) return 'AI';
  }
  for (const tok of ['ШІ', 'ИИ']) {
    for (const w of tokenWindows(text, tok)) {
      if (CONTEXT_CYR.test(w) || CONTEXT_EN.test(w)) return tok;
    }
  }
  return null;
}

const HUMAN_EN = /(narrated|read|performed|voiced)\s+by\s+(?!AI\b)[A-Z][A-Za-z'.-]+/;
const HUMAN_CYR = /(читає|озвучує|диктор|читець|читает|озвучивает|чтец)[:\s]+[А-ЯІЇЄҐ][а-яіїєґ']+/i;

// True when the text names a narrator. A hint, not proof.
export function narratorNamed(text: string): boolean {
  return HUMAN_EN.test(text) || HUMAN_CYR.test(text);
}