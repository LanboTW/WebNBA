/**
 * npm run headshots:update
 *
 * Downloads every rostered NBA player's ESPN headshot (no key needed) into
 * client/public/headshots/<ESPN id>.png for the MyTeam cards, and writes
 * shared/data/headshots.json (player name -> ESPN id) so the game knows
 * which players have a photo. Players ESPN has no photo for get a drawn
 * portrait in the game instead. Run after roster:update.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ESPN_ABBR } from './espn';
import { normaliseName, type RawRoster } from './roster';
import { fail, log } from './secrets';

const root = fileURLToPath(new URL('../../', import.meta.url));
const OUT = `${root}client/public/headshots/`;
const INDEX = `${root}shared/data/headshots.json`;
const API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
/** ESPN's photos are 4:3; this keeps every file small. */
const W = 280;
const H = 210;
const force = process.argv.includes('--force');

interface ApiTeams {
  sports: { leagues: { teams: { team: { id: string; abbreviation: string } }[] }[] }[];
}
interface ApiRoster {
  athletes: { id: string; displayName: string; headshot?: { href?: string } }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(3000 * (attempt + 1));
      continue;
    }
    return res;
  }
}

async function main(): Promise<void> {
  const roster = JSON.parse(readFileSync(`${root}shared/data/roster.json`, 'utf8')) as RawRoster;
  const wanted = new Map(roster.teams.flatMap((t) => t.players.map((p) => [normaliseName(p[0]), p[0]] as const)));
  const res = await get(`${API}/teams`);
  if (!res.ok) fail(`ESPN 球隊清單回應 ${res.status}`);
  const teams = ((await res.json()) as ApiTeams).sports[0].leagues[0].teams;

  mkdirSync(OUT, { recursive: true });
  const index: Record<string, string> = {};
  let fetched = 0;
  for (const { team } of teams) {
    const abbr = ESPN_ABBR[team.abbreviation] ?? team.abbreviation;
    const r = await get(`${API}/teams/${team.id}/roster`);
    if (!r.ok) fail(`ESPN ${abbr} 名單回應 ${r.status}`);
    for (const a of ((await r.json()) as ApiRoster).athletes ?? []) {
      const name = wanted.get(normaliseName(a.displayName));
      const href = a.headshot?.href;
      if (!name || !href || !/^\d+$/.test(a.id)) continue;
      const file = `${OUT}${a.id}.png`;
      if (force || !existsSync(file)) {
        const img = await get(`https://a.espncdn.com/combiner/i?img=${new URL(href).pathname}&w=${W}&h=${H}`);
        if (!img.ok) {
          log(`  ${name}：照片下載失敗（${img.status}），略過`);
          continue;
        }
        writeFileSync(file, Buffer.from(await img.arrayBuffer()));
        fetched++;
        await sleep(60);
      }
      index[name] = a.id;
    }
    await sleep(150);
  }
  const sorted = Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(INDEX, `${JSON.stringify({ players: sorted }, null, 2)}\n`);
  const missing = [...wanted.values()].filter((n) => !index[n]);
  log(`有照片 ${Object.keys(index).length}/${wanted.size} 人（新下載 ${fetched} 張）→ client/public/headshots/`);
  if (missing.length) log(`沒有照片（遊戲內改用繪製的頭像）：${missing.join('、')}`);
}

main().catch((e: Error) => fail(e.message));
