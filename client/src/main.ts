import * as THREE from 'three';
import {
  DT,
  HOOP_X,
  SAMPLE_TEAMS,
  createGame,
  giveBall,
  step,
  type GameEvent,
  type GameState,
  type ShotQuality,
  type Vec3,
} from '@webnba/shared';
import { buildArena } from './arena';
import { Sfx } from './audio';
import { BallView } from './ballView';
import { BroadcastCamera } from './camera';
import { Hud } from './hud';
import { Input } from './input';
import { PlayerView } from './playerView';

const home = SAMPLE_TEAMS[0];
const CONTROLLED = 0;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.querySelector('#app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const arena = buildArena(scene, home);
const cam = new BroadcastCamera(window.innerWidth / window.innerHeight);
const hud = new Hud(home);
const input = new Input(window);
const sfx = new Sfx();
window.addEventListener('keydown', () => sfx.unlock());
window.addEventListener('pointerdown', () => sfx.unlock());

const state: GameState = createGame({
  players: [{ info: home.players[0], team: 0, pos: { x: 4, z: 2 } }],
  ballHolder: 0,
});
const playerViews = state.players.map((p) => {
  const v = new PlayerView(p.info, home);
  scene.add(v.root);
  return v;
});
const ballView = new BallView(scene);

// Previous-tick snapshot for render interpolation.
let prev = snapshot(state);
function snapshot(s: GameState) {
  return {
    players: s.players.map((p) => ({ pos: { ...p.pos }, facing: p.facing })),
    ball: { ...s.ball.pos },
  };
}

const lerpV = (a: Vec3, b: Vec3, t: number, out: THREE.Vector3) =>
  out.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const QUALITY_TEXT: Record<ShotQuality, [string, string]> = {
  perfect: ['完美出手！', 'perfect'],
  good: ['不錯的出手', 'good'],
  early: ['太早', 'bad'],
  late: ['太晚', 'bad'],
};

function handleEvent(e: GameEvent): void {
  switch (e.type) {
    case 'dribble':
      sfx.dribble(0.45);
      break;
    case 'bounce':
      sfx.dribble(Math.min(0.6, e.speed * 0.1));
      break;
    case 'rim':
      sfx.rim(Math.min(0.7, e.speed * 0.15));
      break;
    case 'board':
      sfx.board(Math.min(0.7, e.speed * 0.12));
      break;
    case 'shot': {
      const [text, cls] = QUALITY_TEXT[e.quality];
      hud.toast(`${text}　${Math.round(e.chance * 100)}%`, cls, true);
      break;
    }
    case 'score':
      sfx.swish();
      sfx.cheer();
      arena.swishNet(e.hoopX);
      arena.cheer();
      hud.toast(e.swish ? `空心！ +${e.points}` : `+${e.points}`, 'perfect');
      break;
    case 'pickup':
      if (e.rebound) hud.toast('籃板', '', true);
      break;
  }
}

function resetBall(): void {
  const p = state.players[CONTROLLED];
  if (p.action !== 'normal') return;
  giveBall(state, CONTROLLED);
  prev = snapshot(state);
}

const tmp = new THREE.Vector3();
const focus = new THREE.Vector3();
let acc = 0;
let last = performance.now();

function frame(now: number): void {
  acc += Math.min(0.25, (now - last) / 1000);
  const frameDt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (input.consumePress('KeyR')) resetBall();
  if (input.consumePress('KeyH')) hud.toggleHelp();

  while (acc >= DT) {
    prev = snapshot(state);
    step(state, { [CONTROLLED]: input.sample() });
    state.events.forEach(handleEvent);
    acc -= DT;
  }
  const alpha = acc / DT;

  state.players.forEach((p, i) => {
    const a = prev.players[i];
    lerpV(a.pos, p.pos, alpha, tmp);
    const hasBall = state.ball.mode === 'held' && state.ball.holderId === p.id;
    playerViews[i].update(p, tmp, lerpAngle(a.facing, p.facing, alpha), hasBall, frameDt);
  });
  lerpV(prev.ball, state.ball.pos, alpha, tmp);
  ballView.update(tmp, state.ball.vel, frameDt);

  // Follow the ball, but lean toward the hoop being attacked.
  focus.set(tmp.x * 0.75 + HOOP_X * 0.25, 0, tmp.z);
  cam.update(focus, frameDt);
  arena.update(frameDt);

  const me = state.players[CONTROLLED];
  hud.setScore(state.score[0]);
  hud.setStats(me);
  if (me.action === 'shooting') {
    const head = new THREE.Vector3(me.pos.x, me.pos.y + me.info.heightM + 0.2, me.pos.z).project(cam.camera);
    hud.setMeter(me.shotMeter, {
      x: ((head.x + 1) / 2) * window.innerWidth,
      y: ((1 - head.y) / 2) * window.innerHeight,
    });
  } else {
    hud.setMeter(-1, null);
  }

  renderer.render(scene, cam.camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  cam.resize(window.innerWidth / window.innerHeight);
});

requestAnimationFrame(frame);
