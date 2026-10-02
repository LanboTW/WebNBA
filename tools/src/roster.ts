/**
 * Pure roster-merging logic for the update tool: no network, no files.
 *
 * The roster keeps hand-tuned ratings. An update only moves players between
 * teams, refreshes jersey numbers (heights stay hand-tuned), drops players who left the
 * league (when the source knows who is active), and adds newcomers with
 * position-based default ratings until someone tunes them in overrides.json.
 */

export type RawPlayer = [string, number, number, string, number[]];

export interface RawTeam {
  abbr: string;
  name: string;
  primary: string;
  secondary: string;
  /** Menu heading for custom teams. */
  group?: string;
  players: RawPlayer[];
}

export interface RawRoster {
  season: string;
  updated?: string;
  ratingKeys: string[];
  teams: RawTeam[];
}

/** One player as the data source reports them. */
export interface SourcePlayer {
  name: string;
  /** Team abbreviation, or null for free agents. */
  team: string | null;
  number: number | null;
  heightM: number | null;
  position: string | null;
  /** Draft year, used to break ties between namesakes (newer wins). */
  draftYear: number | null;
}

/**
 * 'active': the source lists exactly the players currently in the league.
 * 'all': the source lists everyone ever (free API tier), so we can follow
 * known players to new teams but cannot tell who retired or who is new.
 */
export type SourceKind = 'active' | 'all';

export interface Override {
  ratings?: Partial<Record<string, number>>;
  number?: number;
  heightM?: number;
  position?: string;
  /** Pin a player to a team regardless of the source. */
  team?: string;
}
export type Overrides = Record<string, Override>;

export type Change =
  | { kind: 'move'; name: string; from: string; to: string }
  | { kind: 'add'; name: string; team: string; tuned: boolean }
  | { kind: 'remove'; name: string; team: string; reason: string }
  | { kind: 'number'; name: string; from: number; to: number }
  | { kind: 'warn'; text: string };

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 10;
/** Teams are filled up to this many when newcomers are available. */
export const TARGET_PLAYERS = 8;

/** Rating templates for newcomers (in the standard ratingKeys order). */
const DEFAULTS: Record<string, number[]> = {
  //      spd jmp cls mid thr  ft hnd pas stl blk def reb sta
  PG: [72, 60, 62, 64, 66, 76, 70, 68, 58, 25, 58, 40, 80],
  SG: [70, 62, 62, 64, 68, 76, 64, 58, 58, 30, 60, 42, 80],
  SF: [68, 64, 64, 62, 64, 72, 58, 54, 56, 40, 62, 52, 80],
  PF: [62, 66, 68, 58, 58, 68, 50, 50, 52, 55, 62, 64, 78],
  C: [54, 64, 70, 50, 45, 62, 42, 46, 48, 68, 62, 72, 76],
};

