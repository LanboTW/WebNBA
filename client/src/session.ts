import * as THREE from 'three';
import {
  DT,
  attackHoopX,
  createGame,
  giveBall,
  step,
  type GameEvent,
  type GameSettings,
  type GameState,
  type ShotQuality,
  type TeamInfo,
  type Vec3,
} from '@webnba/shared';
import { buildArena, type Arena } from './arena';
import type { Sfx } from './audio';
import { BallView } from './ballView';
import { BroadcastCamera } from './camera';
import { periodLabel, type Hud } from './hud';
import type { Input } from './input';
import { PlayerView, kitFor } from './playerView';

const QUALITY_TEXT: Record<ShotQuality, [string, string]> = {
  perfect: ['完美出手！', 'perfect'],
  good: ['不錯的出手', 'good'],
  early: ['太早', 'bad'],
  late: ['太晚', 'bad'],
};

interface Snapshot {
  players: { pos: Vec3; facing: number }[];
  ball: Vec3;
}

export interface SessionCallbacks {
  onFinal(state: GameState): void;
}

/** One match (or practice) rendered into its own scene. */
export class Session {
  readonly state: GameState;
  readonly scene = new THREE.Scene();
  readonly cam: BroadcastCamera;
  private readonly arena: Arena;
  private readonly playerViews: PlayerView[];
  private readonly ballView: BallView;
  private readonly ring: THREE.Mesh;
  private prev: Snapshot;
  private acc = 0;
  private readonly human: 0 | -1;
  paused = false;

  constructor(
    readonly teams: [TeamInfo, TeamInfo],
    settings: Partial<GameSettings>,
    private readonly hud: Hud,
    private readonly input: Input,
    private readonly sfx: Sfx,
    private readonly callbacks: SessionCallbacks,
    aspect: number,
  ) {
    const practice = settings.mode === 'practice';
    this.state = createGame({ teams, settings, playersPerTeam: practice ? [1, 0] : [5, 5] });
    this.human = this.state.settings.humanTeams.includes(0) ? 0 : -1;
    this.arena = buildArena(this.scene, teams[0]);
    this.cam = new BroadcastCamera(aspect);
    this.playerViews = this.state.players.map((p) => {
      const v = new PlayerView(p.info, kitFor(teams[p.team], p.team === 0));
      this.scene.add(v.root);
      return v;
    });
    this.ballView = new BallView(this.scene);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.52, 32),
      new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = this.human === 0;
    this.scene.add(this.ring);

    if (practice) {
      const p = this.state.players[0];
      p.pos.x = attackHoopX(0) - 6;
      p.pos.z = 2;
      giveBall(this.state, 0);
    }
    this.prev = this.snapshot();
    hud.show(teams, practice);
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
    if (s.settings.mode === 'practice' && this.input.consumePress('KeyR')) {
      if (s.players[0].action === 'normal') giveBall(s, 0);
    }

    if (!this.paused) {
      this.acc += Math.min(0.25, dt);
      while (this.acc >= DT) {
        this.prev = this.snapshot();
        const inputs = this.human === 0 ? { 0: this.input.sample() } : {};
        step(s, inputs);
        s.events.forEach((e) => this.handleEvent(e));
        this.acc -= DT;
      }
    }
    this.render(this.paused ? 1 : this.acc / DT, dt);
  }

  private render(alpha: number, dt: number): void {
    const s = this.state;
    const tmp = new THREE.Vector3();
    const holder = s.ball.mode === 'held' ? s.ball.holderId : -1;
    const offense = holder >= 0 ? s.players[holder].team : s.possession;
    s.players.forEach((p, i) => {
      const a = this.prev.players[i];
      lerpV(a.pos, p.pos, alpha, tmp);
      const defending = s.settings.mode === 'game' && p.team !== offense && s.phase === 'live';
      this.playerViews[i].update(p, tmp, lerpAngle(a.facing, p.facing, alpha), holder === p.id, defending, this.paused ? 0 : dt);
      if (this.human === 0 && s.controlled[0] === p.id) this.ring.position.set(tmp.x, 0.02, tmp.z);
    });
    lerpV(this.prev.ball, s.ball.pos, alpha, tmp);
    this.ballView.update(tmp, s.ball.vel, this.paused ? 0 : dt);

    // Follow the ball, leaning toward the hoop the offence is attacking.
    const hx = attackHoopX(s.possession, s.period);
    const focus = new THREE.Vector3(tmp.x * 0.75 + hx * 0.25, 0, tmp.z);
    this.cam.update(focus, dt);
    this.arena.update(dt);

    const me = this.human === 0 ? s.players[s.controlled[0]] ?? null : null;
    this.hud.update(s, me);
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
        if (this.human === 0 && e.playerId === s.controlled[0]) {
          const [text, cls] = QUALITY_TEXT[e.quality];
          hud.toast(`${text}　${Math.round(e.chance * 100)}%`, cls, true);
        }
        break;
      case 'score': {
        this.sfx.swish();
        this.sfx.cheer();
        this.arena.swishNet(e.hoopX);
        this.arena.cheer();
        const who = this.name(e.playerId);
        hud.toast(`${e.swish ? '空心！' : ''}+${e.points}  ${who}`, e.team === 0 ? 'perfect' : 'accent');
        if (e.assistId >= 0) hud.toast(`助攻 ${this.name(e.assistId)}`, '', true);
        break;
      }
      case 'steal':
        hud.toast(`抄截！ ${this.name(e.playerId)}`, 'accent', true);
        break;
      case 'block':
        this.sfx.board(0.6);
        hud.toast(`火鍋！ ${this.name(e.playerId)}`, 'accent');
        break;
      case 'turnover':
        if (e.reason === 'oob') {
          this.sfx.whistle();
          hud.toast('出界', 'bad', true);
        } else if (e.reason === 'shotclock') {
          this.sfx.buzzer();
          hud.toast('24 秒違例', 'bad');
        }
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
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Line) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          (m as THREE.MeshStandardMaterial).map?.dispose();
          m.dispose();
        }
      }
    });
    this.hud.hide();
  }
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
