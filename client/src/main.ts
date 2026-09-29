import * as THREE from 'three';
import { ROSTER_SEASON, TEAMS, findTeam, type Difficulty, type GameSettings, type TeamInfo } from '@webnba/shared';
import { Sfx } from './audio';
import { renderBoxScore } from './boxscore';
import { Hud } from './hud';
import { Input } from './input';
import { Session } from './session';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
$('#app').appendChild(renderer.domElement);

const hud = new Hud();
const input = new Input(window);
const sfx = new Sfx();
window.addEventListener('keydown', () => sfx.unlock());
window.addEventListener('pointerdown', () => sfx.unlock());

let session: Session | null = null;

// ----------------------------------------------------------------- menu

const homeSel = $<HTMLSelectElement>('#homeSel');
const awaySel = $<HTMLSelectElement>('#awaySel');
const modeSel = $<HTMLSelectElement>('#modeSel');
const diffSel = $<HTMLSelectElement>('#diffSel');
const quarterSel = $<HTMLSelectElement>('#quarterSel');
$('#season').textContent = ROSTER_SEASON;

for (const sel of [homeSel, awaySel]) {
  for (const t of [...TEAMS].sort((a, b) => a.name.localeCompare(b.name))) {
    sel.add(new Option(`${t.name} (${t.abbr})`, t.abbr));
  }
}
homeSel.value = load('home', 'GSW');
awaySel.value = load('away', 'LAL');
modeSel.value = load('mode', 'game');
diffSel.value = load('diff', 'normal');
quarterSel.value = load('quarter', '180');

function load(key: string, fallback: string): string {
  try {
    return localStorage.getItem(`webnba.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: string): void {
  try {
    localStorage.setItem(`webnba.${key}`, value);
  } catch {
    // Storage unavailable (private mode); preferences just won't persist.
  }
}

function renderCard(el: HTMLElement, t: TeamInfo): void {
  el.style.setProperty('--team', t.primary === '#000000' ? t.secondary : t.primary);
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  el.innerHTML =
    `<b>${esc(t.name)}</b><br>` +
    t.players
      .slice(0, 5)
      .map((p) => `${p.position}　${esc(p.name)}`)
      .join('<br>');
}
function refreshCards(): void {
  renderCard($('#homeCard'), findTeam(homeSel.value));
  renderCard($('#awayCard'), findTeam(awaySel.value));
  const practice = modeSel.value === 'practice';
  awaySel.disabled = practice;
  $('#awayCard').style.opacity = practice ? '0.35' : '1';
  $('#startBtn').textContent = practice ? '開始練習' : modeSel.value === 'watch' ? '開始觀戰' : '開始比賽';
}
[homeSel, awaySel, modeSel].forEach((s) => s.addEventListener('change', refreshCards));
refreshCards();

$('#startBtn').addEventListener('click', () => {
  sfx.unlock();
  save('home', homeSel.value);
  save('away', awaySel.value);
  save('mode', modeSel.value);
  save('diff', diffSel.value);
  save('quarter', quarterSel.value);
  const mode = modeSel.value;
  const settings: Partial<GameSettings> = {
    mode: mode === 'practice' ? 'practice' : 'game',
    humanTeams: mode === 'watch' ? [] : [0],
    difficulty: diffSel.value as Difficulty,
    quarterSeconds: Number(quarterSel.value),
    seed: (Math.random() * 2 ** 31) | 0,
  };
  startSession([findTeam(homeSel.value), findTeam(awaySel.value)], settings);
});

function startSession(teams: [TeamInfo, TeamInfo], settings: Partial<GameSettings>): void {
  session?.dispose();
  session = new Session(teams, settings, hud, input, sfx, { onFinal: showFinal }, window.innerWidth / window.innerHeight);
  // Dev-only hook for inspecting the sim from the browser console.
  if (import.meta.env.DEV) (window as unknown as { __session: Session }).__session = session;
  $('#menu').classList.add('hidden');
  $('#boxscore').classList.add('hidden');
  input.clearPresses();
}

function backToMenu(): void {
  session?.dispose();
  session = null;
  $('#boxscore').classList.add('hidden');
  $('#menu').classList.remove('hidden');
}

// ------------------------------------------------------------ box score

function showBox(title: string, canResume: boolean): void {
  if (!session) return;
  $('#boxTitle').textContent = title;
  $('#boxTables').innerHTML = renderBoxScore(session.state, session.teams);
  $('#resumeBtn').classList.toggle('hidden', !canResume);
  $('#boxscore').classList.remove('hidden');
}

function showFinal(): void {
  if (!session) return;
  session.paused = true;
  const [a, b] = session.state.score;
  const [ta, tb] = session.teams;
  showBox(`終場　${ta.abbr} ${a} : ${b} ${tb.abbr}`, false);
}

function togglePause(): void {
  if (!session || session.state.phase === 'final') return;
  session.paused = !session.paused;
  if (session.paused) showBox('暫停', true);
  else $('#boxscore').classList.add('hidden');
}

$('#resumeBtn').addEventListener('click', togglePause);
$('#quitBtn').addEventListener('click', backToMenu);

// ----------------------------------------------------------------- loop

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (input.consumePress('Escape')) togglePause();
  if (session) {
    session.frame(dt);
    renderer.render(session.scene, session.cam.camera);
  } else {
    renderer.clear();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  session?.resize(window.innerWidth / window.innerHeight);
});
