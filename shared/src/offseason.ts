import {
  HOF_POINTS,
  STAT_KEYS,
  STAT_TITLE,
  addNews,
  hofCase,
  leagueHofNote,
  myAwards,
  seasonAwards,
  type AwardId,
  type SeasonAwards,
} from './awards';
import {
  baseTeams,
  leagueTeams,
  makeProspect,
  rookieContract,
  salaryFor,
  seededRandom,
  startSeason,
  type CareerState,
  type League,
  type Offer,
  type Offseason,
  type Rand,
  type SeasonSummary,
} from './career';
import { START_COHESION, endorsement, fansAfterAwards, moneyText, fansText } from './economy';
import { RATING_KEYS, ageInSeason, playerRating, ratingAverage } from './roster';
import { record, statScale } from './season';
import type { PlayerInfo, PlayerStats, Ratings, TeamInfo } from './types';

/**
 * Between seasons: a summary of the year, everyone a year older (young
 * players grow, veterans slow down and retire, rookies take their places),
 * contracts count down, and free agency or a trade request when he wants one.
 */

/** He may retire from this age, and must at the last. */
export const RETIRE_FROM = 35;
export const RETIRE_AT = 40;
/** Decline starts at this age. */
export const DECLINE_AGE = 31;

const ATHLETIC: (keyof Ratings)[] = ['speed', 'jump', 'stamina'];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A believable age for a player with no birthday in shared/data/birthdays.json (npm run ages:update): stable per name, 20-35, mostly mid-20s. */
export function guessAge(name: string): number {
  const h = hash(name);
  return 20 + ((h % 8) + ((h >>> 3) % 9)); // two dice: 20..35, peak around 28
}

/** The career's own copy of the league, made the first time it changes. */
export function ensureLeague(career: CareerState, nba: TeamInfo[]): League {
  if (!career.league) {
    const teams = nba.map((t) => ({ ...t, players: t.players.map((p) => ({ ...p, ratings: { ...p.ratings } })) }));
    const ages: Record<string, number> = {};
    for (const t of teams) for (const p of t.players) ages[p.name] = ageInSeason(p.name, career.year) ?? guessAge(p.name);
    career.league = { teams, ages };
  }
  return career.league;
}

const emptyStats = (): PlayerStats => ({ secs: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, ftm: 0, fta: 0, pf: 0 });

function addStats(into: PlayerStats, s: PlayerStats): void {
  for (const k of Object.keys(into) as (keyof PlayerStats)[]) into[k] += s[k];
}

/** 0 missed the playoffs, 1-4 the round his team went out in, 5 champions. */
function playoffResult(career: CareerState): number {
  const s = career.season!;
  if (s.champion === career.team) return 5;
  const mine = (s.playoffs?.series ?? []).filter((x) => x.hi === career.team || x.lo === career.team);
  return mine.length ? Math.max(...mine.map((x) => x.round)) : 0;
}

export function seasonSummary(career: CareerState): SeasonSummary {
  const games = (career.games ?? []).filter((g) => g.stats.secs > 0);
  const totals = emptyStats();
  const playoffTotals = emptyStats();
  for (const g of games) addStats(g.playoff ? playoffTotals : totals, g.stats);
  return {
    year: career.season!.year,
    team: career.team!,
    age: career.player.age,
    ovr: playerRating(career.player.info),
    record: record(career.season!, career.team!),
    result: playoffResult(career),
    gp: games.filter((g) => !g.playoff).length,
    totals,
    playoffGp: games.filter((g) => g.playoff).length,
    playoffTotals,
    scale: statScale(career.settings.quarterSeconds),
  };
}

// ----------------------------------------------------------------- aging

/** A year older: before the decline nothing changes (XP does the growing); after it, athleticism goes first. */
function ageCareerPlayer(career: CareerState, r: Rand): Offseason['aged'] {
  const p = career.player;
  const from = p.age;
  p.age++;
  const changes: Offseason['aged']['changes'] = {};
  if (p.age >= DECLINE_AGE) {
    const years = p.age - DECLINE_AGE + 1;
    const ratings = { ...p.info.ratings };
    for (const k of RATING_KEYS) {
      const athletic = ATHLETIC.includes(k);
      // Athletic ratings drop from the first year; skills hold up a few years longer.
      const drop = athletic ? Math.min(5, 1 + Math.floor(years * 0.8 + r() * 1.5)) : p.age >= 34 ? Math.floor(r() * (years - 1)) : 0;
      if (drop > 0) {
        ratings[k] = Math.max(25, ratings[k] - drop);
        changes[k] = -drop;
      }
    }
    p.info = { ...p.info, ratings };
  }
  return { from, to: p.age, changes };
}

