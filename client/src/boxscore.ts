import type { GameState, PlayerState, TeamInfo } from '@webnba/shared';

const COLS: [string, (p: PlayerState['stats']) => string | number][] = [
  ['時間', (s) => `${Math.floor(s.secs / 60)}:${String(Math.floor(s.secs % 60)).padStart(2, '0')}`],
  ['得分', (s) => s.pts],
  ['籃板', (s) => s.oreb + s.dreb],
  ['助攻', (s) => s.ast],
  ['抄截', (s) => s.stl],
  ['火鍋', (s) => s.blk],
  ['失誤', (s) => s.tov],
  ['投籃', (s) => `${s.fgm}-${s.fga}`],
  ['三分', (s) => `${s.tpm}-${s.tpa}`],
];

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderBoxScore(state: GameState, teams: [TeamInfo, TeamInfo]): string {
  return ([0, 1] as const)
    .map((team) => {
      const players = state.players.filter((p) => p.team === team);
      if (!players.length) return '';
      const t = teams[team];
      const total = players.reduce(
        (acc, p) => {
          for (const k of Object.keys(acc) as (keyof PlayerState['stats'])[]) acc[k] += p.stats[k];
          return acc;
        },
        { secs: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0 },
      );
      const head = `<tr><th>球員</th>${COLS.map(([h]) => `<th>${h}</th>`).join('')}</tr>`;
      const rows = players
        .map(
          (p) =>
            `<tr><td>${esc(p.info.name)} <small>#${p.info.number} ${p.info.position}</small></td>${COLS.map(([, f]) => `<td>${f(p.stats)}</td>`).join('')}</tr>`,
        )
        .join('');
      const totals = COLS.map(([h, f]) => `<td>${h === '時間' ? '' : f(total)}</td>`).join('');
      const color = t.primary === '#000000' ? t.secondary : t.primary;
      return `<div class="box" style="--team:${color}"><h3>${esc(t.name)}　${state.score[team]}</h3><table>${head}${rows}<tr class="total"><td>全隊</td>${totals}</tr></table></div>`;
    })
    .join('');
}