export function normaliseName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’`]/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SUFFIX = / (jr|sr|ii|iii|iv|v)$/;
const bareName = (name: string) => normaliseName(name).replace(SUFFIX, '');

/** API positions are like "G", "F-C", "G-F"; ours are PG/SG/SF/PF/C. */
export function mapPosition(pos: string | null, heightM: number | null): string {
  const h = heightM ?? 2.0;
  const p = (pos ?? '').toUpperCase();
  if (['PG', 'SG', 'SF', 'PF', 'C'].includes(p)) return p;
  if (p.startsWith('C')) return 'C';
  if (p === 'G') return h < 1.92 ? 'PG' : 'SG';
  if (p === 'G-F' || p === 'F-G') return h < 1.98 ? 'SG' : 'SF';
  if (p === 'F-C') return h >= 2.09 ? 'C' : 'PF';
  if (p === 'F') return h < 2.03 ? 'SF' : 'PF';
  return h < 1.92 ? 'PG' : h < 1.98 ? 'SG' : h < 2.03 ? 'SF' : h < 2.08 ? 'PF' : 'C';
}

/** "6-8" (feet-inches) to metres. */
export function parseHeight(h: string | null | undefined): number | null {
  const m = /^(\d+)-(\d+)$/.exec(h ?? '');
  if (!m) return null;
  return Math.round((Number(m[1]) * 12 + Number(m[2])) * 2.54) / 100;
}

export const rating = (p: RawPlayer) => Math.round(p[4].reduce((a, b) => a + b, 0) / p[4].length);

/** Finds a roster player in the source; null when absent or ambiguous. */
function lookup(index: Map<string, SourcePlayer[]>, bare: Map<string, SourcePlayer[]>, name: string, team: string) {
  const pick = (list: SourcePlayer[] | undefined): SourcePlayer | null | 'ambiguous' => {
    if (!list?.length) return null;
    if (list.length === 1) return list[0];
    // Namesakes (old players in the full history): the one still on our team,
    // otherwise the most recently drafted.
    const same = list.filter((p) => p.team === team);
    if (same.length === 1) return same[0];
    const sorted = [...list].sort((a, b) => (b.draftYear ?? 0) - (a.draftYear ?? 0));
    return sorted[0].draftYear !== sorted[1].draftYear ? sorted[0] : 'ambiguous';
  };
  const exact = pick(index.get(normaliseName(name)));
  if (exact) return exact;
  return pick(bare.get(bareName(name)));
}

export interface MergeResult {
  roster: RawRoster;
  changes: Change[];
}

export function mergeRoster(
  current: RawRoster,
  source: SourcePlayer[],
  kind: SourceKind,
  overrides: Overrides = {},
  today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }),
): MergeResult {
  const changes: Change[] = [];
  const keys = current.ratingKeys;
  const abbrs = new Set(current.teams.map((t) => t.abbr));
  const index = new Map<string, SourcePlayer[]>();
  const bare = new Map<string, SourcePlayer[]>();
  for (const p of source) {
    for (const [map, key] of [
      [index, normaliseName(p.name)],
      [bare, bareName(p.name)],
    ] as const) {
      map.set(key, [...(map.get(key) ?? []), p]);
    }
  }

  // Working copy: where every known player belongs now.
  const placed = new Map<string, RawPlayer[]>(current.teams.map((t) => [t.abbr, []]));
  const known = new Set<string>();
  for (const team of current.teams) {
    for (const player of team.players) {
      const p: RawPlayer = [player[0], player[1], player[2], player[3], [...player[4]]];
      known.add(normaliseName(p[0]));
      const found = lookup(index, bare, p[0], team.abbr);
      let dest = team.abbr;
      if (found === 'ambiguous') {
        changes.push({ kind: 'warn', text: `${p[0]}：資料來源有同名球員，維持原隊` });
      } else if (!found) {
        if (kind === 'active') {
          changes.push({ kind: 'remove', name: p[0], team: team.abbr, reason: '不在現役名單' });
          continue;
        }
        changes.push({ kind: 'warn', text: `${p[0]}：資料來源找不到，維持原隊` });
      } else {
        if (found.team && abbrs.has(found.team)) dest = found.team;
        else if (kind === 'active') {
          changes.push({ kind: 'remove', name: p[0], team: team.abbr, reason: '自由球員' });
          continue;
        }
        if (found.number !== null && found.number !== p[1]) {
          changes.push({ kind: 'number', name: p[0], from: p[1], to: found.number });
          p[1] = found.number;
        }
      }
      if (dest !== team.abbr) changes.push({ kind: 'move', name: p[0], from: team.abbr, to: dest });
      placed.get(dest)!.push(p);
    }
  }

  // Newcomers (only a source that knows who is active can tell us about them).
  const newcomers = new Map<string, RawPlayer[]>();
  if (kind === 'active') {
    for (const s of source) {
      if (!s.team || !abbrs.has(s.team) || known.has(normaliseName(s.name))) continue;
      const pos = mapPosition(s.position, s.heightM);
      const player: RawPlayer = [s.name, s.number ?? 0, s.heightM ?? 2.0, pos, [...defaultRatings(pos, keys)]];
      newcomers.set(s.team, [...(newcomers.get(s.team) ?? []), player]);
    }
  }

  // Overrides: tuned ratings, pinned teams.
  const overridden = new Set<string>();
  for (const [name, o] of Object.entries(overrides)) {
    const key = normaliseName(name);
    let found: { team: string; list: RawPlayer[]; i: number } | null = null;
    for (const [team, list] of [...placed, ...newcomers]) {
      const i = list.findIndex((p) => normaliseName(p[0]) === key);
      if (i >= 0) found = { team, list, i };
    }
    if (!found) {
      changes.push({ kind: 'warn', text: `overrides.json：找不到 ${name}` });
      continue;
    }
    const p = found.list[found.i];
    overridden.add(key);
    if (o.ratings) {
      for (const [k, v] of Object.entries(o.ratings)) {
        const at = keys.indexOf(k);
        if (at >= 0 && typeof v === 'number') p[4][at] = clampRating(v);
      }
    }
    if (o.number !== undefined) p[1] = o.number;
    if (o.heightM !== undefined) p[2] = o.heightM;
    if (o.position) p[3] = o.position;
    if (o.team && abbrs.has(o.team) && o.team !== found.team) {
      found.list.splice(found.i, 1);
      placed.get(o.team)!.push(p);
      changes.push({ kind: 'move', name: p[0], from: found.team, to: o.team });
    }
  }

  const teams = current.teams.map((t): RawTeam => {
    const before = t.players.map((p) => normaliseName(p[0]));
    let players = placed.get(t.abbr)!;
    // Fill thin rosters with newcomers: tuned ones first.
    const fresh = (newcomers.get(t.abbr) ?? []).sort(
      (a, b) => Number(overridden.has(normaliseName(b[0]))) - Number(overridden.has(normaliseName(a[0]))),
    );
    for (const n of fresh) {
      if (players.length >= TARGET_PLAYERS && !overridden.has(normaliseName(n[0]))) break;
      players.push(n);
      changes.push({ kind: 'add', name: n[0], team: t.abbr, tuned: overridden.has(normaliseName(n[0])) });
    }
    if (players.length < MIN_PLAYERS) {
      changes.push({ kind: 'warn', text: `${t.abbr} 只剩 ${players.length} 人，這隊不更新` });
      return { ...t, players: t.players };
    }
    players = orderTeam(players, before);
    while (players.length > MAX_PLAYERS) {
      const drop = players.slice(MIN_PLAYERS).reduce((low, p) => (rating(p) < rating(low) ? p : low));
      players = players.filter((p) => p !== drop);
      changes.push({ kind: 'remove', name: drop[0], team: t.abbr, reason: `超過 ${MAX_PLAYERS} 人，評分最低` });
    }
    return { ...t, players };
  });

  return { roster: { ...current, updated: today, teams }, changes };
}

/**
 * Starters stay first in their old order. A better arrival replaces the
 * weakest starter, who drops to the top of the bench.
 */
function orderTeam(players: RawPlayer[], before: string[]): RawPlayer[] {
  const pos = (p: RawPlayer) => {
    const i = before.indexOf(normaliseName(p[0]));
    return i < 0 ? 100 : i;
  };
  const list = [...players].sort((a, b) => pos(a) - pos(b));
  for (let i = MIN_PLAYERS; i < list.length; i++) {
    if (pos(list[i]) < 100) continue;
    const starters = list.slice(0, MIN_PLAYERS);
    const weakest = starters.reduce((low, p) => (rating(p) < rating(low) ? p : low));
    if (rating(list[i]) > rating(weakest)) {
      const w = list.indexOf(weakest);
      const arrival = list[i];
      list.splice(i, 1);
      list.splice(w, 1, arrival);
      list.splice(MIN_PLAYERS, 0, weakest);
    }
  }
  return list;
}

function defaultRatings(position: string, keys: string[]): number[] {
  const template = DEFAULTS[position] ?? DEFAULTS.SF;
  const standard = ['speed', 'jump', 'close', 'mid', 'three', 'ft', 'handle', 'pass', 'steal', 'block', 'defense', 'rebound', 'stamina'];
  return keys.map((k) => template[standard.indexOf(k)] ?? 50);
}

const clampRating = (v: number) => Math.max(1, Math.min(99, Math.round(v)));

/** Sanity checks before anything is written or published. */
export function validateRoster(r: RawRoster): string[] {
  const errors: string[] = [];
  if (r.teams.length !== 30) errors.push(`隊伍數 ${r.teams.length}，應為 30`);
  return errors.concat(validateTeams(r.teams, r.ratingKeys));
}

/** Rules every team follows, NBA or custom. */
export function validateTeams(teams: RawTeam[], ratingKeys: string[], heights: [number, number] = [1.6, 2.4]): string[] {
  const errors: string[] = [];
  for (const t of teams) {
    if (!/^#[0-9a-fA-F]{6}$/.test(t.primary) || !/^#[0-9a-fA-F]{6}$/.test(t.secondary)) errors.push(`${t.abbr} 顏色要寫成 #RRGGBB`);
    if (t.players.length < MIN_PLAYERS || t.players.length > MAX_PLAYERS) errors.push(`${t.abbr} 有 ${t.players.length} 人`);
    const names = new Set<string>();
    for (const p of t.players) {
      if (names.has(p[0])) errors.push(`${t.abbr} 重複球員 ${p[0]}`);
      names.add(p[0]);
      if (p[4].length !== ratingKeys.length || p[4].some((v) => !(v >= 1 && v <= 99))) errors.push(`${p[0]} 能力值不正確`);
      if (!(p[2] >= heights[0] && p[2] <= heights[1])) errors.push(`${p[0]} 身高 ${p[2]} 不合理`);
      if (!['PG', 'SG', 'SF', 'PF', 'C'].includes(p[3])) errors.push(`${p[0]} 位置 ${p[3]} 不正確`);
    }
  }
  return errors;
}

