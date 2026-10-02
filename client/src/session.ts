import * as THREE from 'three';
import {
  DT,
  NO_INPUT,
  attackHoopX,
  cancelSub,
  choosePassTarget,
  createGame,
  decodeState,
  passIcons,
  giveBall,
  requestSub,
  step,
  type ClientMessage,
  type FoulKind,
  type GameEvent,
  type GameSettings,
  type GameState,
  type PlayerInput,
  type ServerMessage,
  type ShotQuality,
  type TeamInfo,
  type Vec3,
} from '@webnba/shared';
import { buildArena, type Arena } from './arena';
import type { Sfx } from './audio';
import { BallView } from './ballView';
import { CAMERA_LABEL, GameCamera, type CameraMode } from './camera';
import { periodLabel, type Hud } from './hud';
import type { Input } from './input';
import { LineupPanel, type SubActions } from './lineup';
import { PlayerView, kitFor } from './playerView';

const QUALITY_TEXT: Record<ShotQuality, [string, string]> = {
  perfect: ['完美出手！', 'perfect'],
  good: ['不錯的出手', 'good'],
  early: ['太早', 'bad'],
  late: ['太晚', 'bad'],
};

const FOUL_TEXT: Record<FoulKind, string> = {
  shooting: '投籃犯規',
  reach: '打手犯規',
  block: '阻擋犯規',
  charge: '進攻犯規（撞人）',
  contact: '防守犯規（非法接觸）',
  defThree: '防守 3 秒（技術犯規）',
};

const VIOLATION_TEXT: Partial<Record<string, string>> = {
  threeSec: '3 秒違例',
  eightSec: '8 秒違例',
  backcourt: '回場違例',
  fiveSec: '5 秒違例',
};

interface Snapshot {
  players: { pos: Vec3; facing: number }[];
  ball: Vec3;
}

/** A match played on a server: the state is authoritative there, predicted here. */
export interface OnlineLink {
  team: 0 | 1;
  state: GameState;
  send(msg: ClientMessage): void;
}

/** Unacknowledged inputs kept for replay (about 1.5 s). */
const MAX_PENDING = 45;

export interface SessionCallbacks {
  onFinal(state: GameState): void;
  onViewChange?(view: CameraMode): void;
}

/** One match (or practice) rendered into its own scene. */
export class Session {
  state: GameState;
  readonly scene = new THREE.Scene();
  readonly cam: GameCamera;
  readonly arena: Arena;
  private readonly playerViews: PlayerView[];
  private readonly ballView: BallView;
  private readonly ring: THREE.Mesh;
  private prev: Snapshot;
  private acc = 0;
  /** The team this screen controls, or -1 when only watching. */
  readonly team: 0 | 1 | -1;
  private readonly online: OnlineLink | null;
  private seq = 0;
  private pending: { seq: number; input: PlayerInput; sent: number }[] = [];
  private remoteInput: PlayerInput = NO_INPUT;
  private serverTick = -1;
  /** Visual error left over from prediction corrections; decays to zero. */
  private readonly offsets: THREE.Vector3[];
  /** Roster index each player model was built for (substitutions rebuild it). */
  private readonly builtFor: number[];
  /** Round trip in ms (input sent until the server applied it and said so). */
  ping = 0;
  private lastInput: PlayerInput | null = null;
  private readonly icons: HTMLElement[];
  private readonly timeoutPanel = document.querySelector<HTMLElement>('#timeoutPanel')!;
  private readonly timeoutLineup = new LineupPanel(document.querySelector<HTMLElement>('#timeoutLineup')!);
  private timeoutShown = false;
  private lineupKey = '';
  /** Substitution requests from the lineup boards: applied here and, online, sent to the server. */
  readonly subActions: SubActions = {
    state: () => this.state,
    request: (team, slotId, rosterIdx) => {
      requestSub(this.state, team, slotId, rosterIdx);
      this.online?.send({ t: 'sub', slotId, rosterIdx });
    },
    cancel: (team, slotId) => {
      cancelSub(this.state, team, slotId);
      this.online?.send({ t: 'cancelSub', slotId });
    },
  };
  /** "Continue" clicked on the timeout screen: sent as a timeout press on the next tick. */
  private resumePress = false;
  paused = false;

