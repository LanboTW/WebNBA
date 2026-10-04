import {
  COMBINE_GAMES,
  NBA_TEAMS,
  ROOKIE_SLOT,
  activeSeriesOf,
  archetype,
  careerGame,
  careerMatchup,
  careerGameSettings,
  combineDone,
  combineIndex,
  combineMatch,
  findTeam,
  playerRating,
  recordCombineGame,
  runDraft,
  joinDraftedTeam,
  leagueTeams,
  nextCareerGame,
  record,
  recordSeasonGame,
  seasonOver,
  simPlayoffsUntilMine,
  acceptOffer,
  beginOffseason,
  canRetire,
  cancelTrade,
  requestTrade,
  retire,
  startNextSeason,
  rotationRole,
  train,
  simulateGame,
  startSeason,
  teamRating,
  withCareerPlayer,
  COIN_TRANSFER_MAX,
  ageInSeason,
  buyCamp,
  buyGear,
  canSettle,
  canTransferCoins,
  careerInfo,
  guessAge,
  settle,
  toggleGear,
  transferCoins,
  seasonLines,
  type CareerGame,
  type CareerState,
  type GameSettings,
  type GameState,
  type PlayerInfo,
  type Ratings,
  type TeamInfo,
} from '@webnba/shared';
import { esc } from './boxscore';
import { PlayerDb, type DbSource } from './playerDb';
import { coinBoxHtml } from './careerShop';
import { wallet } from './wallet';
import { POSITION_LABEL } from './careerCreate';
import { offseasonHtml, retiredHtml } from './careerOffseason';
import { gradeBadge, seasonHtml, seasonLabel, type SeasonTab } from './careerSeason';
import { logoHtml } from './logos';

/** What the career screens need from the rest of the page. */
export interface CareerHost {
  /** Puts this player alone on the menu court (the preview behind the career screens). */
  preview(player: PlayerInfo, team: TeamInfo): void;
  /**
   * Plays a game with the player's team as team 0. `done` gets the final state;
   * a game left early has been played out by the computer first.
   */
  play(teams: [TeamInfo, TeamInfo], settings: Partial<GameSettings>, rosterIdx: number, done: (state: GameState) => void, home?: boolean): void;
  /** Saves the career; resolves to a message when it didn't reach the cloud. */
  save(career: CareerState): Promise<string | null>;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

/** The team colours the player wears right now. */
export function careerTeam(c: CareerState): TeamInfo {
  const abbr = c.team ?? c.draft?.team;
  if (abbr) return withCareerPlayer(findTeam(abbr), c.player.info);
  return c.combine.teams[0];
}

export function careerSummary(c: CareerState): { player: string; team: string; detail: string } {
  const ovr = playerRating(c.player.info);
  if (c.stage === 'combine') {
    return { player: c.player.info.name, team: '選秀試訓', detail: `試訓 ${c.combine.games.length}/${COMBINE_GAMES} 場 · 總評 ${ovr}` };
  }
  const t = findTeam(c.team ?? c.draft!.team);
  const s = c.season;
  if (c.stage === 'retired') {
    const hall = (c.hall ?? []).some((m) => m.me) ? ' · 名人堂' : '';
    return { player: c.player.info.name, team: t.abbr, detail: `已退休 · ${(c.history ?? []).length} 個球季${hall} · 總評 ${ovr}` };
  }
  if (!s) return { player: c.player.info.name, team: t.abbr, detail: `${c.year} 選秀第 ${c.draft!.pick} 順位 · ${t.name} · 總評 ${ovr}` };
  if (c.offseason) return { player: c.player.info.name, team: t.abbr, detail: `${seasonLabel(s.year)} 休賽季 · ${c.player.age} 歲 · 總評 ${ovr}` };
  const [w, l] = record(s, t.abbr);
  const where = s.champion ? (s.champion === t.abbr ? '總冠軍！' : '球季結束') : seasonOver(s) ? '季後賽' : `例行賽 ${s.day}/${s.days}`;
  return { player: c.player.info.name, team: t.abbr, detail: `${seasonLabel(s.year)} 球季 · ${w} 勝 ${l} 敗 · ${where} · 總評 ${ovr}` };
}

function line(g: CareerGame): string {
  const s = g.stats;
  const pct = (m: number, a: number) => (a ? `${m}/${a}` : '0/0');
  return `${s.pts} 分 ${s.oreb + s.dreb} 籃板 ${s.ast} 助攻 ${s.stl} 抄截 ${s.blk} 阻攻 · 投籃 ${pct(s.fgm, s.fga)} · 三分 ${pct(s.tpm, s.tpa)}`;
}

/**
 * The career's home screen: the draft combine, the draft, then the season
 * (next game, schedule, standings, playoffs, stats).
 */
/** The career's league for the player database: its ages, and this season's lines while it runs. */
function careerDbSource(c: CareerState, league: Map<string, TeamInfo>): DbSource {
  const year = c.season?.year ?? c.year;
  const groups = new Map<string, TeamInfo[]>([
    ['NBA東', [...league.values()].filter((t) => t.conference !== 'West')],
    ['NBA西', [...league.values()].filter((t) => t.conference === 'West')],
  ]);
  for (const list of groups.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  const me = c.player.info.name;
  const lines = c.season && !c.offseason && c.season.day > 0 ? new Map(seasonLines(c, league).map((l) => [l.name, l])) : null;
  return {
    groups,
    me,
    age: (p) => (p.name === me ? c.player.age : (c.league?.ages[p.name] ?? ageInSeason(p.name, year) ?? guessAge(p.name))),
    line: lines ? (p) => lines.get(p.name) : undefined,
  };
}

/** A training button being held down (steps: 0 still waiting, -1 just started repeating, then points added). */
interface Hold {
  key: keyof Ratings;
  id: number;
  x: number;
  y: number;
  steps: number;
  timer: number;
}
const TRAIN_HOLD_MS = 2000;
const TRAIN_REPEAT_MS = 120;

export class CareerHub {
  career: CareerState | null = null;
  private busy = false;
  private tab: SeasonTab = 'home';
  private readonly db = new PlayerDb();

  constructor(private readonly host: CareerHost) {
    // The coin box shows the account's coins: redraw when they change (not while typing in it).
    wallet.watch(() => {
      const typing = (document.activeElement as HTMLElement | null)?.dataset?.coin;
      if (this.career && !this.busy && !typing && !$('#hub').classList.contains('hidden')) this.render();
    });
    $('#hubBody').addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      const tab = el.closest<HTMLElement>('[data-tab]')?.dataset.tab as SeasonTab | undefined;
      if (tab) {
        this.tab = tab;
        this.render();
        return;
      }
      const key = el.closest<HTMLElement>('[data-train]')?.dataset.train as keyof Ratings | undefined;
      if (key) {
        // Mouse and touch go through the press below; this is the keyboard's Enter / Space.
        if (e.detail === 0 && !this.busy) this.trainOne(key);
        return;
      }
      const btn = el.closest<HTMLElement>('[data-act]');
      if (btn?.dataset.act && !this.busy) void this.act(btn.dataset.act, btn.dataset.team ?? btn.dataset.arg);
    });
    this.holdToTrain();
  }

