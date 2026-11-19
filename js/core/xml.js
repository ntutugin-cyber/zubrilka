/* Разбор и сборка XML-колод, слияние с пропуском дубликатов, шаблон. */
import { cardKey, esc } from './utils.js';

const cleanText = t => String(t || '')
  .split('\n').map(l => l.trim()).join('\n')
  .replace(/\n{3,}/g, '\n\n').trim();

const splitMedia = s => String(s || '').split('|').map(t => t.trim()).filter(Boolean);

export function parse(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('XML повреждён: ' + err.textContent.replace(/\s+/g, ' ').slice(0, 120));
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'deck')
    throw new Error('Ожидался корневой элемент <deck>');

  const title = (root.getAttribute('title') || 'Без названия').trim();
  const cards = [];
  [...root.getElementsByTagName('card')].forEach((ce, ci) => {
    const qe = ce.getElementsByTagName('question')[0];
    if (!qe) throw new Error(`Карточка ${ci + 1}: нет <question>`);
    const question = cleanText(qe.textContent);
    if (!question) throw new Error(`Карточка ${ci + 1}: пустой вопрос`);

    const answers = [...ce.getElementsByTagName('answer')].map(ae => ({
      text: cleanText(ae.textContent),
      correct: /^(true|1|yes)$/i.test(ae.getAttribute('correct') || ''),
      media: splitMedia(ae.getAttribute('media'))
    })).filter(a => a.text || a.media.length);

    if (!answers.length) throw new Error(`Карточка ${ci + 1}: нет вариантов ответа`);
    if (!answers.some(a => a.correct)) throw new Error(`Карточка ${ci + 1}: не отмечен правильный ответ (correct="true")`);

    cards.push({
      question,
      media: splitMedia(qe.getAttribute('media')),
      answers,
      hint: cleanText(ce.getElementsByTagName('hint')[0]?.textContent || ''),
      explanation: cleanText(ce.getElementsByTagName('explanation')[0]?.textContent || '')
    });
  });
  if (!cards.length) throw new Error('В колоде нет карточек');
  return { title, cards };
}

export function serialize({ title, cards }) {
  const L = [`<deck title="${esc(title)}">`];
  for (const c of cards) {
    L.push('  <card>');
    L.push(`    <question${c.media?.length ? ` media="${esc(c.media.join('|'))}"` : ''}>${esc(c.question)}</question>`);
    L.push('    <answers>');
    for (const a of c.answers) {
      const attrs = (a.correct ? ' correct="true"' : '') +
        (a.media?.length ? ` media="${esc(a.media.join('|'))}"` : '');
      L.push(`      <answer${attrs}>${esc(a.text)}</answer>`);
    }
    L.push('    </answers>');
    if (c.hint) L.push(`    <hint>${esc(c.hint)}</hint>`);
    if (c.explanation) L.push(`    <explanation>${esc(c.explanation)}</explanation>`);
    L.push('  </card>');
  }
  L.push('</deck>');
  return L.join('\n');
}

/* Несколько XML = одна колода. Дубликат = тот же вопрос и тот же набор вариантов. */
export function merge(list) {
  const seen = new Set();
  const cards = [];
  let skipped = 0, title = '';
  for (const d of list) {
    if (!title || title === 'Без названия') title = d.title;
    for (const c of d.cards) {
      const k = cardKey(c);
      if (seen.has(k)) { skipped++; continue; }
      seen.add(k); cards.push(c);
    }
  }
  return { title, cards, skipped };
}

export const TEMPLATE = `<deck title="Название темы">
  <card>
    <question media="schema.png">Текст вопроса?</question>
    <answers>
      <answer correct="true" media="voice.mp3|photo.jpg">Ответ</answer>
      <answer>Неверный вариант</answer>
    </answers>
    <hint>Подсказка; ссылки https://… станут плитками</hint>
    <explanation>Пояснение к правильному ответу</explanation>
  </card>
</deck>`;