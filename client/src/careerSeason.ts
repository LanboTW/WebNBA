import {
  RATING_KEYS,
  ROUND_NAME,
  archetype,
  careerInfo,
  gearBoosts,
  playerRating,
  trainCost,
  activeSeriesOf,
  findTeam,
  nextCareerGame,
  record,
  seasonOver,
  seriesDone,
  seriesWinner,
  standings,
  statScale,
  type CareerState,
  type Role,
  type Grade,
  type LoggedGame,
  type PlayerStats,
  type Series,
  type TeamInfo,
} from '@webnba/shared';
import { esc } from './boxscore';
import { awardsHtml, highsHtml, newsHtml } from './careerAwards';
import { RATING_LABEL } from './careerCreate';
import { econHtml, shopHtml } from './careerShop';
import { wallet } from './wallet';
import { historyHtml } from './careerOffseason';
import { logoHtml } from './logos';

export type SeasonTab = 'home' | 'train' | 'shop' | 'schedule' | 'standings' | 'playoffs' | 'stats' | 'players' | 'awards' | 'news';

const TABS: [SeasonTab, string][] = [
  ['home', '總覽'],
  ['train', '訓練'],
  ['shop', '商店'],
  ['schedule', '賽程'],
  ['standings', '戰績'],
  ['playoffs', '季後賽'],
  ['stats', '數據'],
  ['players', '球員'],
  ['awards', '獎項'],
  ['news', '新聞'],
];

const color = (t: TeamInfo) => (t.primary === '#000000' ? t.secondary : t.primary);
export const seasonLabel = (year: number) => `${year}-${String((year + 1) % 100).padStart(2, '0')}`;

/** Per-game averages on the NBA scale (48-minute game, about 115 points a team). */
export function averages(all: LoggedGame[], quarterSeconds: number) {
  // Games he sat out entirely don't count, as in the NBA.
  const games = all.filter((g) => g.stats.secs > 0);
  const n = Math.max(1, games.length);
  const k = statScale(quarterSeconds);
  const sum = (f: (s: PlayerStats) => number) => games.reduce((a, g) => a + f(g.stats), 0);
  const per = (f: (s: PlayerStats) => number) => (sum(f) * k) / n;
  const pct = (m: (s: PlayerStats) => number, a: (s: PlayerStats) => number) => {
    const att = sum(a);
    return att ? `${((sum(m) / att) * 100).toFixed(1)}%` : '—';
  };
  return {
    gp: games.length,
    min: (sum((s) => s.secs) / (4 * quarterSeconds) / n) * 48,
    pts: per((s) => s.pts),
    reb: per((s) => s.oreb + s.dreb),
    ast: per((s) => s.ast),
    stl: per((s) => s.stl),
    blk: per((s) => s.blk),
    tov: per((s) => s.tov),
    fg: pct((s) => s.fgm, (s) => s.fga),
    three: pct((s) => s.tpm, (s) => s.tpa),
    ft: pct((s) => s.ftm, (s) => s.fta),
  };
}

/** One game's line on the NBA scale. */
function gameLine(g: LoggedGame, quarterSeconds: number): string {
  const k = statScale(quarterSeconds);
  const s = g.stats;
  const r = (v: number) => Math.round(v * k);
  const min = Math.round((s.secs / (4 * quarterSeconds)) * 48);
  return `${min} 分鐘 · ${r(s.pts)} 分 ${r(s.oreb + s.dreb)} 板 ${r(s.ast)} 助`;
}

function rankIn(c: CareerState, league: Map<string, TeamInfo>): string {
  const t = league.get(c.team!)!;
  const conf = t.conference ?? 'East';
  const rank = standings(c.season!, league, conf).findIndex((r) => r.abbr === c.team) + 1;
  return `${conf === 'East' ? '東區' : '西區'}第 ${rank}`;
}

/** `home` replaces the overview (the offseason page goes there). */
export function seasonHtml(c: CareerState, tab: SeasonTab, league: Map<string, TeamInfo>, role: Role, home?: string): string {
  const tabs =
    `<nav class="tabs">` +
    TABS.map(([id, label]) => `<button type="button" class="${id === tab ? 'on' : ''}" data-tab="${id}">${label}</button>`).join('') +
    `</nav>`;
  const body =
    tab === 'schedule'
      ? scheduleHtml(c, league)
      : tab === 'standings'
        ? standingsHtml(c, league)
        : tab === 'playoffs'
          ? playoffsHtml(c, league)
          : tab === 'train'
            ? trainHtml(c)
            : tab === 'shop'
              ? shopHtml(c, wallet.coins)
            : tab === 'stats'
              ? statsHtml(c, league)
              : tab === 'players'
                ? `<div id="hubDb"></div>`
              : tab === 'awards'
                ? awardsHtml(c, league)
                : tab === 'news'
                  ? newsHtml(c)
                  : (home ?? homeHtml(c, league, role));
  return tabs + body;
}