  /**
   * Training buttons: a tap adds one point; held for 2 seconds they keep
   * adding until let go, out of XP or at the cap. The page redraws under the
   * finger each step, so the press is tracked on the body, not the button.
   */
  private holdToTrain(): void {
    const body = $('#hubBody');
    body.addEventListener('contextmenu', (e) => {
      if ((e.target as HTMLElement).closest('[data-train]')) e.preventDefault();
    });
    body.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-train]');
      if (!btn || btn.disabled || this.busy) return;
      this.endHold(false);
      try {
        body.setPointerCapture(e.pointerId);
      } catch {
        // Pointer already gone: the window listeners below still end it.
      }
      btn.classList.add('charging');
      const key = btn.dataset.train as keyof Ratings;
      const hold: Hold = { key, id: e.pointerId, x: e.clientX, y: e.clientY, steps: 0, timer: 0 };
      hold.timer = window.setTimeout(() => {
        hold.timer = window.setInterval(() => {
          if ($('#hub').classList.contains('hidden') || this.busy || !this.trainOne(key, true)) return this.endHold(false);
          hold.steps = Math.max(hold.steps, 0) + 1;
          $(`#hubBody [data-train="${key}"]`)?.classList.add('repeating');
        }, TRAIN_REPEAT_MS);
        hold.steps = -1;
      }, TRAIN_HOLD_MS);
      this.hold = hold;
    });
    window.addEventListener('pointermove', (e) => {
      const h = this.hold;
      // Dragging away before it starts repeating is a scroll, not a press.
      if (h && h.id === e.pointerId && h.steps === 0 && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 12) this.endHold(false);
    });
    window.addEventListener('pointerup', (e) => {
      if (this.hold?.id === e.pointerId) this.endHold(true);
    });
    window.addEventListener('pointercancel', (e) => {
      if (this.hold?.id === e.pointerId) this.endHold(false);
    });
    window.addEventListener('blur', () => this.endHold(false));
  }

  /** Stops a training press; `tap` adds the one point a short press is worth. */
  private endHold(tap: boolean): void {
    const h = this.hold;
    if (!h) return;
    this.hold = null;
    clearTimeout(h.timer);
    clearInterval(h.timer);
    for (const el of document.querySelectorAll('#hubBody .charging, #hubBody .repeating')) el.classList.remove('charging', 'repeating');
    if (h.steps === 0) {
      if (tap && !this.busy) this.trainOne(h.key);
    } else if (h.steps > 0 && this.career) this.host.preview(careerInfo(this.career), careerTeam(this.career));
  }
  private hold: Hold | null = null;

  open(career: CareerState): void {
    this.career = career;
    this.tab = 'home';
    this.msg('');
    this.render();
    this.host.preview(careerInfo(career), careerTeam(career));
  }

  private msg(text: string, bad = false): void {
    const el = $('#hubMsg');
    el.textContent = text;
    el.classList.toggle('bad', bad);
    el.classList.toggle('hidden', !text);
  }

  async save(): Promise<void> {
    const problem = await this.host.save(this.career!);
    this.msg(problem ?? '', !!problem);
  }

  private async act(act: string, team?: string): Promise<void> {
    const c = this.career!;
    if (await this.offseasonAct(act, team)) return;
    if (await this.econAct(act, team)) return;
    if (act === 'play' || act === 'sim') {
      if (combineDone(c)) return;
      const teams = combineMatch(c);
      const idx = combineIndex(c);
      const settings = careerGameSettings(c, (Math.random() * 2 ** 31) | 0, idx);
      if (act === 'sim') {
        this.busy = true;
        this.msg('模擬比賽中…');
        // Let the message paint before the sim takes the main thread.
        await new Promise((r) => setTimeout(r, 30));
        const state = simulateGame(teams, settings);
        this.finishGame(careerGame(state, idx, true));
        this.busy = false;
      } else {
        this.host.play(teams, settings, idx, (state) => this.finishGame(careerGame(state, idx, false)));
      }
    } else if (act === 'startSeason') {
      if (c.stage !== 'drafted') return;
      startSeason(c, NBA_TEAMS, (Math.random() * 2 ** 31) | 0);
      this.tab = 'home';
      this.render();
      await this.save();
    } else if (act === 'splay') {
      const next = nextCareerGame(c);
      if (!next) return;
      const m = careerMatchup(c, NBA_TEAMS, next);
      const settings = careerGameSettings(c, (Math.random() * 2 ** 31) | 0, m.rosterIdx, m.role.minutes);
      this.host.play(
        m.teams,
        settings,
        m.rosterIdx,
        (state) => this.finishSeasonGame([careerGame(state, m.rosterIdx, false)], next),
        m.home,
      );
    } else if (act === 'ssim' || act === 'ssim5' || act === 'ssimAll' || act === 'ssimSeries') {
      await this.simGames(act);
    } else if (act === 'simPlayoffs') {
      simPlayoffsUntilMine(c, NBA_TEAMS);
      this.render();
      await this.save();
    } else if (act === 'draft') {
      if (!combineDone(c) || c.draft) return;
      joinDraftedTeam(c, runDraft(c, NBA_TEAMS));
      this.render(true);
      this.host.preview(careerInfo(c), careerTeam(c));
      await this.save();
    }
  }