/** Growth or decline (overall points) for a league player of this age. */
function development(age: number, r: Rand): number {
  if (age <= 22) return 2 + r() * 2.5;
  if (age <= 25) return 0.5 + r() * 2.5;
  if (age <= 29) return -1 + r() * 2;
  if (age <= 32) return -1.5 - r() * 1.5;
  return -2.5 - r() * 3;
}

function develop(p: PlayerInfo, delta: number, r: Rand): PlayerInfo {
  const ratings = { ...p.ratings };
  for (const k of RATING_KEYS) {
    const extra = delta < 0 && ATHLETIC.includes(k) ? delta * 0.6 : 0;
    ratings[k] = clamp(Math.round(ratings[k] + delta + extra + (r() - 0.5) * 2), 25, 99);
  }
  return { ...p, ratings };
}

function retires(age: number, ovr: number, r: Rand): boolean {
  if (age >= RETIRE_AT) return true;
  // Stars hang on longer.
  if (age >= 34 && r() < (age - 33) * 0.17 * (ovr >= 75 ? 0.4 : 1)) return true;
  return age >= 30 && ovr < 58 && r() < 0.35;
}

/** Everyone else a year older; retirees replaced by rookies on the same team. */
function ageLeague(career: CareerState, nba: TeamInfo[], r: Rand): Pick<Offseason, 'retired' | 'rookies'> {
  const league = ensureLeague(career, nba);
  const retired: Offseason['retired'] = [];
  const rookies: Offseason['rookies'] = [];
  const taken = new Set([career.player.info.name, ...Object.keys(league.ages)]);
  league.debut = league.debut ?? {};
  league.teams = league.teams.map((t) => {
    const numbers = new Set(t.players.map((p) => p.number));
    const players: PlayerInfo[] = [];
    for (const p of t.players) {
      const age = (league.ages[p.name] ?? guessAge(p.name)) + 1;
      if (retires(age, Math.round(ratingAverage(p)), r)) {
        retired.push({ name: p.name, team: t.abbr, ovr: playerRating(p), age });
        delete league.ages[p.name];
        delete league.debut![p.name];
        numbers.delete(p.number);
        continue;
      }
      league.ages[p.name] = age;
      players.push(develop(p, development(age, r), r));
    }
    // Fill back to at least as many players as before (and never under eight) with draft picks.
    const want = Math.max(8, t.players.length);
    while (players.length < want) {
      const pos = (['PG', 'SG', 'SF', 'PF', 'C'] as const)[Math.floor(r() * 5)];
      const rookie = makeProspect(r, pos, 57 + r() * 15, taken, numbers);
      league.ages[rookie.name] = 19 + Math.floor(r() * 4);
      league.debut![rookie.name] = career.year + 1;
      rookies.push({ name: rookie.name, team: t.abbr, ovr: playerRating(rookie) });
      players.push(rookie);
    }
    // Best first, so the starting five are the best five again.
    players.sort((a, b) => playerRating(b) - playerRating(a));
    return { ...t, players: startersByPosition(players) };
  });
  retired.sort((a, b) => b.ovr - a.ovr);
  rookies.sort((a, b) => b.ovr - a.ovr);
  return { retired, rookies };
}

/** Puts a PG, SG, SF, PF and C up front where the roster has them (best at each), the rest after. */
function startersByPosition(players: PlayerInfo[]): PlayerInfo[] {
  const left = [...players];
  const starters: PlayerInfo[] = [];
  for (const pos of ['PG', 'SG', 'SF', 'PF', 'C'] as const) {
    const i = left.findIndex((p) => p.position === pos);
    if (i >= 0) starters.push(left.splice(i, 1)[0]);
  }
  while (starters.length < 5 && left.length) starters.push(left.shift()!);
  return [...starters, ...left];
}

// ----------------------------------------------------------------- contracts

/** Where he would rank on a team (1 = its best player). */
export function rankOn(team: TeamInfo, me: PlayerInfo): number {
  const ovr = playerRating(me);
  return team.players.filter((p) => p.name !== me.name && playerRating(p) > ovr).length + 1;
}

