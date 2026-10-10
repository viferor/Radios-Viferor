// Una sola función para todo lo de «Mi música» (el plan gratuito de Vercel admite como
// mucho 12 funciones). vercel.json reescribe /api/lyrics, /api/translate,
// /api/song-meaning, /api/lyrics-publish y /api/autoeq hacia aquí con ?fn=…
import lyrics from './_lyrics.js';
import translate from './_translate.js';
import songMeaning from './_song-meaning.js';
import lyricsPublish from './_lyrics-publish.js';
import autoeq from './_autoeq.js';

const HANDLERS = { lyrics, translate, 'song-meaning': songMeaning, 'lyrics-publish': lyricsPublish, autoeq };

export default function handler(req, res) {
  const u = new URL(req.url || '/', 'http://localhost');
  const fn = u.searchParams.get('fn') || u.pathname.split('/').filter(Boolean).pop();
  const h = HANDLERS[fn];
  if (!h) return res.status(404).json({ error: 'Función desconocida' });
  return h(req, res);
}