/** Sims his games with the real engine, one at a time so the page stays responsive. */
  private async simGames(act: string): Promise<void> {
    const c = this.career!;
    const first = nextCareerGame(c);
    if (!first) return;
    const series = first.playoff ? activeSeriesOf(c.season!, c.team!) : null;
    const limit = act === 'ssim' ? 1 : act === 'ssim5' ? 5 : 200;
    this.busy = true;
    for (let i = 0; i < limit; i++) {
      const next = nextCareerGame(c);
      // Stop at the end of the regular season, or of this series.
      if (!next || (first.playoff === 0 && next.playoff !== 0) || (series && activeSeriesOf(c.season!, c.team!) !== series)) break;
      this.msg(`模擬比賽中…（${i + 1}${limit > 1 ? `/${limit === 200 ? '…' : limit}` : ''}）`);
      await new Promise((r) => setTimeout(r, 20));
      const m = careerMatchup(c, NBA_TEAMS, next);
      const state = simulateGame(m.teams, careerGameSettings(c, (Math.random() * 2 ** 31) | 0, m.rosterIdx, m.role.minutes));
      recordSeasonGame(c, NBA_TEAMS, next, careerGame(state, m.rosterIdx, true));
    }
    this.busy = false;
    this.msg('');
    this.render();
    await this.save();
  }

  private finishSeasonGame(games: CareerGame[], next: NonNullable<ReturnType<typeof nextCareerGame>>): void {
    const c = this.career!;
    for (const g of games) recordSeasonGame(c, NBA_TEAMS, next, g);
    this.tab = 'home';
    this.render();
    this.host.preview(careerInfo(c), careerTeam(c));
    void this.save();
  }

  private confirmRetire = false;

  /** Offseason buttons; returns whether it handled the action. */