/** A game's grade, or 未上場 when he never got in. */
export function gradeBadge(grade: Grade): string {
  return grade === 'DNP' ? '<span class="grade dnp">未上場</span>' : `<span class="grade g${grade[0]}">${grade}</span>`;
}

// ----------------------------------------------------------------- overview

/** The coach's view of him: role, planned minutes, rank and recent form. */
function roleHtml(c: CareerState, role: Role): string {
  const xp = c.player.xp ?? 0;
  return (
    `<div class="rolecard"><div><small>教練信任</small><b>${role.name}</b><span>預計每場約 ${role.minutes} 分鐘</span></div>` +
    `<div><small>隊內總評</small><b>第 ${role.rank}</b><span>總評 ${playerRating(c.player.info)}</span></div>` +
    `<div><small>最近 5 場</small><b>${role.form ?? '—'}</b><span>表現好就會多打</span></div>` +
    `<button type="button" class="xpbox" data-tab="train"><small>經驗值</small><b>${xp}</b><span>去訓練 →</span></button></div>` +
    econHtml(c)
  );
}

function homeHtml(c: CareerState, league: Map<string, TeamInfo>, role: Role): string {
  const s = c.season!;
  const team = league.get(c.team!)!;
  const [w, l] = record(s, c.team!);
  const games = c.games ?? [];
  const head =
    `<div class="teamline" style="--team:${color(team)}">${logoHtml(team, 'tlogo')}<div><b>${esc(team.name)}</b>` +
    `<span>${seasonLabel(s.year)} 球季 · ${w} 勝 ${l} 敗 · ${rankIn(c, league)}</span></div></div>`;
  const recent = games
    .slice(-5)
    .reverse()
    .map((g) => resultRow(c, g, league))
    .join('');
  const avg = averages(
    games.filter((g) => !g.playoff),
    c.settings.quarterSeconds,
  );
  const line = games.length
    ? `<div class="avgline"><span><b>${avg.pts.toFixed(1)}</b>得分</span><span><b>${avg.reb.toFixed(1)}</b>籃板</span>` +
      `<span><b>${avg.ast.toFixed(1)}</b>助攻</span><span><b>${avg.min.toFixed(1)}</b>分鐘</span><span><b>${avg.fg}</b>命中率</span></div>`
    : '';
  return (
    head +
    roleHtml(c, role) +
    nextHtml(c, league) +
    (avg.gp ? `<h3>本季平均<small>例行賽上場 ${avg.gp} 場，換算成 48 分鐘 NBA 比賽</small></h3>${line}` : games.length ? `<p class="sub tight soon">本季還沒有上場紀錄。</p>` : '') +
    (recent ? `<h3>最近比賽</h3><ol class="games">${recent}</ol>` : '')
  );
}

function nextHtml(c: CareerState, league: Map<string, TeamInfo>): string {
  const s = c.season!;
  if (s.champion) {
    const champ = league.get(s.champion)!;
    const mine = s.champion === c.team;
    return (
      `<div class="draftcard" style="--team:${color(champ)}"><small>${seasonLabel(s.year)} 總冠軍</small>` +
      `<div class="draftteam">${logoHtml(champ, 'draftlogo')}<b>${esc(champ.name)}</b></div>` +
      `<span>${mine ? '恭喜！你拿到了總冠軍戒指！' : '你的球季已經結束。'}</span></div>` +
      `<div class="buttons"><button type="button" class="primary" data-act="beginOffseason">進入休賽季</button></div>`
    );
  }
  const next = nextCareerGame(c);
  if (!next) {
    const out = seasonOver(s) && !(s.playoffs?.series ?? []).some((x) => x.hi === c.team || x.lo === c.team);
    const text = out ? '你的球隊沒有打進季後賽。' : '你的系列賽已經結束，其他系列賽還在進行。';
    const eliminated = (s.playoffs?.series ?? []).some((x) => seriesDone(x) && (x.hi === c.team || x.lo === c.team) && seriesWinner(x) !== c.team);
    return (
      `<div class="nextcard"><p>${eliminated ? '你的球隊在季後賽被淘汰了。' : text}</p>` +
      `<div class="buttons"><button type="button" class="primary" data-act="simPlayoffs">模擬季後賽</button></div></div>`
    );
  }
  const home = next.home === c.team;
  const opp = league.get(home ? next.away : next.home)!;
  const [ow, ol] = record(s, opp.abbr);
  let title: string;
  let buttons: string;
  if (next.playoff) {
    const x = activeSeriesOf(s, c.team!)!;
    const us = x.hi === c.team ? 0 : 1;
    title = `季後賽${ROUND_NAME[next.playoff]} · 第 ${x.games.length + 1} 戰（${x.best} 戰 ${Math.ceil(x.best / 2)} 勝，系列賽 ${x.wins[us]}:${x.wins[1 - us]}）`;
    buttons =
      `<button type="button" class="primary" data-act="splay">開始比賽</button>` +
      `<button type="button" data-act="ssim">模擬這場</button>` +
      `<button type="button" data-act="ssimSeries">模擬整個系列賽</button>`;
  } else {
    title = `例行賽 第 ${s.day + 1} / ${s.days} 場`;
    buttons =
      `<button type="button" class="primary" data-act="splay">開始比賽</button>` +
      `<button type="button" data-act="ssim">模擬這場</button>` +
      `<button type="button" data-act="ssim5">模擬 5 場</button>` +
      `<button type="button" data-act="ssimAll">模擬到例行賽結束</button>`;
  }
  return (
    `<div class="nextcard" style="--team:${color(opp)}"><small>${title}</small>` +
    `<div class="nextopp">${logoHtml(opp, 'tlogo')}<div><b>${home ? 'vs' : '@'} ${esc(opp.name)}</b>` +
    `<span>${home ? '主場' : '客場'} · ${ow} 勝 ${ol} 敗</span></div></div>` +
    `<div class="buttons wrap">${buttons}</div></div>`
  );
}

