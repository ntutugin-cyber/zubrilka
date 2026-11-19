/* Сканирует decks/ и пересобирает decks/index.json.
   Запуск: node tools/build-manifest.mjs
   Сохраняет description/emoji/accent/tags из старого манифеста. */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DECKS = join(dirname(fileURLToPath(import.meta.url)), '..', 'decks');
const MANIFEST = join(DECKS, 'index.json');

const decode = s => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

let old = [];
try { old = (JSON.parse(await readFile(MANIFEST, 'utf8'))).decks || []; } catch { /* первый запуск */ }

const decks = [];
for (const ent of await readdir(DECKS, { withFileTypes: true })) {
  if (!ent.isDirectory()) continue;
  const dir = join(DECKS, ent.name);
  const files = (await readdir(dir)).filter(f => f.toLowerCase().endsWith('.xml'));
  if (!files.length) continue;
  const file = files.includes('deck.xml') ? 'deck.xml' : files[0];
  const text = await readFile(join(dir, file), 'utf8');
  const title = decode(/<deck[^>]*\btitle\s*=\s*"([^"]*)"/.exec(text)?.[1] || ent.name);
  const count = (text.match(/<card[\s>]/g) || []).length;
  const meta = old.find(d => d.id === ent.name) || {};
  decks.push({
    id: ent.name,
    path: ent.name + '/' + file,
    title: meta.title || title,
    description: meta.description || '',
    emoji: meta.emoji || '📚',
    accent: meta.accent || 'violet',
    tags: meta.tags || [],
    count
  });
  console.log(`✓ ${ent.name}: «${title}» — ${count} карточек`);
}

decks.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
await writeFile(MANIFEST, JSON.stringify({ version: 1, decks }, null, 2) + '\n');
console.log(`\nМанифест обновлён: ${MANIFEST} (${decks.length} колод)`);