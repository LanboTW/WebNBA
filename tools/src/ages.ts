import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESPN_ABBR } from './espn';

/**
 * npm run ages:update — birthdays of every player on an NBA roster, from
 * ESPN's public site API (no key), into shared/data/birthdays.json. Career
 * mode ages the league from these; players not listed get a guessed age.
 * roster.json is left alone.
 */

const API = process.env.ESPN_API_BASE || 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(root, 'shared/data/birthdays.json');
const ROSTER = resolve(root, 'shared/data/roster.json');

interface Athlete {
  displayName: string;
  dateOfBirth?: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`ESPN ${path} 回應 ${res.status}`);
  return (await res.json()) as T;
}

async function main(): Promise<void> {
  const ours = new Set((JSON.parse(readFileSync(ROSTER, 'utf8')) as { teams: { abbr: string; players: [string][] }[] }).teams.flatMap((t) => t.players.map((p) => p[0])));
  const league = (await get<{ sports: { leagues: { teams: { team: { id: string; abbreviation: string } }[] }[] }[] }>('/teams')).sports[0].leagues[0];
  const players: Record<string, string> = {};
  for (const { team } of league.teams) {
    const abbr = ESPN_ABBR[team.abbreviation] ?? team.abbreviation;
    const roster = await get<{ athletes: Athlete[] }>(`/teams/${team.id}/roster`);
    for (const a of roster.athletes ?? []) if (a.dateOfBirth) players[a.displayName] = a.dateOfBirth.slice(0, 10);
    console.log(`${abbr}: ${roster.athletes?.length ?? 0} 人`);
  }
  // Our roster may spell a name without ESPN's suffix ("Jimmy Butler" for "Jimmy Butler III").
  const bare = (n: string) => n.replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, '').toLowerCase();
  for (const name of ours) {
    if (players[name]) continue;
    const match = Object.keys(players).find((n) => bare(n) === bare(name));
    if (match) players[name] = players[match];
  }
  const sorted = Object.fromEntries(Object.entries(players).sort(([a], [b]) => a.localeCompare(b)));
  const missing = [...ours].filter((n) => !sorted[n]);
  writeFileSync(OUT, `${JSON.stringify({ updated: new Date().toISOString().slice(0, 10), players: sorted }, null, 2)}\n`);
  console.log(`寫入 ${Object.keys(sorted).length} 位球員生日 → shared/data/birthdays.json`);
  if (missing.length) console.log(`名單上沒有生日資料的球員（會用猜的年齡）：${missing.join(', ')}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