  constructor(
    readonly teams: [TeamInfo, TeamInfo],
    settings: Partial<GameSettings>,
    private readonly hud: Hud,
    private readonly input: Input,
    private readonly sfx: Sfx,
    private readonly callbacks: SessionCallbacks,
    aspect: number,
    view: CameraMode = 'broadcast',
    online: OnlineLink | null = null,
  ) {
    const practice = settings.mode === 'practice';
    this.online = online;
    this.state = online ? online.state : createGame({ teams, settings, playersPerTeam: practice ? [1, 0] : [5, 5] });
    this.team = online ? online.team : this.state.settings.humanTeams.includes(0) ? 0 : -1;
    this.offsets = [...this.state.players, null].map(() => new THREE.Vector3());
    this.builtFor = this.state.players.map((p) => p.rosterIdx);
    this.arena = buildArena(this.scene, teams[0]);
    this.cam = new GameCamera(aspect, view);
    this.playerViews = this.state.players.map((p) => {
      const v = new PlayerView(p.info, kitFor(teams[p.team], p.team === 0));
      this.scene.add(v.root);
      return v;
    });
    document.querySelector<HTMLElement>('#timeoutResume')!.onclick = () => {
      this.resumePress = true;
    };
    this.ballView = new BallView(this.scene);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.52, 32),
      new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = this.team >= 0;
    this.scene.add(this.ring);

    if (practice) {
      const p = this.state.players[0];
      p.pos.x = attackHoopX(0) - 6;
      p.pos.z = 2;
      giveBall(this.state, 0);
    }
    this.prev = this.snapshot();
    hud.show(teams, practice);

