import type { SourcePlayer } from './roster';
import { log } from './secrets';

/** ESPN_API_BASE only exists for testing against a mock server. */
const API = process.env.ESPN_API_BASE || 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

/** ESPN abbreviations that differ from ours. */
export const ESPN_ABBR: Record<string, string> = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS' };

interface ApiTeams {
  sports: { leagues: { season?: { displayName?: string }; teams: { team: { id: string; abbreviation: string } }[] }[] }[];
}

export interface ApiAthlete {
  displayName: string;
  jersey?: string;
  /** Inches. */
  height?: number;
  position?: { abbreviation?: string };
  experience?: { years?: number };
  headshot?: { href?: string };
}

interface ApiRoster {
  season?: { year?: number; displayName?: string };
  athletes: ApiAthlete[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`);
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(3000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`ESPN ${path} 回應 ${res.status}`);
    return (await res.json()) as T;
  }
}

/**
 * Current team rosters from ESPN's public site API (no key needed). They list
 * exactly who is on each team, so the merge treats them as an active feed.
 * Fails if any of our teams is missing, so a renamed team cannot empty one.
 */
export async function espnPlayers(ours: string[]): Promise<{ season: string | null; players: SourcePlayer[] }> {
  const league = (await get<ApiTeams>('/teams')).sports[0].leagues[0];
  const teams = league.teams.map(({ team }) => ({ id: team.id, abbr: ESPN_ABBR[team.abbreviation] ?? team.abbreviation }));
  const missing = ours.filter((a) => !teams.some((t) => t.abbr === a));
  if (missing.length) throw new Error(`ESPN 球隊清單對不上：缺少 ${missing.join(', ')}`);

  const players: SourcePlayer[] = [];
  let season = league.season?.displayName ?? null;
  for (const t of teams.filter((t) => ours.includes(t.abbr))) {
    const roster = await get<ApiRoster>(`/teams/${t.id}/roster`);
    if (!roster.athletes?.length) throw new Error(`ESPN ${t.abbr} 名單是空的`);
    season = roster.season?.displayName ?? season;
    const year = roster.season?.year ?? null;
    players.push(...roster.athletes.map((a) => toSource(a, t.abbr, year)));
    await sleep(150);
  }
  log(`  已讀取 ${teams.length} 隊`);
  return { season, players };
}

export function toSource(a: ApiAthlete, team: string, seasonYear: number | null): SourcePlayer {
  const years = a.experience?.years;
  return {
    name: a.displayName.trim(),
    team,
    number: a.jersey && /^\d+$/.test(a.jersey) ? Number(a.jersey) : null,
    heightM: a.height ? Math.round(a.height * 2.54) / 100 : null,
    position: a.position?.abbreviation ?? null,
    draftYear: seasonYear !== null && years !== undefined ? seasonYear - 1 - years : null,
    ...(a.headshot?.href ? { photo: a.headshot.href } : {}),
  };
}