function resultRow(c: CareerState, g: LoggedGame, league: Map<string, TeamInfo>): string {
  const opp = league.get(g.opp) ?? findTeam(g.opp);
  const won = g.shown[0] > g.shown[1];
  const tag = g.playoff ? `<small>${ROUND_NAME[g.playoff]}</small>` : '';
  return (
    `<li class="game"><span class="gno">${g.home ? 'vs' : '@'}</span><div><b class="${won ? 'win' : 'loss'}">${won ? '勝' : '敗'} ${g.shown[0]}:${g.shown[1]} ${esc(opp.abbr)}</b>` +
    `${tag}${g.simmed ? '<small>模擬</small>' : ''}<span>${gameLine(g, c.settings.quarterSeconds)}${g.xp ? ` · +${g.xp} XP` : ''}</span></div>${gradeBadge(g.grade)}</li>`
  );
}

// ----------------------------------------------------------------- schedule

function scheduleHtml(c: CareerState, league: Map<string, TeamInfo>): string {
  const s = c.season!;
  const played = (c.games ?? []).map((g) => resultRow(c, g, league));
  const upcoming = s.games
    .filter((g) => !g.score && (g.home === c.team || g.away === c.team))
    .map((g) => {
      const home = g.home === c.team;
      const opp = league.get(home ? g.away : g.home)!;
      return `<li class="game todo"><span class="gno">${home ? 'vs' : '@'}</span><div>第 ${g.day + 1} 場　${esc(opp.name)}</div></li>`;
    });
  return `<ol class="games schedule">${[...played, ...upcoming].join('')}</ol>`;
}

// ----------------------------------------------------------------- standings

function standingsHtml(c: CareerState, league: Map<string, TeamInfo>): string {
  return (['East', 'West'] as const)
    .map((conf) => {
      const rows = standings(c.season!, league, conf);
      const lead = rows[0];
      const gb = (r: (typeof rows)[number]) => {
        const g = (lead.w - r.w + (r.l - lead.l)) / 2;
        return g ? g.toFixed(1) : '—';
      };
      return (
        `<h3>${conf === 'East' ? '東區' : '西區'}<small>前 8 名進季後賽</small></h3><table class="standings"><thead><tr><th></th><th>球隊</th><th>勝</th><th>敗</th><th>勝差</th><th>得失分</th></tr></thead><tbody>` +
        rows
          .map((r, i) => {
            const t = league.get(r.abbr)!;
            const n = r.w + r.l;
            const diff = n ? ((r.pf - r.pa) / n).toFixed(1) : '0.0';
            return (
              `<tr class="${r.abbr === c.team ? 'me' : ''}${i === 7 ? ' cut' : ''}"><td>${i + 1}</td><td>${logoHtml(t, 'slogo')}${esc(t.name)}</td>` +
              `<td>${r.w}</td><td>${r.l}</td><td>${gb(r)}</td><td>${Number(diff) > 0 ? '+' : ''}${diff}</td></tr>`
            );
          })
          .join('') +
        `</tbody></table>`
      );
    })
    .join('');
}

// ----------------------------------------------------------------- playoffs