/** The shop, camps and coins. Returns whether it was one of those. */
  private async econAct(act: string, arg?: string): Promise<boolean> {
    const c = this.career!;
    switch (act) {
      case 'buy':
        if (!arg || !buyGear(c, arg)) return true;
        this.host.preview(careerInfo(c), careerTeam(c));
        break;
      case 'wear':
        if (!arg) return true;
        toggleGear(c, arg);
        this.host.preview(careerInfo(c), careerTeam(c));
        break;
      case 'camp':
        if (!buyCamp(c)) return true;
        break;
      case 'coinsIn': {
        const read = (k: string) => Math.max(0, Math.floor(Number(document.querySelector<HTMLInputElement>(`[data-coin="${k}"]`)?.value) || 0));
        const forMoney = read('money');
        const forXp = read('xp');
        const total = forMoney + forXp;
        if (!total || !canTransferCoins(c)) return true;
        if (total > COIN_TRANSFER_MAX) {
          this.msg(`一次最多轉入 ${COIN_TRANSFER_MAX} 金幣`, true);
          return true;
        }
        this.busy = true;
        const paid = await wallet.add(-total);
        this.busy = false;
        if (!paid) {
          this.msg('金幣不夠', true);
          return true;
        }
        // The window can't close while we waited, but never lose coins if it did.
        if (!transferCoins(c, forMoney, forXp)) void wallet.add(total);
        break;
      }
      case 'settle': {
        if (!canSettle(c)) return true;
        const coins = settle(c);
        // Saved first: a save that fails must not leave coins without the settlement.
        await this.save();
        await wallet.add(coins);
        this.msg(`已結算 ${coins} 金幣`);
        this.render();
        return true;
      }
      default:
        return false;
    }
    this.render();
    await this.save();
    return true;
  }

  private async offseasonAct(act: string, team?: string): Promise<boolean> {
    const c = this.career!;
    switch (act) {
      case 'beginOffseason':
        beginOffseason(c, NBA_TEAMS);
        break;
      case 'accept': {
        const offer = c.offseason?.offers.find((o) => o.team === team);
        if (!offer) return true;
        acceptOffer(c, offer, NBA_TEAMS);
        this.host.preview(careerInfo(c), careerTeam(c));
        break;
      }
      case 'requestTrade':
        requestTrade(c, NBA_TEAMS);
        break;
      case 'cancelTrade':
        cancelTrade(c);
        break;
      case 'askRetire':
      case 'keepPlaying':
        this.confirmRetire = act === 'askRetire';
        this.render();
        return true;
      case 'retire':
        if (!canRetire(c)) return true;
        retire(c);
        break;
      case 'nextSeason':
        if (!startNextSeason(c, NBA_TEAMS, (Math.random() * 2 ** 31) | 0)) return true;
        break;
      default:
        return false;
    }
    this.confirmRetire = false;
    this.tab = 'home';
    this.render();
    await this.save();
    return true;
  }

  /** One point of training; saved a moment later so a burst of clicks is one save. */
  /** One point on `key`; false when it can't (out of XP or at the cap). `quiet` leaves the 3D preview for later. */
  private trainOne(key: keyof Ratings, quiet = false): boolean {
    const c = this.career!;
    if (!train(c, key)) return false;
    this.render();
    if (!quiet) this.host.preview(careerInfo(c), careerTeam(c));
    clearTimeout(this.trainSave);
    this.trainSave = setTimeout(() => void this.save(), 800);
    return true;
  }
  private trainSave: ReturnType<typeof setTimeout> | undefined;

  private finishGame(game: CareerGame): void {
    const c = this.career!;
    recordCombineGame(c, game);
    this.render();
    this.host.preview(careerInfo(c), careerTeam(c));
    void this.save();
  }

  render(reveal = false): void {
    const c = this.career!;
    const p = c.player.info;
    $('#hubTitle').textContent = p.name;
    const head =
      `<div class="mehead"><span class="menum">#${p.number}</span><div><b>${esc(p.name)}</b>` +
      `<span>${p.position} ${POSITION_LABEL[p.position]} · ${archetype(c.player.archetype).name} · ${Math.round(p.heightM * 100)} cm · ${c.player.age} 歲</span></div>` +
      `<span class="meovr">${playerRating(p)}</span></div>`;
    const league = leagueTeams(c, NBA_TEAMS);
    const body =
      c.stage === 'combine'
        ? this.combineHtml(c)
        : c.stage === 'retired'
          ? retiredHtml(c, league)
          : c.stage === 'drafted' || !c.season
            ? this.draftedHtml(c, reveal)
            : seasonHtml(
                c,
                this.tab,
                league,
                rotationRole(c, NBA_TEAMS),
                c.offseason ? offseasonHtml(c, league, this.confirmRetire) : undefined,
              );
    $('#hubBody').innerHTML = head + body;
    const db = document.querySelector<HTMLElement>('#hubDb');
    if (db) this.db.mount(db, careerDbSource(c, league));
  }

  private combineHtml(c: CareerState): string {
    const games = c.combine.games;
    const next = games.length + 1;
    const rows = Array.from({ length: COMBINE_GAMES }, (_, i) => {
      const g = games[i];
      if (!g) return `<li class="game todo"><span class="gno">${i + 1}</span><div>尚未進行</div></li>`;
      const won = g.score[0] > g.score[1];
      return (
        `<li class="game"><span class="gno">${i + 1}</span><div><b class="${won ? 'win' : 'loss'}">${won ? '勝' : '敗'} ${g.score[0]}:${g.score[1]}</b>` +
        `${g.simmed ? '<small>模擬</small>' : ''}<span>${line(g)}</span></div>${gradeBadge(g.grade)}</li>`
      );
    }).join('');
    const done = combineDone(c);
    const buttons = done
      ? `<div class="buttons"><button type="button" class="primary" data-act="draft">前往選秀會</button></div>`
      : `<div class="buttons"><button type="button" class="primary" data-act="play">開始第 ${next} 場試訓</button>` +
        `<button type="button" data-act="sim">模擬這場</button></div>`;
    return (
      `<h3>選秀試訓<small>${games.length}/${COMBINE_GAMES} 場</small></h3>` +
      `<p class="sub tight">和其他新秀打 ${COMBINE_GAMES} 場試訓賽（你在藍隊）。球探看你的表現排選秀順位：表現越好越早被選，而越弱的球隊越先選。</p>` +
      `<ol class="games">${rows}</ol>` +
      buttons
    );
  }

  private draftedHtml(c: CareerState, reveal: boolean): string {
    const d = c.draft!;
    const team = findTeam(d.team);
    const roster = withCareerPlayer(team, c.player.info).players;
    const color = team.primary === '#000000' ? team.secondary : team.primary;
    const avg = c.combine.games.reduce((s, g) => s + g.rating, 0) / Math.max(1, c.combine.games.length);
    const rows = roster
      .map(
        (pl, i) =>
          `<div class="prow${i === ROOKIE_SLOT ? ' me' : ''}"><span>${i < 5 ? '先發' : `第 ${i + 1} 人`}　${pl.position} #${pl.number} ${esc(pl.name)}</span><b>${playerRating(pl)}</b></div>`,
      )
      .join('');
    return (
      `<div class="draftcard${reveal ? ' reveal' : ''}" style="--team:${color}">` +
      `<small>${c.year} NBA 選秀 · 第 ${d.pick} 順位</small>` +
      `<div class="draftteam">${logoHtml(team, 'draftlogo')}<b>${esc(team.name)}</b></div>` +
      `<span>試訓平均評分 ${avg.toFixed(1)} · 球隊總評 ${teamRating(team)}</span></div>` +
      `<h3>球隊陣容<small>你是第 ${ROOKIE_SLOT + 1} 人，靠表現爭取上場時間</small></h3>` +
      `<div class="card roster" style="--team:${color}">${rows}</div>` +
      coinBoxHtml(c, wallet.coins) +
      `<div class="buttons"><button type="button" class="primary" data-act="startSeason">開始 ${seasonLabel(c.year)} 球季（${c.settings.seasonGames} 場）</button></div>`
    );
  }
}
