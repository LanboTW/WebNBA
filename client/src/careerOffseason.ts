import {
  AWARD_NAME,
  RETIRE_AT,
  ROLES,
  ROUND_NAME,
  canRetire,
  playerRating,
  rankOn,
  tierForRank,
  type AwardId,
  type CareerState,
  type Offer,
  type SeasonSummary,
  type TeamInfo,
} from '@webnba/shared';
import { esc } from './boxscore';
import { hallHtml, highsHtml, hofHtml, newsHtml, seasonAwardsHtml, trophiesHtml } from './careerAwards';
import { RATING_LABEL } from './careerCreate';
import { logoHtml } from './logos';

const color = (t: TeamInfo) => (t.primary === '#000000' ? t.secondary : t.primary);
const label = (year: number) => `${year}-${String((year + 1) % 100).padStart(2, '0')}`;

/** How far his team went. */
export function resultText(result: number): string {
  if (result === 5) return '總冠軍';
  if (result === 0) return '未進季後賽';
  return `${ROUND_NAME[result]}出局`;
}

/** Per-game line of a finished season on the NBA scale. */
function perGame(h: SeasonSummary, playoffs = false): { pts: string; reb: string; ast: string } {
  const n = Math.max(1, playoffs ? h.playoffGp : h.gp);
  const t = playoffs ? h.playoffTotals : h.totals;
  const f = (v: number) => ((v * h.scale) / n).toFixed(1);
  return { pts: f(t.pts), reb: f(t.oreb + t.dreb), ast: f(t.ast) };
}

/** Every finished season, a row each. */
export function historyHtml(c: CareerState, league: Map<string, TeamInfo>): string {
  const rows = (c.history ?? [])
    .map((h) => {
      const t = league.get(h.team);
      const g = perGame(h);
      return (
        `<tr><td>${label(h.year)}</td><td>${t ? logoHtml(t, 'slogo') : ''}${esc(h.team)}</td><td>${h.age}</td><td>${h.ovr}</td>` +
        `<td>${h.gp}</td><td>${g.pts}</td><td>${g.reb}</td><td>${g.ast}</td><td>${h.record[0]}-${h.record[1]}</td><td>${resultText(h.result)}</td></tr>`
      );
    })
    .join('');
  if (!rows) return '';
  return (
    `<h3>生涯紀錄<small>每場平均，換算成 48 分鐘 NBA 比賽</small></h3>` +
    `<div class="tablewrap"><table class="standings stats"><thead><tr><th>球季</th><th>球隊</th><th>年齡</th><th>總評</th><th>場</th><th>得分</th><th>籃板</th><th>助攻</th><th>戰績</th><th>季後賽</th></tr></thead><tbody>${rows}</tbody></table></div>`
  );
}

function offerCard(c: CareerState, o: Offer, league: Map<string, TeamInfo>, kind: 'free' | 'trade'): string {
  const t = league.get(o.team)!;
  const rank = rankOn(t, c.player.info);
  const role = ROLES[tierForRank(rank)];
  return (
    `<div class="offer" style="--team:${color(t)}">${logoHtml(t, 'tlogo')}<div><b>${esc(t.name)}</b>` +
    `<span>${o.years} 年 · 每年 ${o.salary} 百萬美元</span><span>預計角色：${role[0]}（隊內總評第 ${rank}）</span></div>` +
    `<button type="button" class="primary" data-act="accept" data-team="${o.team}">${kind === 'free' ? '簽約' : '交易過去'}</button></div>`
  );
}