function playoffsHtml(c: CareerState, league: Map<string, TeamInfo>): string {
  const all = c.season!.playoffs?.series ?? [];
  if (!all.length) {
    return `<p class="sub tight">例行賽結束後，東西區各前 8 名進季後賽（1 對 8、4 對 5、3 對 6、2 對 7）。目前 ${c.season!.day} / ${c.season!.days} 場。</p>`;
  }
  const series = (x: Series) => {
    const side = (abbr: string, seed: number, wins: number) => {
      const t = league.get(abbr)!;
      const won = seriesDone(x) && seriesWinner(x) === abbr;
      return `<div class="sside${won ? ' won' : ''}${abbr === c.team ? ' me' : ''}"><span class="seed">${seed}</span>${logoHtml(t, 'slogo')}<span class="sname">${esc(t.abbr)}</span><b>${wins}</b></div>`;
    };
    return `<div class="series">${side(x.hi, x.seeds[0], x.wins[0])}${side(x.lo, x.seeds[1], x.wins[1])}</div>`;
  };
  const rounds = [1, 2, 3, 4]
    .filter((r) => all.some((x) => x.round === r))
    .map((r) => {
      const list = all.filter((x) => x.round === r);
      const best = list[0].best;
      return `<h3>${ROUND_NAME[r]}<small>${best === 1 ? '一場定勝負' : `${best} 戰 ${Math.ceil(best / 2)} 勝`}</small></h3><div class="bracket">${list.map(series).join('')}</div>`;
    });
  return rounds.join('');
}

// ----------------------------------------------------------------- training

/** "（裝備後 72）" when gear lifts his overall. */
function gearOvr(c: CareerState): string {
  const base = playerRating(c.player.info);
  const geared = playerRating(careerInfo(c));
  return geared > base ? `<small>（裝備後 ${geared}）</small>` : '';
}

function trainHtml(c: CareerState): string {
  const p = c.player;
  const xp = p.xp ?? 0;
  const caps = archetype(p.archetype).caps;
  const boosts = gearBoosts(c);
  const rows = RATING_KEYS.map((k) => {
    const v = p.info.ratings[k];
    const plus = boosts[k] ? `<small class="gearplus" title="裝備加成">+${boosts[k]}</small>` : '';
    const capped = v >= caps[k];
    const cost = trainCost(v);
    return (
      `<div class="trow"><span>${RATING_LABEL[k]}</span><div class="track"><i style="width:${v}%"></i><em style="left:${caps[k]}%"></em></div><b>${v}${plus}</b>` +
      `<button type="button" class="small" data-train="${k}"${capped || xp < cost ? ' disabled' : ''}>${capped ? '已達上限' : `+1　${cost} XP`}</button></div>`
    );
  }).join('');
  return (
    `<div class="xpline"><span>經驗值 <b>${xp}</b></span><span>總評 <b>${playerRating(p.info)}</b>${gearOvr(c)}</span></div>` +
    `<p class="sub tight">比賽表現越好、贏球、季後賽和較高難度都拿得比較多經驗值；坐板凳也有一點練習經驗。能力越高，加 1 點越貴；虛線是${archetype(p.archetype).name}的上限。</p>` +
    `<div class="trainlist">${rows}</div>`
  );
}

// ----------------------------------------------------------------- stats

function statsHtml(c: CareerState, league: Map<string, TeamInfo>): string {
  const games = c.games ?? [];
  const history = highsHtml(c, league) + historyHtml(c, league);
  const row = (label: string, list: LoggedGame[]) => {
    if (!list.length) return '';
    const a = averages(list, c.settings.quarterSeconds);
    return (
      `<tr><td>${label}</td><td>${a.gp}</td><td>${a.min.toFixed(1)}</td><td>${a.pts.toFixed(1)}</td><td>${a.reb.toFixed(1)}</td><td>${a.ast.toFixed(1)}</td>` +
      `<td>${a.stl.toFixed(1)}</td><td>${a.blk.toFixed(1)}</td><td>${a.tov.toFixed(1)}</td><td>${a.fg}</td><td>${a.three}</td><td>${a.ft}</td></tr>`
    );
  };
  if (!games.length) return history || `<p class="sub tight">還沒有比賽紀錄。</p>`;
  const k = statScale(c.settings.quarterSeconds);
  return (
    `<p class="sub tight">平均數據換算成 48 分鐘的 NBA 比賽（每節 ${c.settings.quarterSeconds / 60} 分鐘的比賽 × ${k.toFixed(2)}），命中率是實際數字。</p>` +
    `<div class="tablewrap"><table class="standings stats"><thead><tr><th></th><th>場</th><th>分鐘</th><th>得分</th><th>籃板</th><th>助攻</th><th>抄截</th><th>阻攻</th><th>失誤</th><th>投籃</th><th>三分</th><th>罰球</th></tr></thead><tbody>` +
    row('例行賽', games.filter((g) => !g.playoff)) +
    row('季後賽', games.filter((g) => g.playoff)) +
    `</tbody></table></div>` +
    history
  );
}
