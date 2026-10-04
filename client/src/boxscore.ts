import { FOUL_OUT, type GameState, type PlayerInfo, type PlayerStats, type TeamInfo } from '@webnba/shared';

const COLS: [string, (p: PlayerStats) => string | number][] = [
  ['時間', (s) => `${Math.floor(s.secs / 60)}:${String(Math.floor(s.secs % 60)).padStart(2, '0')}`],
  ['得分', (s) => s.pts],
  ['籃板', (s) => s.oreb + s.dreb],
  ['助攻', (s) => s.ast],
  ['抄截', (s) => s.stl],
  ['火鍋', (s) => s.blk],
  ['失誤', (s) => s.tov],
  ['犯規', (s) => s.pf],
  ['投籃', (s) => `${s.fgm}-${s.fga}`],
  ['三分', (s) => `${s.tpm}-${s.tpa}`],
  ['罰球', (s) => `${s.ftm}-${s.fta}`],
];

export const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export interface Row {
  rosterIdx: number;
  info: PlayerInfo;
  stats: PlayerStats;
  energy: number;
  /** Court slot id, or -1 when on the bench. */
  slotId: number;
}

/** Everyone on a team (court and bench) in roster order. */
export function teamRows(state: GameState, team: 0 | 1): Row[] {
  const court = state.players
    .filter((p) => p.team === team)
    .map((p) => ({ rosterIdx: p.rosterIdx, info: p.info, stats: p.stats, energy: p.energy, slotId: p.id }));
  const bench = state.bench[team].map((b) => ({ ...b, slotId: -1 }));
  return [...court, ...bench].sort((a, b) => a.rosterIdx - b.rosterIdx);
}

export function energyBar(energy: number): string {
  const pct = Math.round(energy * 100);
  const cls = energy < 0.6 ? 'low' : energy < 0.8 ? 'mid' : '';
  return `<span class="ebar ${cls}"><i style="width:${pct}%"></i></span>`;
}

export function renderBoxScore(state: GameState, teams: [TeamInfo, TeamInfo]): string {
  return ([0, 1] as const)
    .map((team) => {
      const rows = teamRows(state, team);
      if (!state.players.some((p) => p.team === team)) return '';
      const t = teams[team];
      const total = rows.reduce(
        (acc, r) => {
          for (const k of Object.keys(acc) as (keyof PlayerStats)[]) acc[k] += r.stats[k];
          return acc;
        },
        { secs: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, ftm: 0, fta: 0, pf: 0 },
      );
      const head = `<tr><th>球員</th>${COLS.map(([h]) => `<th>${h}</th>`).join('')}<th>體力</th></tr>`;
      // A solo game (career): his line stands out.
      const solo = state.settings.solo !== undefined && state.settings.humanTeams.includes(team) ? state.settings.solo : -1;
      const body = rows
        .map((r) => {
          const me = r.rosterIdx === solo;
          const tags = [r.slotId >= 0 ? '<em class="on">場上</em>' : '', r.stats.pf >= FOUL_OUT ? '<em class="out">犯滿</em>' : ''].join('');
          return `<tr class="${r.slotId >= 0 ? '' : 'benchrow'}${me ? ' me' : ''}"><td>${me ? '<i class="star">★</i>' : ''}${esc(r.info.name)} <small>#${r.info.number} ${r.info.position}</small>${tags}</td>${COLS.map(([, f]) => `<td>${f(r.stats)}</td>`).join('')}<td>${energyBar(r.energy)}</td></tr>`;
        })
        .join('');
      const totals = COLS.map(([h, f]) => `<td>${h === '時間' ? '' : f(total)}</td>`).join('');
      const color = t.primary === '#000000' ? t.secondary : t.primary;
      return `<div class="box" style="--team:${color}"><h3>${esc(t.name)}　${state.score[team]}</h3><table>${head}${body}<tr class="total"><td>全隊</td>${totals}<td></td></tr></table></div>`;
    })
    .join('');
}
