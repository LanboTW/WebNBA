/**
 * npm run looks:fill
 *
 * Gives every player in shared/data/custom-teams.json who has no look one:
 * skin 3, short hair, no beard, plus accessories rolled from the name. Only
 * adds to the end of those players' lines; the rest of the file is untouched.
 * Edit the values afterwards as you like; this never changes an existing look.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defaultLook } from './looks';
import { formatLook } from './roster';
import { fail, log } from './secrets';

const FILE = fileURLToPath(new URL('../../shared/data/custom-teams.json', import.meta.url));

export function fillCustomLooks(text: string): { text: string; added: string[] } {
  const added: string[] = [];
  const lines = text.split(/(\r?\n)/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(\[.*\])(\s*,?\s*)$/);
    if (!m) continue;
    let player: unknown;
    try {
      player = JSON.parse(m[2]);
    } catch {
      continue;
    }
    // A player line: [name, number, height, position, [ratings]] without a sixth element.
    if (!Array.isArray(player) || player.length !== 5 || typeof player[0] !== 'string' || !Array.isArray(player[4])) continue;
    lines[i] = `${m[1]}${m[2].slice(0, -1)}, ${formatLook(defaultLook(player[0]))}]${m[3]}`;
    added.push(player[0]);
  }
  return { text: lines.join(''), added };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const { text, added } = fillCustomLooks(readFileSync(FILE, 'utf8'));
    JSON.parse(text);
    if (!added.length) {
      log('每位自訂球員都已經有外觀了。');
    } else {
      writeFileSync(FILE, text);
      log(`已幫 ${added.length} 人加上外觀：${added.join('、')}`);
      log('可以直接改 custom-teams.json 裡的 skin／hair／beard 等欄位，改完跑 npm test 檢查。');
    }
  } catch (e) {
    fail('補外觀失敗：', e instanceof Error ? e.message : String(e));
  }
}
