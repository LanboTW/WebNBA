import {
  COMBINE_GAMES,
  NBA_TEAMS,
  ROOKIE_SLOT,
  archetype,
  careerGame,
  careerGameSettings,
  combineDone,
  combineIndex,
  combineMatch,
  findTeam,
  playerRating,
  recordCombineGame,
  runDraft,
  joinDraftedTeam,
  simulateGame,
  teamRating,
  withCareerPlayer,
  type CareerGame,
  type CareerState,
  type GameSettings,
  type GameState,
  type PlayerInfo,
  type TeamInfo,
} from '@webnba/shared';
import { esc } from './boxscore';
import { POSITION_LABEL } from './careerCreate';
import { logoHtml } from './logos';

/** What the career screens need from the rest of the page. */
export interface CareerHost {
  /** Puts this player alone on the menu court (the preview behind the career screens). */
  preview(player: PlayerInfo, team: TeamInfo): void;
  /**
   * Plays a game with the player's team as team 0. `done` gets the final state;
   * a game left early has been played out by the computer first.
   */
  play(teams: [TeamInfo, TeamInfo], settings: Partial<GameSettings>, rosterIdx: number, done: (state: GameState) => void): void;
  /** Saves the career; resolves to a message when it didn't reach the cloud. */
  save(career: CareerState): Promise<string | null>;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

/** The team colours the player wears right now. */
export function careerTeam(c: CareerState): TeamInfo {
  if (c.draft) return withCareerPlayer(findTeam(c.draft.team), c.player.info);
  return c.combine.teams[0];
}

export function careerSummary(c: CareerState): { player: string; team: string; detail: string } {
  const ovr = playerRating(c.player.info);
  if (c.stage === 'combine') {
    return { player: c.player.info.name, team: '選秀試訓', detail: `試訓 ${c.combine.games.length}/${COMBINE_GAMES} 場 · 總評 ${ovr}` };
  }
  const t = findTeam(c.draft!.team);
  return { player: c.player.info.name, team: t.abbr, detail: `${c.year} 選秀第 ${c.draft!.pick} 順位 · ${t.name} · 總評 ${ovr}` };
}

function line(g: CareerGame): string {
  const s = g.stats;
  const pct = (m: number, a: number) => (a ? `${m}/${a}` : '0/0');
  return `${s.pts} 分 ${s.oreb + s.dreb} 籃板 ${s.ast} 助攻 ${s.stl} 抄截 ${s.blk} 阻攻 · 投籃 ${pct(s.fgm, s.fga)} · 三分 ${pct(s.tpm, s.tpa)}`;
}

/**
 * The career's home screen. For now: the draft combine, the draft, and the
 * team you join. The season arrives with the next batch.
 */
export class CareerHub {
  career: CareerState | null = null;
  private busy = false;

  constructor(private readonly host: CareerHost) {
    $('#hubBody').addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act && !this.busy) void this.act(act);
    });
  }

  open(career: CareerState): void {
    this.career = career;
    this.msg('');
    this.render();
    this.host.preview(career.player.info, careerTeam(career));
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

  private async act(act: string): Promise<void> {
    const c = this.career!;
    if (act === 'play' || act === 'sim') {
      if (combineDone(c)) return;
      const teams = combineMatch(c);
      const settings = careerGameSettings(c, (Math.random() * 2 ** 31) | 0);
      const idx = combineIndex(c);
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
    } else if (act === 'draft') {
      if (!combineDone(c) || c.draft) return;
      joinDraftedTeam(c, runDraft(c, NBA_TEAMS));
      this.render(true);
      this.host.preview(c.player.info, careerTeam(c));
      await this.save();
    }
  }

  private finishGame(game: CareerGame): void {
    const c = this.career!;
    recordCombineGame(c, game);
    this.render();
    this.host.preview(c.player.info, careerTeam(c));
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
    $('#hubBody').innerHTML = head + (c.stage === 'combine' ? this.combineHtml(c) : this.draftedHtml(c, reveal));
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
        `${g.simmed ? '<small>模擬</small>' : ''}<span>${line(g)}</span></div><span class="grade g${g.grade[0]}">${g.grade}</span></li>`
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
      `<p class="sub tight soon">例行賽、戰績表和季後賽會在下一次更新開放，到時候從這裡接著打。</p>`
    );
  }
}