/**
 * Teams that want him: better players and better seasons draw more offers.
 * Teams he would play more for are likelier to call.
 */
export function makeOffers(career: CareerState, nba: TeamInfo[], r: Rand, opts: { exclude?: string; count?: number } = {}): Offer[] {
  const me = career.player;
  const ovr = Math.round(ratingAverage(me.info));
  const last = career.history?.[career.history.length - 1];
  const form = last && last.gp ? (last.totals.pts * last.scale) / last.gp : 0;
  const count = opts.count ?? clamp(Math.round(1 + (ovr - 58) / 6 + form / 12 + r()), 1, 4);
  const teams = baseTeams(career, nba).filter((t) => t.abbr !== opts.exclude);
  const scored = teams
    .map((t) => ({ t, w: r() * 4 - rankOn(t, me.info) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, count);
  const value = salaryFor(ovr, me.age);
  return scored.map(({ t }) => ({
    team: t.abbr,
    years: clamp(Math.round((me.age < 27 ? 3 : me.age < 31 ? 2 : 1) + r() * 2 - 0.5), 1, 4),
    salary: Math.round(value * (0.85 + r() * 0.3) * 10) / 10,
  }));
}

/** Signs an offer (free agency) or completes a trade to that team. */
export function acceptOffer(career: CareerState, offer: Offer, nba?: TeamInfo[]): void {
  const o = career.offseason!;
  if (!o.offers.some((x) => x.team === offer.team)) return;
  const name = (nba && baseTeams(career, nba).find((t) => t.abbr === offer.team)?.name) || offer.team;
  const me = career.player.info.name;
  if (o.kind === 'trade') addNews(career, `交易完成：${me} 被交易到 ${name}。`, true);
  else if (offer.team === career.team) addNews(career, `${me} 與 ${name} 續約 ${offer.years} 年，每年 ${offer.salary} 百萬美元。`, true);
  else addNews(career, `${me} 以自由球員身分加盟 ${name}：${offer.years} 年，每年 ${offer.salary} 百萬美元。`, true);
  // A new team: they have to learn to play together.
  if (offer.team !== career.team) career.cohesion = START_COHESION;
  career.team = offer.team;
  career.contract =
    o.kind === 'trade' && career.contract ? { ...career.contract, team: offer.team } : { team: offer.team, years: offer.years, salary: offer.salary };
  o.offers = [];
  o.kind = 'none';
  o.mustSign = false;
}

/** Asks out: two or three other teams come forward, his contract goes with him. */
export function requestTrade(career: CareerState, nba: TeamInfo[]): void {
  const o = career.offseason!;
  if (o.tradeAsked || o.kind !== 'none' || career.stage !== 'offseason') return;
  const r = seededRandom(hash(`${career.year}${career.player.info.name}trade`));
  o.tradeAsked = true;
  o.kind = 'trade';
  o.offers = makeOffers(career, nba, r, { exclude: career.team ?? undefined, count: 2 + Math.floor(r() * 2) }).map((x) => ({
    ...x,
    years: career.contract?.years ?? x.years,
    salary: career.contract?.salary ?? x.salary,
  }));
}

/** Stays put after asking for a trade. */
export function cancelTrade(career: CareerState): void {
  const o = career.offseason!;
  if (o.kind !== 'trade') return;
  o.kind = 'none';
  o.offers = [];
}

// ----------------------------------------------------------------- news

function awardNews(career: CareerState, a: SeasonAwards, mine: AwardId[]): void {
  const me = career.player.info.name;
  const label = `${a.year}-${String((a.year + 1) % 100).padStart(2, '0')}`;
  const winner = (x: { name: string; team: string } | null | undefined) => (x ? `${x.name}（${x.team}）` : '');
  if (a.mvp[0]) addNews(career, `${label} 年度 MVP：${winner(a.mvp[0])}${a.mvp[0].name === me ? '！' : '。'}`, a.mvp[0].name === me);
  if (a.finalsMvp) addNews(career, `總冠軍賽 MVP：${winner(a.finalsMvp)}。`, a.finalsMvp.name === me);
  if (a.roy[0]) addNews(career, `年度新人王：${winner(a.roy[0])}。`, a.roy[0].name === me);
  const titles = STAT_KEYS.filter((k) => mine.includes(k)).map((k) => STAT_TITLE[k]);
  if (titles.length) addNews(career, `${me} 拿下本季${titles.join('、')}！`, true);
  const vote = a.mvp.findIndex((x) => x.name === me);
  if (vote > 0) addNews(career, `${me} 在 MVP 票選排第 ${vote + 1}。`, true);
}

/** The best of the retirees make the news, and the greats the Hall of Fame. */
function retirementNews(career: CareerState, retired: Offseason['retired']): void {
  for (const x of retired) {
    const note = leagueHofNote(career, x.name, x.ovr);
    if (note) {
      career.hall = [...(career.hall ?? []), { name: x.name, year: career.season?.year ?? career.year, team: x.team, note }];
      addNews(career, `${x.name}（${x.team}）退休，入選名人堂（${note}）。`);
    } else if (x.ovr >= 81) addNews(career, `${x.name}（${x.team}）以 ${x.age} 歲之齡宣布退休。`);
  }
}

// ----------------------------------------------------------------- the offseason

/**
 * Turns the season over: his summary into the history, everyone a year
 * older, his contract a year shorter (free agency when it runs out). He is
 * retired at RETIRE_AT.
 */
export function beginOffseason(career: CareerState, nba: TeamInfo[]): void {
  if (career.stage !== 'offseason' || career.offseason || !career.season) return;
  const r = seededRandom(hash(`${career.year}${career.player.info.name}offseason`));
  // Careers begun before contracts existed: give them the rookie deal they would have had.
  if (!career.contract && career.team) career.contract = rookieContract(career.team, career.draft?.pick ?? 30);
  // The awards go on this season's ratings and rosters, before anyone ages.
  const summary = seasonSummary(career);
  summary.awards = seasonAwards(career, leagueTeams(career, nba));
  summary.mine = myAwards(career, summary.awards);
  awardNews(career, summary.awards, summary.mine);
  // Awards bring fans; fans bring endorsements.
  career.fans = fansAfterAwards(career.fans ?? 50_000, summary.mine);
  const deals = endorsement(career.fans);
  career.money = (career.money ?? 0) + deals;
  summary.fans = career.fans;
  summary.endorsement = deals;
  addNews(career, `${career.player.info.name} 目前有 ${fansText(career.fans)} 粉絲，本季代言收入 ${moneyText(deals)}。`, true);
  career.history = [...(career.history ?? []), summary];
  const aged = ageCareerPlayer(career, r);
  const { retired, rookies } = ageLeague(career, nba, r);
  retirementNews(career, retired);
  const o: Offseason = { aged, retired, rookies, offers: [], kind: 'none', tradeAsked: false, mustSign: false };
  career.offseason = o;
  if (career.player.age >= RETIRE_AT) {
    retire(career);
    return;
  }
  if (career.contract) {
    career.contract.years--;
    if (career.contract.years <= 0) {
      o.kind = 'free';
      o.mustSign = true;
      o.offers = makeOffers(career, nba, r);
    }
  }
}

export function canRetire(career: CareerState): boolean {
  return career.stage === 'offseason' && career.player.age >= RETIRE_FROM;
}

export function retire(career: CareerState): void {
  const me = career.player.info.name;
  const seasons = (career.history ?? []).length;
  addNews(career, `${me} 宣布退休，結束 ${seasons} 個球季的職業生涯。`, true);
  const hof = hofCase(career);
  if (hof.points >= HOF_POINTS) {
    const last = career.history?.[career.history.length - 1];
    const note = hof.parts.map(([k, v]) => `${k} ${v}`).join('、');
    career.hall = [...(career.hall ?? []), { name: me, year: last?.year ?? career.year, team: last?.team ?? career.team ?? '', note, me: true }];
    addNews(career, `${me} 入選名人堂！`, true);
  }
  career.stage = 'retired';
  career.season = null;
  career.games = [];
}

/** Next season, once any free agency is settled. */
export function startNextSeason(career: CareerState, nba: TeamInfo[], seed: number): boolean {
  const o = career.offseason;
  if (career.stage !== 'offseason' || !o || o.mustSign) return false;
  if (o.kind === 'trade') cancelTrade(career);
  career.year++;
  startSeason(career, nba, seed);
  return true;
}

/** His team for the coming season with him on it (for the offseason roster view). */
export function upcomingTeam(career: CareerState, nba: TeamInfo[]): TeamInfo | undefined {
  return leagueTeams(career, nba).get(career.team ?? '');
}