/**
 * custom-teams.json: same rules as NBA teams, plus abbreviations that fit the
 * scoreboard and never collide. Fun teams may stretch heights a little.
 */
export function validateCustomTeams(custom: { ratingKeys: string[]; teams: RawTeam[] }, nba: RawTeam[]): string[] {
  const errors = validateTeams(custom.teams, custom.ratingKeys, [1.4, 2.6]);
  const seen = new Set(nba.map((t) => t.abbr));
  for (const t of custom.teams) {
    if (!/^[A-Z0-9]{2,5}$/.test(t.abbr)) errors.push(`${t.abbr}：縮寫要 2–5 個大寫英文或數字`);
    if (seen.has(t.abbr)) errors.push(`${t.abbr}：縮寫和其他隊伍重複`);
    seen.add(t.abbr);
    if (!t.name) errors.push(`${t.abbr}：缺少隊名`);
  }
  return errors;
}

/** Same layout as the hand-written file: one player per line. */
export function formatRoster(r: RawRoster): string {
  const q = JSON.stringify;
  const team = (t: RawTeam) =>
    [
      '    {',
      `      "abbr": ${q(t.abbr)}, "name": ${q(t.name)}, "primary": ${q(t.primary)}, "secondary": ${q(t.secondary)},`,
      '      "players": [',
      t.players.map((p) => `        [${q(p[0])}, ${p[1]}, ${p[2]}, ${q(p[3])}, [${p[4].join(', ')}]]`).join(',\n'),
      '      ]',
      '    }',
    ].join('\n');
  const head = [`  "season": ${q(r.season)},`];
  if (r.updated) head.push(`  "updated": ${q(r.updated)},`);
  return [
    '{',
    ...head,
    `  "ratingKeys": [${r.ratingKeys.map((k) => q(k)).join(', ')}],`,
    '  "teams": [',
    r.teams.map(team).join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
}

export function describe(c: Change): string {
  switch (c.kind) {
    case 'move':
      return `⇄ ${c.name}：${c.from} → ${c.to}`;
    case 'add':
      return `+ ${c.name}（${c.team}${c.tuned ? '' : '，預設能力值，可在 overrides.json 調整'}）`;
    case 'remove':
      return `- ${c.name}（${c.team}，${c.reason}）`;
    case 'number':
      return `# ${c.name} 背號 ${c.from} → ${c.to}`;
    case 'warn':
      return `! ${c.text}`;
  }
}
