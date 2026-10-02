/**
 * npm run logos:update
 *
 * Downloads the 30 NBA team logos from ESPN (no key needed) into
 * client/public/logos/nba/ABBR.png, 256 px, in the variant made for dark
 * backgrounds. Only needed when a team changes its logo.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ESPN_ABBR } from './espn';
import type { RawRoster } from './roster';
import { fail, log } from './secrets';

const root = fileURLToPath(new URL('../../', import.meta.url));
const OUT = `${root}client/public/logos/nba/`;
const SIZE = 256;

interface ApiTeams {
  sports: { leagues: { teams: { team: { abbreviation: string; logos?: { href: string; rel: string[] }[] } }[] }[] }[];
}

async function main(): Promise<void> {
  const ours = (JSON.parse(readFileSync(`${root}shared/data/roster.json`, 'utf8')) as RawRoster).teams.map((t) => t.abbr);
  const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams');
  if (!res.ok) fail(`ESPN 球隊清單回應 ${res.status}`);
  const teams = (await res.json()) as ApiTeams;

  mkdirSync(OUT, { recursive: true });
  let done = 0;
  for (const { team } of teams.sports[0].leagues[0].teams) {
    const abbr = ESPN_ABBR[team.abbreviation] ?? team.abbreviation;
    if (!ours.includes(abbr)) continue;
    const logos = team.logos ?? [];
    const pick =
      logos.find((l) => l.rel.includes('dark') && !l.rel.includes('scoreboard')) ?? logos.find((l) => l.rel.includes('default'));
    if (!pick) fail(`${abbr} 沒有隊徽`);
    const path = new URL(pick.href).pathname;
    const img = await fetch(`https://a.espncdn.com/combiner/i?img=${path}&w=${SIZE}&h=${SIZE}`);
    if (!img.ok) fail(`${abbr} 隊徽下載失敗（${img.status}）`);
    writeFileSync(`${OUT}${abbr}.png`, Buffer.from(await img.arrayBuffer()));
    done++;
  }
  if (done !== ours.length) fail(`只下載到 ${done}/${ours.length} 隊`);
  log(`已更新 ${done} 隊隊徽 → client/public/logos/nba/`);
}

main().catch((e: Error) => fail(e.message));