    const iconRoot = document.querySelector('#passIcons')!;
    iconRoot.replaceChildren();
    this.icons = [1, 2, 3, 4].map((n) => {
      const el = document.createElement('div');
      el.className = 'picon hidden';
      el.innerHTML = `<b>${n}</b><span></span>`;
      // Touch screens pass by tapping the icon.
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.input.tapIcon(n - 1);
      });
      iconRoot.appendChild(el);
      return el;
    });
  }

  private snapshot(): Snapshot {
    return {
      players: this.state.players.map((p) => ({ pos: { ...p.pos }, facing: p.facing })),
      ball: { ...this.state.ball.pos },
    };
  }

  resize(aspect: number): void {
    this.cam.resize(aspect);
  }

  frame(dt: number): void {
    const s = this.state;
    if (this.input.consumePress('KeyH')) this.hud.toggleHelp();
    if (this.input.consumePress('KeyC')) {
      const next: CameraMode = this.cam.mode === 'broadcast' ? 'end' : 'broadcast';
      this.cam.setMode(next);
      this.hud.toast(CAMERA_LABEL[next], '', true);
      this.callbacks.onViewChange?.(next);
    }
    if (s.settings.mode === 'practice' && this.input.consumePress('KeyR')) {
      if (s.players[0].action === 'normal') giveBall(s, 0);
    }

    if (this.online) {
      // Online the match never pauses; Esc only opens the stats screen.
      this.acc += Math.min(0.25, dt);
      while (this.acc >= DT) {
        this.prev = this.snapshot();
        const input = this.humanInput();
        const seq = ++this.seq;
        this.pending.push({ seq, input, sent: performance.now() });
        if (this.pending.length > MAX_PENDING) this.pending.shift();
        this.online.send({ t: 'input', seq, input });
        this.predict(this.state, input);
        this.acc -= DT;
      }
    } else if (!this.paused) {
      this.acc += Math.min(0.25, dt);
      while (this.acc >= DT) {
        this.prev = this.snapshot();
        const inputs = this.team === 0 ? { 0: this.humanInput() } : {};
        step(s, inputs);
        s.events.forEach((e) => this.handleEvent(e));
        this.acc -= DT;
      }
    }
    this.render(this.frozen ? 1 : this.acc / DT, dt);
  }

  /** Stats screen open in a local game stops time; online it does not. */
  get frozen(): boolean {
    return this.paused && !this.online;
  }

  get isOnline(): boolean {
    return !!this.online;
  }

  /** Team whose scores are shown as "ours" in toasts. */
  private get myColor(): 0 | 1 {
    return this.team === 1 ? 1 : 0;
  }

  /** Local guess at the next tick: our input, plus the other human's last known one. */
  private predict(state: GameState, input: PlayerInput): void {
    const team = this.team as 0 | 1;
    step(state, { [team]: input, [1 - team]: this.remoteInput } as Record<0 | 1, PlayerInput>);
  }

  /**
   * Authoritative state from the server: adopt it, replay the inputs it has
   * not applied yet, and keep the visual difference as a decaying offset so
   * corrections slide instead of snapping.
   */
  applySnapshot(msg: Extract<ServerMessage, { t: 'snap' }>): void {
    if (msg.tick <= this.serverTick) return;
    this.serverTick = msg.tick;
    const team = this.team as 0 | 1;
    const acked = this.pending.find((p) => p.seq === msg.ack);
    if (acked) {
      const rtt = performance.now() - acked.sent;
      this.ping = this.ping ? this.ping * 0.8 + rtt * 0.2 : rtt;
    }
    this.pending = this.pending.filter((p) => p.seq > msg.ack);
    this.remoteInput = msg.inputs[(1 - team) as 0 | 1] ?? NO_INPUT;

    const old = this.state;
    const next = decodeState(msg.state, this.teams);
    this.state = next;
    this.prev = this.snapshot();
    this.pending.forEach((p, i) => {
      if (i === this.pending.length - 1) this.prev = this.snapshot();
      this.predict(next, p.input);
    });
    next.events = [];

    const shift = (o: THREE.Vector3, a: Vec3, b: Vec3) => {
      o.x += a.x - b.x;
      o.y += a.y - b.y;
      o.z += a.z - b.z;
      if (o.lengthSq() > 9) o.set(0, 0, 0); // a reset (inbound, free throws): just cut
    };
    next.players.forEach((p, i) => shift(this.offsets[i], old.players[i].pos, p.pos));
    shift(this.offsets[next.players.length], old.ball.pos, next.ball.pos);
    msg.events.forEach((e) => this.handleEvent(e));
  }

  /** Keyboard/pad input plus icon passing: digits 1-4 pass straight to that teammate. */
  private humanInput(): PlayerInput {
    const s = this.state;
    const inp = this.input.sample();
    // Stick directions are relative to the screen; the end view rotates with play.
    const w = this.cam.toWorld(inp.moveX, inp.moveZ);
    inp.moveX = w.x;
    inp.moveZ = w.z;
    if (this.resumePress) {
      inp.timeout = true;
      this.resumePress = false;
    }
    const me = this.team >= 0 ? s.players[s.controlled[this.team as 0 | 1]] : undefined;
    const tapped = this.input.takeIconTap();
    if (me && s.ball.mode === 'held' && s.ball.holderId === me.id) {
      const mates = passIcons(s, me);
      if (mates[tapped]) {
        inp.pass = true;
        inp.passTarget = mates[tapped].id;
      }
      for (let i = 0; i < mates.length; i++) {
        if (this.input.isDown(`Digit${i + 1}`) || this.input.isDown(`Numpad${i + 1}`)) {
          inp.pass = true;
          inp.passTarget = mates[i].id;
          break;
        }
      }
    }
    this.lastInput = inp;
    return inp;
  }

  /** Numbered labels over teammates while you hold the ball; the K-pass receiver is highlighted. */
  private renderPassIcons(): void {
    const s = this.state;
    const me = this.team >= 0 ? s.players[s.controlled[this.team as 0 | 1]] : undefined;
    const holding =
      !!me && s.ball.mode === 'held' && s.ball.holderId === me.id && me.action === 'normal' && s.phase !== 'freeThrow';
    const mates = holding ? passIcons(s, me) : [];
    const aimed = holding && this.lastInput ? choosePassTarget(s, me, this.lastInput) : -1;
    this.icons.forEach((el, i) => {
      const m = mates[i];
      if (!m) {
        el.classList.add('hidden');
        return;
      }
      const v = new THREE.Vector3(m.pos.x, m.pos.y + m.info.heightM + 0.45, m.pos.z).project(this.cam.camera);
      el.classList.remove('hidden');
      el.classList.toggle('aim', m.id === aimed);
      el.style.left = `${((v.x + 1) / 2) * window.innerWidth}px`;
      el.style.top = `${((1 - v.y) / 2) * window.innerHeight}px`;
      const last = m.info.name.split(' ').slice(1).join(' ') || m.info.name;
      el.querySelector('span')!.textContent = last;
    });
  }

  private render(alpha: number, dt: number): void {
    const s = this.state;
    const tmp = new THREE.Vector3();
    const holder = s.ball.mode === 'held' ? s.ball.holderId : -1;
    const offense = holder >= 0 ? s.players[holder].team : s.possession;
    s.players.forEach((p, i) => {
      if (p.rosterIdx !== this.builtFor[i]) {
        this.builtFor[i] = p.rosterIdx;
        this.rebuildView(i);
      }
    });
    const decay = Math.exp(-dt * 10);
    for (const o of this.offsets) o.multiplyScalar(decay);
    // A held ball rides with its holder's correction so it stays in the hand.
    const ballOffset = this.offsets[holder >= 0 ? holder : s.players.length];
    const ballPos = lerpV(this.prev.ball, s.ball.pos, alpha, new THREE.Vector3()).add(ballOffset);
    s.players.forEach((p, i) => {
      const a = this.prev.players[i];
      lerpV(a.pos, p.pos, alpha, tmp).add(this.offsets[i]);
      this.playerViews[i].update(
        p,
        tmp,
        lerpAngle(a.facing, p.facing, alpha),
        {
          hasBall: holder === p.id,
          defending: s.settings.mode === 'game' && p.team !== offense && s.phase === 'live',
          inbounding: s.phase === 'inbound' && s.inbound?.passerId === p.id,
          catching: s.ball.mode === 'pass' && s.ball.pass?.targetId === p.id,
          lookAt: ballPos,
        },
        this.frozen ? 0 : dt,
      );
      if (this.team >= 0 && s.controlled[this.team as 0 | 1] === p.id) {
        this.ring.position.set(tmp.x, 0.02, tmp.z);
        (this.ring.material as THREE.MeshBasicMaterial).color.set(p.intenseD ? 0xff3b3b : 0xff7a1a);
      }
    });
    tmp.copy(ballPos);
    this.ballView.update(tmp, s.ball.vel, this.frozen ? 0 : dt);

    // Follow the ball toward the hoop the offence is attacking.
    this.cam.update(new THREE.Vector3(tmp.x, 0, tmp.z), Math.sign(attackHoopX(s.possession, s.period)), dt);
    this.arena.update(dt);
    this.renderPassIcons();
    this.renderTimeout();

    const me = this.team >= 0 ? s.players[s.controlled[this.team as 0 | 1]] ?? null : null;
    this.hud.update(s, me);
    this.input.touch?.setMode(me && s.settings.mode === 'game' ? (offense === me.team ? 'offense' : 'defense') : me ? 'offense' : 'none');
    if (me && s.settings.mode === 'game' && s.settings.rules.fatigue && s.phase !== 'timeout') {
      const feet = this.ring.position.clone().project(this.cam.camera);
      this.hud.setStamina(me.energy, { x: ((feet.x + 1) / 2) * window.innerWidth, y: ((1 - feet.y) / 2) * window.innerHeight });
    } else {
      this.hud.setStamina(-1, null);
    }
    if (me && me.action === 'shooting') {
      const head = new THREE.Vector3(me.pos.x, me.pos.y + me.info.heightM + 0.2, me.pos.z).project(this.cam.camera);
      this.hud.setMeter(me.shotMeter, {
        x: ((head.x + 1) / 2) * window.innerWidth,
        y: ((1 - head.y) / 2) * window.innerHeight,
      });
    } else {
      this.hud.setMeter(-1, null);
    }
  }

  /** Timeout screen with the substitution board for the human team. */
  private renderTimeout(): void {
    const s = this.state;
    const t = s.phase === 'timeout' ? s.timeout : null;
    const show = !!t && this.team >= 0 && !this.paused;
    // Online the lineup can change under us (server snapshots): redraw when it does.
    const key = show ? JSON.stringify([s.subQueue, s.players.map((p) => p.rosterIdx)]) : '';
    if (show !== this.timeoutShown || key !== this.lineupKey) {
      this.timeoutShown = show;
      this.lineupKey = key;
      this.timeoutPanel.classList.toggle('hidden', !show);
      if (show) this.timeoutLineup.render(s, this.team as 0 | 1, this.subActions);
    }
    if (!t || !show) return;
    const who = this.teams[t.team];
    const left = Math.max(0, Math.ceil(t.limit - t.timer));
    document.querySelector('#timeoutTitle')!.textContent = `暫停　${who.abbr}`;
    document.querySelector('#timeoutSub')!.textContent =
      `${who.name} 喊的暫停 · 剩 ${left} 秒 · 我方剩餘暫停 ${s.timeoutsLeft[this.team as 0 | 1]} 次`;
  }

  /** A substitution swaps who is in the slot: rebuild that player's model. */
  private rebuildView(slotId: number): void {
    const p = this.state.players[slotId];
    const old = this.playerViews[slotId];
    this.scene.remove(old.root);
    disposeTree(old.root);
    const v = new PlayerView(p.info, kitFor(this.teams[p.team], p.team === 0));
    this.scene.add(v.root);
    this.playerViews[slotId] = v;
  }

  private name(id: number): string {
    return this.state.players[id]?.info.name ?? '';
  }

  private handleEvent(e: GameEvent): void {
    const s = this.state;
    const hud = this.hud;
    switch (e.type) {
      case 'dribble':
        this.sfx.dribble(0.4);
        break;
      case 'bounce':
        this.sfx.dribble(Math.min(0.6, e.speed * 0.1));
        break;
      case 'rim':
        this.sfx.rim(Math.min(0.7, e.speed * 0.15));
        break;
      case 'board':
        this.sfx.board(Math.min(0.7, e.speed * 0.12));
        break;
      case 'shot':
        if (this.team >= 0 && e.playerId === s.controlled[this.team as 0 | 1]) {
          const [text, cls] = QUALITY_TEXT[e.quality];
          hud.toast(`${text}　${Math.round(e.chance * 100)}%`, cls, true);
        }
        break;
      case 'score': {
        this.sfx.swish();
        this.arena.swishNet(e.hoopX);
        const who = this.name(e.playerId);
        if (e.kind === 'free') {
          hud.toast(`罰進 +1  ${who}`, e.team === this.myColor ? 'perfect' : 'accent', true);
          break;
        }
        this.playerViews[e.playerId]?.trigger('celebrate');
        this.sfx.cheer();
        this.arena.cheer();
        const label = e.kind === 'dunk' ? '灌籃！' : e.swish ? '空心！' : '';
        hud.toast(`${label}+${e.points}  ${who}`, e.team === this.myColor ? 'perfect' : 'accent');
        if (e.assistId >= 0) hud.toast(`助攻 ${this.name(e.assistId)}`, '', true);
        if (s.pendingFT?.total === 1 && s.pendingFT.shooterId === e.playerId) hud.toast('進算加罰！', 'accent');
        break;
      }
      case 'pass':
        this.playerViews[e.playerId]?.trigger('pass');
        break;
      case 'reach':
        this.playerViews[e.playerId]?.trigger('reach');
        break;
      case 'deadDribble':
        if (this.team >= 0 && e.playerId === s.controlled[this.team as 0 | 1]) hud.toast('已收球：只能傳球或投籃', 'bad', true);
        break;
      case 'steal':
        hud.toast(`抄截！ ${this.name(e.playerId)}`, 'accent', true);
        break;
      case 'block':
        this.sfx.board(0.6);
        hud.toast(`火鍋！ ${this.name(e.playerId)}`, 'accent');
        break;
      case 'turnover': {
        const violation = VIOLATION_TEXT[e.reason];
        if (e.reason === 'oob') {
          this.sfx.whistle();
          hud.toast('出界', 'bad', true);
        } else if (e.reason === 'shotclock') {
          this.sfx.buzzer();
          hud.toast('24 秒違例', 'bad');
        } else if (violation) {
          this.sfx.whistle();
          hud.toast(`${violation}${e.playerId >= 0 ? '　' + this.name(e.playerId) : ''}`, 'bad');
        }
        break;
      }
      case 'foul': {
        this.sfx.whistle();
        const p = s.players[e.playerId];
        const extra = e.kind === 'charge' ? '　球權轉換' : e.shots ? `　罰球 ${e.shots} 次` : '';
        hud.toast(`${FOUL_TEXT[e.kind]}　${this.name(e.playerId)}（${p?.stats.pf ?? 0} 犯）${extra}`, 'bad');
        if (e.bonus && e.kind !== 'shooting' && e.kind !== 'charge') hud.toast('進入加罰', '', true);
        if (e.kind === 'charge') this.playerViews[e.onId]?.trigger('flop');
        else this.playerViews[e.onId]?.trigger('fouled');
        break;
      }
      case 'fouledOut':
        hud.toast(`${e.name} 犯滿離場`, 'bad');
        break;
      case 'freeThrow':
        if (e.index === 0) hud.toast(`${this.name(e.shooterId)} 罰球 ${e.total} 次`, '', true);
        break;
      case 'sub':
        hud.toast(`換人：${e.inName} 上，${e.outName} 下`, '', true);
        break;
      case 'timeout':
        this.sfx.whistle();
        hud.toast(`${this.teams[e.team].abbr} 喊暫停（剩 ${e.left} 次）`, 'accent');
        break;
      case 'buzzer':
        this.sfx.buzzer();
        break;
      case 'periodEnd':
        hud.toast(`${periodLabel(e.period)}結束`, '', false);
        break;
      case 'final':
        hud.toast('比賽結束', 'accent');
        setTimeout(() => this.callbacks.onFinal(s), 2200);
        break;
    }
  }

  dispose(): void {
    disposeTree(this.scene);
    this.hud.hide();
    this.icons.forEach((el) => el.remove());
    this.timeoutPanel.classList.add('hidden');
  }
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Line) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        (m as THREE.MeshStandardMaterial).map?.dispose();
        m.dispose();
      }
    }
  });
}

function lerpV(a: Vec3, b: Vec3, t: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
