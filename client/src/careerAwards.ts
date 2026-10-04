import {
  AWARD_NAME,
  HOF_POINTS,
  RECORD_KEYS,
  RECORD_NAME,
  STAT_KEYS,
  STAT_NAME,
  STAT_TITLE,
  hofCase,
  mvpRace,
  royRace,
  seasonLines,
  statLeaders,
  trophyCase,
  type AwardId,
  type AwardPick,
  type CareerState,
  type SeasonAwards,
  type TeamInfo,
} from '@webnba/shared';
import { esc } from './boxscore';
import { logoHtml } from './logos';

/** Awards, the news feed, career highs and the Hall of Fame, as page pieces. */

const label = (year: number) => `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
const TROPHY_ORDER: AwardId[] = ['champ', 'mvp', 'fmvp', 'roy', 'allstar', ...STAT_KEYS];

const f1 = (v: number) => v.toFixed(1);
const lineText = (p: AwardPick) => `${f1(p.line.pts)} 分 ${f1(p.line.reb)} 板 ${f1(p.line.ast)} 助`;

function who(p: AwardPick, me: string, league: Map<string, TeamInfo>): string {
  const t = league.get(p.team);
  return `${t ? logoHtml(t, 'slogo') : ''}<b class="${p.name === me ? 'mine' : ''}">${esc(p.name)}</b> <small>${esc(p.team)}</small>`;
}

/** His trophies, as badges with counts. */
export function trophiesHtml(c: CareerState): string {
  const t = trophyCase(c);
  const items = TROPHY_ORDER.filter((id) => t[id]).map(
    (id) => `<span class="trophy t-${id}"><b>${t[id]! > 1 ? `${t[id]}×` : ''}</b>${AWARD_NAME[id]}</span>`,
  );
  return items.length ? `<div class="trophies">${items.join('')}</div>` : `<p class="sub tight">還沒有獎項，加油！</p>`;
}

/** The awards tab: the race this season, his trophies, past winners and the Hall of Fame. */
export function awardsHtml(c: CareerState, league: Map<string, TeamInfo>): string {
  const me = c.player.info.name;
  let race = '';
  const s = c.season;
  if (s && !c.offseason && s.day > 0) {
    const lines = seasonLines(c, league);
    const ladder = (title: string, note: string, list: AwardPick[]) =>
      list.length
        ? `<h3>${title}<small>${note}</small></h3><ol class="ladder">${list.map((p) => `<li class="${p.name === me ? 'mine' : ''}">${who(p, me, league)}<span>${lineText(p)}</span></li>`).join('')}</ol>`
        : '';
    const leaders = statLeaders(c, lines);
    const rows = STAT_KEYS.map((k) => {
      const p = leaders[k];
      return p ? `<tr class="${p.name === me ? 'me' : ''}"><td>${STAT_TITLE[k]}</td><td>${who(p, me, league)}</td><td>${f1(p.line[k])}</td></tr>` : '';
    }).join('');
    race =
      ladder('MVP 排行', `${label(s.year)} 球季目前為止，看數據和球隊戰績`, mvpRace(c, lines)) +
      ladder('新人王排行', '只算第一年的球員', royRace(c, lines)) +
      (rows ? `<h3>數據王<small>每場平均，至少打滿球隊 65% 的比賽</small></h3><table class="standings leaders"><tbody>${rows}</tbody></table>` : '') +
      allStarsHtml(c);
  }
  const past = (c.history ?? [])
    .filter((h) => h.awards)
    .reverse()
    .map((h) => seasonAwardsHtml(h.awards!, me, league, `${label(h.year)} 球季`))
    .join('');
  return (
    `<h3>個人獎項</h3>${trophiesHtml(c)}` +
    race +
    past +
    hallHtml(c, league) +
    `<p class="sub tight">其他球員的數據是依能力、上場時間和球隊估算的；你的數據是實際打出來的（換算成 48 分鐘 NBA 比賽）。</p>`
  );
}

function allStarsHtml(c: CareerState): string {
  const a = c.allStars;
  if (!a || a.year !== c.season?.year) return `<h3>明星賽<small>例行賽打完一半時公布名單</small></h3>`;
  const me = c.player.info.name;
  const list = (names: string[]) => names.map((n) => `<span class="${n === me ? 'mine' : ''}">${esc(n)}</span>`).join('');
  return (
    `<h3>${a.year + 1} 年明星賽名單<small>只選人，不打比賽</small></h3>` +
    `<div class="allstars"><div><small>NBA東</small>${list(a.East)}</div><div><small>NBA西</small>${list(a.West)}</div></div>`
  );
}

/** One finished season's winners. */
export function seasonAwardsHtml(a: SeasonAwards, me: string, league: Map<string, TeamInfo>, title: string): string {
  const row = (name: string, p: AwardPick | null | undefined, extra = '') =>
    p ? `<tr><td>${name}</td><td>${who(p, me, league)}</td><td>${extra || lineText(p)}</td></tr>` : '';
  const champ = a.champion ? league.get(a.champion) : undefined;
  return (
    `<h3>${title}得獎名單</h3><table class="standings leaders"><tbody>` +
    (champ ? `<tr><td>總冠軍</td><td>${logoHtml(champ, 'slogo')}<b>${esc(champ.name)}</b></td><td></td></tr>` : '') +
    row('年度 MVP', a.mvp[0]) +
    row('總冠軍賽 MVP', a.finalsMvp) +
    row('年度新人王', a.roy[0]) +
    STAT_KEYS.map((k) => row(STAT_TITLE[k], a.leaders[k], `${f1(a.leaders[k]?.line[k] ?? 0)} ${STAT_NAME[k]}`)).join('') +
    `</tbody></table>`
  );
}

/** Everyone inducted since the career began. */
export function hallHtml(c: CareerState, league: Map<string, TeamInfo>): string {
  const hall = c.hall ?? [];
  if (!hall.length) return `<h3>名人堂<small>退休的傳奇球員會在這裡</small></h3><p class="sub tight">還沒有人入選。</p>`;
  const rows = [...hall]
    .reverse()
    .map((m) => {
      const t = league.get(m.team);
      return `<li class="${m.me ? 'mine' : ''}">${t ? logoHtml(t, 'slogo') : ''}<b>${esc(m.name)}</b><span>${label(m.year)} 球季後退休 · ${esc(m.note)}</span></li>`;
    })
    .join('');
  return `<h3>名人堂<small>${hall.length} 人</small></h3><ul class="hall">${rows}</ul>`;
}

/** The news tab: newest first. */
export function newsHtml(c: CareerState): string {
  const news = [...(c.news ?? [])].reverse();
  if (!news.length) return `<p class="sub tight">還沒有新聞。</p>`;
  const when = (year: number, day: number) =>
    day < 0 ? `${label(year)} 休賽季` : day >= c.settings.seasonGames ? `${label(year)} 季後賽` : `${label(year)} 例行賽第 ${day} 場`;
  return (
    `<ul class="feed">` +
    news.map((n) => `<li class="${n.mine ? 'mine' : ''}"><small>${when(n.year, n.day)}</small>${esc(n.text)}</li>`).join('') +
    `</ul>`
  );
}

/** Career highs, single games on the NBA scale. */
export function highsHtml(c: CareerState, league: Map<string, TeamInfo>): string {
  const h = c.highs ?? {};
  const rows = RECORD_KEYS.filter((k) => h[k])
    .map((k) => {
      const x = h[k]!;
      const opp = league.get(x.opp);
      return `<tr><td>${RECORD_NAME[k]}</td><td><b>${x.value}</b></td><td>${label(x.year)}${x.playoff ? ' 季後賽' : ''} 對 ${esc(opp?.name ?? x.opp)}</td></tr>`;
    })
    .join('');
  return rows ? `<h3>單場生涯新高<small>換算成 48 分鐘 NBA 比賽</small></h3><table class="standings leaders"><tbody>${rows}</tbody></table>` : '';
}

/** Career totals (NBA scale) and the Hall of Fame case, for the retirement page. */
export function hofHtml(c: CareerState): string {
  const { points, parts } = hofCase(c);
  const inducted = (c.hall ?? []).some((m) => m.me);
  const list = parts.map(([k, v]) => `<li>${k}<b>+${v}</b></li>`).join('');
  return (
    `<div class="hofcard${inducted ? ' in' : ''}"><small>名人堂</small><b>${inducted ? '入選名人堂！' : '未入選名人堂'}</b>` +
    `<span>名人堂積分 ${points} / ${HOF_POINTS}</span>${list ? `<ul>${list}</ul>` : ''}</div>`
  );
}