/** The offseason page: the season gone, getting older, the league moving on, his contract. */
export function offseasonHtml(c: CareerState, league: Map<string, TeamInfo>, confirmRetire: boolean): string {
  const o = c.offseason!;
  const h = c.history![c.history!.length - 1];
  const team = league.get(c.team!)!;
  const g = perGame(h);

  const summary =
    `<div class="nextcard" style="--team:${color(team)}"><small>${label(h.year)} 球季總結</small>` +
    `<div class="nextopp">${logoHtml(team, 'tlogo')}<div><b>${h.record[0]} 勝 ${h.record[1]} 敗 · ${resultText(h.result)}</b>` +
    `<span>${h.gp ? `${h.gp} 場 · 平均 ${g.pts} 分 ${g.reb} 籃板 ${g.ast} 助攻` : '整季沒有上場紀錄'} · 季末總評 ${h.ovr}</span></div></div>` +
    awardBadges(h.mine ?? []) +
    `</div>` +
    (h.awards ? seasonAwardsHtml(h.awards, c.player.info.name, league, '本季') : '');

  const changes = Object.entries(o.aged.changes)
    .map(([k, d]) => `${RATING_LABEL[k as keyof typeof RATING_LABEL]} ${d}`)
    .join('、');
  const aging =
    `<h3>年齡<small>${o.aged.from} → ${o.aged.to} 歲</small></h3>` +
    `<p class="sub tight">${changes ? `年紀漸長，能力退步：${changes}。` : '還在成長期：能力靠比賽經驗和訓練提升。'}` +
    `${c.player.age >= RETIRE_AT - 1 ? `明年 ${RETIRE_AT} 歲會強制退休。` : ''}</p>`;

  const contract = c.contract;
  let deal: string;
  if (o.kind === 'free') {
    deal =
      `<h3>自由球員<small>合約到期，選一份合約才能開始下一季</small></h3>` +
      `<div class="offers">${o.offers.map((x) => offerCard(c, x, league, 'free')).join('')}</div>`;
  } else if (o.kind === 'trade') {
    deal =
      `<h3>交易要求<small>這些球隊有興趣，合約跟著你走</small></h3>` +
      `<div class="offers">${o.offers.map((x) => offerCard(c, x, league, 'trade')).join('')}</div>` +
      `<div class="buttons"><button type="button" data-act="cancelTrade">留在 ${esc(team.name)}</button></div>`;
  } else {
    deal =
      `<h3>合約</h3><p class="sub tight">${esc(team.name)} · 還有 ${contract?.years ?? 0} 年 · 每年 ${contract?.salary ?? 0} 百萬美元</p>` +
      (o.tradeAsked
        ? ''
        : `<div class="buttons"><button type="button" data-act="requestTrade">要求交易</button></div>`);
  }

  const news = [
    ...o.retired.slice(0, 5).map((r) => `<li><b>${esc(r.name)}</b>（${r.team}，${r.age} 歲，總評 ${r.ovr}）宣布退休</li>`),
    ...o.rookies.slice(0, 3).map((r) => `<li>新秀 <b>${esc(r.name)}</b> 加入 ${r.team}（總評 ${r.ovr}）</li>`),
  ].join('');
  const league_ =
    `<h3>聯盟動態<small>${o.retired.length} 人退休、${o.rookies.length} 名新秀加入</small></h3>` + (news ? `<ul class="news">${news}</ul>` : '');

  const retire = canRetire(c)
    ? confirmRetire
      ? `<div class="conflict"><p>確定要退休嗎？退休後這個生涯就結束了。</p><div class="buttons"><button type="button" class="danger" data-act="retire">宣布退休</button><button type="button" data-act="keepPlaying">再打一年</button></div></div>`
      : `<div class="buttons"><button type="button" data-act="askRetire">考慮退休</button></div>`
    : '';

  const next = o.mustSign
    ? ''
    : `<div class="buttons"><button type="button" class="primary" data-act="nextSeason">開始 ${label(c.year + 1)} 球季</button></div>`;

  return summary + aging + deal + league_ + retire + next;
}

/** What he won this season, as badges on the summary card. */
function awardBadges(mine: AwardId[]): string {
  return mine.length ? `<div class="trophies">${mine.map((id) => `<span class="trophy t-${id}">${AWARD_NAME[id]}</span>`).join('')}</div>` : '';
}

/** After the last game: his career in one page. */
export function retiredHtml(c: CareerState, league: Map<string, TeamInfo>): string {
  const hist = c.history ?? [];
  const titles = hist.filter((h) => h.result === 5).length;
  const games = hist.reduce((n, h) => n + h.gp, 0);
  const pts = hist.reduce((n, h) => n + h.totals.pts * h.scale, 0);
  return (
    `<div class="draftcard"><small>生涯結束</small><div class="draftteam"><b>${esc(c.player.info.name)}</b></div>` +
    `<span>${hist.length} 個球季 · ${games} 場 · 生涯平均 ${(pts / Math.max(1, games)).toFixed(1)} 分 · ${titles} 座總冠軍 · 退休時總評 ${playerRating(c.player.info)}</span></div>` +
    hofHtml(c) +
    `<h3>個人獎項</h3>${trophiesHtml(c)}` +
    historyHtml(c, league) +
    highsHtml(c, league) +
    hallHtml(c, league) +
    `<h3>生涯新聞</h3>${newsHtml(c)}`
  );
}
