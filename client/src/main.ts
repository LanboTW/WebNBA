import * as THREE from 'three';
import {
  ROSTER_SEASON,
  ROSTER_UPDATED,
  CUSTOM_TEAMS,
  NBA_TEAMS,
  decodeState,
  findTeam,
  normaliseRoomCode,
  playerRating,
  teamRating,
  type Difficulty,
  type GameSettings,
  type RoomInfo,
  type RoomSettings,
  type ServerMessage,
  type TeamInfo,
} from '@webnba/shared';
import { Sfx } from './audio';
import { esc, renderBoxScore } from './boxscore';
import { Hud } from './hud';
import type { CameraMode } from './camera';
import { Input } from './input';
import { LineupPanel } from './lineup';
import { NetClient, storedToken, type NetStatus } from './net';
import { Session, type OnlineLink } from './session';
import { TouchControls, isTouchDevice } from './touch';

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

// Touch controls: on phones/tablets from the start, elsewhere after the first touch.
const touch = new TouchControls(document.body);
$('#hud').after(touch.root); // under the menus and score screens
let touchOn = false;
function enableTouch(): void {
  if (touchOn) return;
  touchOn = true;
  input.touch = touch;
  document.body.classList.add('touch');
}
if (isTouchDevice()) enableTouch();
window.addEventListener('touchstart', enableTouch, { passive: true });

let session: Session | null = null;

// ----------------------------------------------------------------- menu

const homeSel = $<HTMLSelectElement>('#homeSel');
const awaySel = $<HTMLSelectElement>('#awaySel');
const modeSel = $<HTMLSelectElement>('#modeSel');
const diffSel = $<HTMLSelectElement>('#diffSel');
const quarterSel = $<HTMLSelectElement>('#quarterSel');
const viewSel = $<HTMLSelectElement>('#viewSel');
const nameInput = $<HTMLInputElement>('#nameInput');
const codeInput = $<HTMLInputElement>('#codeInput');
const lobbyTeam = $<HTMLSelectElement>('#lobbyTeam');
const ruleBoxes = {
  fouls: $<HTMLInputElement>('#ruleFouls'),
  violations: $<HTMLInputElement>('#ruleViolations'),
  fatigue: $<HTMLInputElement>('#ruleFatigue'),
};
const pauseLineup = new LineupPanel($('#boxLineup'));
$('#season').textContent = ROSTER_UPDATED ? `${ROSTER_SEASON}（${ROSTER_UPDATED} 更新）` : ROSTER_SEASON;

// NBA teams alphabetically, then each custom group (historical, Taiwan, ...) in file order.
const teamGroups = new Map<string, TeamInfo[]>([[`NBA ${ROSTER_SEASON}`, [...NBA_TEAMS].sort((a, b) => a.name.localeCompare(b.name))]]);
for (const t of CUSTOM_TEAMS) teamGroups.set(t.group!, [...(teamGroups.get(t.group!) ?? []), t]);
for (const sel of [homeSel, awaySel, lobbyTeam]) {
  for (const [label, teams] of teamGroups) {
    const group = document.createElement('optgroup');
    group.label = label;
    for (const t of teams) group.appendChild(new Option(`${t.name} (${t.abbr})　${teamRating(t)}`, t.abbr));
    sel.appendChild(group);
  }
}
homeSel.value = load('home', 'GSW');
awaySel.value = load('away', 'LAL');
modeSel.value = load('mode', 'game');
diffSel.value = load('diff', 'normal');
quarterSel.value = load('quarter', '180');
viewSel.value = load('view', 'broadcast');
nameInput.value = load('name', '');
for (const [key, box] of Object.entries(ruleBoxes)) box.checked = load(`rule.${key}`, '1') === '1';

// A shared room link (?room=CODE) opens the join form.
const linkCode = normaliseRoomCode(new URLSearchParams(location.search).get('room') ?? '');
if (linkCode) {
  modeSel.value = 'online';
  codeInput.value = linkCode;
}

// Static hosting (GitHub Pages) has no game server unless one is configured.
const onlineAvailable = !import.meta.env.VITE_STATIC || !!import.meta.env.VITE_SERVER_URL;
if (!onlineAvailable) {
  const opt = modeSel.querySelector<HTMLOptionElement>('option[value="online"]')!;
  opt.disabled = true;
  opt.textContent = '線上對戰（這個網址沒有連線伺服器）';
  if (modeSel.value === 'online') modeSel.value = 'game';
}

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
  const row = (p: TeamInfo['players'][number]) =>
    `<div class="prow"><span>${p.position}　${esc(p.name)}</span><b class="ovr">${playerRating(p)}</b></div>`;
  el.innerHTML =
    `<div class="thead"><b>${esc(t.name)}</b><span class="tovr" title="先發五人平均">${teamRating(t)}</span></div>` +
    t.players.slice(0, 5).map(row).join('') +
    `<div class="benchlbl">替補</div>` +
    t.players.slice(5).map(row).join('');
}
function refreshCards(): void {
  const mode = modeSel.value;
  const practice = mode === 'practice';
  const online = mode === 'online';
  renderCard($('#homeCard'), findTeam(homeSel.value));
  renderCard($('#awayCard'), findTeam(awaySel.value));
  for (const box of Object.values(ruleBoxes)) box.disabled = practice;
  awaySel.disabled = practice;
  $('#awayLabel').classList.toggle('hidden', online);
  $('#awayCard').style.opacity = practice ? '0.35' : '1';
  $('#awayCard').classList.toggle('hidden', online);
  $('.matchup .vs').classList.toggle('hidden', online);
  $('#onlineBox').classList.toggle('hidden', !online);
  $('#joinBtn').classList.toggle('hidden', !online);
  $('#startBtn').textContent = online ? '建立房間' : practice ? '開始練習' : mode === 'watch' ? '開始觀戰' : '開始比賽';
  showMenuMsg('');
}
[homeSel, awaySel, modeSel].forEach((s) => s.addEventListener('change', refreshCards));
refreshCards();

function showMenuMsg(text: string): void {
  $('#onlineMsg').textContent = text;
  $('#onlineMsg').classList.toggle('hidden', !text);
}

function saveMenu(): void {
  save('home', homeSel.value);
  save('away', awaySel.value);
  save('mode', modeSel.value);
  save('diff', diffSel.value);
  save('quarter', quarterSel.value);
  save('view', viewSel.value);
  save('name', nameInput.value.trim());
  for (const [key, box] of Object.entries(ruleBoxes)) save(`rule.${key}`, box.checked ? '1' : '0');
}

function menuRules(): GameSettings['rules'] {
  return {
    fouls: ruleBoxes.fouls.checked,
    violations: ruleBoxes.violations.checked,
    fatigue: ruleBoxes.fatigue.checked,
  };
}

$('#startBtn').addEventListener('click', () => {
  sfx.unlock();
  saveMenu();
  const mode = modeSel.value;
  if (mode === 'online') {
    createRoom();
    return;
  }
  const settings: Partial<GameSettings> = {
    mode: mode === 'practice' ? 'practice' : 'game',
    humanTeams: mode === 'watch' ? [] : [0],
    difficulty: diffSel.value as Difficulty,
    quarterSeconds: Number(quarterSel.value),
    seed: (Math.random() * 2 ** 31) | 0,
    rules: menuRules(),
  };
  startSession([findTeam(homeSel.value), findTeam(awaySel.value)], settings);
});

$('#joinBtn').addEventListener('click', () => {
  sfx.unlock();
  saveMenu();
  const code = normaliseRoomCode(codeInput.value);
  if (code.length !== 6) {
    showMenuMsg('請輸入 6 碼房間代碼');
    return;
  }
  connectNet().join(code, playerName(), homeSel.value);
  showMenuMsg('連線中…');
});

function startSession(teams: [TeamInfo, TeamInfo], settings: Partial<GameSettings>, online?: OnlineLink): void {
  session?.dispose();
  session = makeSession(teams, settings, online);
  // Dev-only hook for inspecting the sim from the browser console.
  if (import.meta.env.DEV) (window as unknown as { __session: Session }).__session = session;
  $('#menu').classList.add('hidden');
  $('#lobby').classList.add('hidden');
  $('#boxscore').classList.add('hidden');
  (document.activeElement as HTMLElement | null)?.blur();
  input.clearPresses();
  if (touchOn && !document.fullscreenElement) {
    // Full screen and landscape when the browser allows it (needs a tap; ignored otherwise).
    document.documentElement
      .requestFullscreen?.()
      .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
      .catch(() => {});
  }
}

function makeSession(teams: [TeamInfo, TeamInfo], settings: Partial<GameSettings>, online?: OnlineLink): Session {
  const onViewChange = (view: CameraMode) => {
    viewSel.value = view;
    save('view', view);
  };
  return new Session(
    teams,
    settings,
    hud,
    input,
    sfx,
    { onFinal: showFinal, onViewChange },
    window.innerWidth / window.innerHeight,
    viewSel.value as CameraMode,
    online,
  );
}

function backToMenu(): void {
  leaveRoom();
  session?.dispose();
  session = null;
  $('#boxscore').classList.add('hidden');
  $('#lobby').classList.add('hidden');
  $('#netinfo').classList.add('hidden');
  $('#menu').classList.remove('hidden');
}

// --------------------------------------------------------------- online

let net: NetClient | null = null;
let room: RoomInfo | null = null;
let mySeat: 0 | 1 = 0;
let netStatus: NetStatus = 'closed';

const playerName = () => nameInput.value.trim() || '玩家';

function connectNet(): NetClient {
  net?.leave();
  const client: NetClient = new NetClient({
    onMessage: (msg) => {
      if (net === client) onServer(msg);
    },
    onStatus: (status) => {
      if (net !== client) return;
      netStatus = status;
      if (status === 'closed') onConnectionLost();
      if (status === 'waking' && !session) {
        const text = '連線伺服器啟動中（免費主機閒置時會休眠，約需 30–60 秒）…';
        if ($('#lobby').classList.contains('hidden')) showMenuMsg(text);
        else $('#lobbyStatus').textContent = text;
      }
      updateNetInfo();
    },
  });
  net = client;
  return client;
}

function leaveRoom(): void {
  net?.leave();
  net = null;
  room = null;
  history.replaceState(null, '', location.pathname);
}

function createRoom(): void {
  const settings: RoomSettings = {
    quarterSeconds: Number(quarterSel.value),
    difficulty: diffSel.value as Difficulty,
    rules: menuRules(),
  };
  connectNet().create(playerName(), homeSel.value, settings);
  showMenuMsg('建立房間中…');
}

function onServer(msg: ServerMessage): void {
  switch (msg.t) {
    case 'joined':
      mySeat = msg.seat;
      room = msg.room;
      history.replaceState(null, '', `${location.pathname}?room=${msg.code}`);
      if (!msg.room.started) showLobby();
      break;
    case 'room':
      room = msg.room;
      if (!room.started) showLobby();
      updateNetInfo();
      break;
    case 'start': {
      room = msg.room;
      mySeat = msg.seat;
      const teams: [TeamInfo, TeamInfo] = [findTeam(msg.teams[0]), findTeam(msg.teams[1])];
      const link = net!;
      startSession(teams, {}, {
        team: msg.seat,
        state: decodeState(msg.state, teams),
        send: (m) => link.send(m),
      });
      updateNetInfo();
      break;
    }
    case 'snap':
      if (session?.isOnline) session.applySnapshot(msg);
      break;
    case 'error':
      if (session?.isOnline) hud.toast(msg.msg, 'bad');
      else if (!$('#lobby').classList.contains('hidden')) $('#lobbyStatus').textContent = msg.msg;
      else {
        showMenuMsg(msg.msg);
        // Could not get into a room: drop the socket so the next try starts clean.
        if (!room) leaveRoom();
      }
      break;
    case 'closed':
      endOnline(msg.msg);
      break;
  }
}

function onConnectionLost(): void {
  if (!room && !session) {
    showMenuMsg('連不到伺服器（npm run server 有開嗎？）');
    net = null;
    return;
  }
  endOnline('和伺服器的連線中斷了');
}

/** The room is gone (closed, or we could not get back in): show where things stood. */
function endOnline(text: string): void {
  net = null;
  room = null;
  history.replaceState(null, '', location.pathname);
  if (session?.isOnline && session.state.phase !== 'final') {
    session.paused = true;
    const [a, b] = session.state.score;
    showBox(`${text}　${session.teams[0].abbr} ${a} : ${b} ${session.teams[1].abbr}`, false);
  } else if (!session) {
    $('#lobby').classList.add('hidden');
    $('#menu').classList.remove('hidden');
    showMenuMsg(text);
  }
  updateNetInfo();
}

const DIFF_TEXT: Record<Difficulty, string> = { easy: '簡單', normal: '普通', hard: '困難' };

function showLobby(): void {
  if (!room) return;
  $('#menu').classList.add('hidden');
  $('#lobby').classList.remove('hidden');
  $('#lobbyCode').textContent = room.code;
  room.seats.forEach((seat, i) => {
    const role = i === 0 ? '主隊・房主' : '客隊';
    const you = i === mySeat ? '（你）' : '';
    const state = !seat.taken ? '<span class="off">等待加入…</span>' : seat.connected ? '' : `<span class="off">斷線，${seat.rejoinLeft} 秒內可回來</span>`;
    $(`#seatName${i}`).innerHTML = `${role}　<b>${seat.taken ? esc(seat.name) : '—'}</b>${you} ${state}`;
    const card = $(`#seatCard${i}`);
    renderCard(card, findTeam(seat.abbr));
    card.style.opacity = seat.taken ? '1' : '0.35';
  });
  lobbyTeam.value = room.seats[mySeat].abbr;
  const s = room.settings;
  const rules = [s.rules.fouls && '犯規', s.rules.violations && '違例', s.rules.fatigue && '體力'].filter(Boolean).join('／') || '全關';
  $('#lobbySettings').textContent = `每節 ${s.quarterSeconds / 60} 分鐘 · 電腦隊友難度 ${DIFF_TEXT[s.difficulty]} · 規則：${rules}`;
  const ready = room.seats[1].connected && room.seats[0].connected;
  const start = $<HTMLButtonElement>('#lobbyStart');
  start.classList.toggle('hidden', mySeat !== 0);
  start.disabled = !ready;
  $('#lobbyStatus').textContent = mySeat === 0 ? (ready ? '對手到齊，可以開始了' : '等待對手加入…') : '等待房主開始比賽…';
}

lobbyTeam.addEventListener('change', () => net?.send({ t: 'pickTeam', abbr: lobbyTeam.value }));
$('#lobbyStart').addEventListener('click', () => {
  sfx.unlock();
  net?.send({ t: 'start' });
});
$('#lobbyLeave').addEventListener('click', backToMenu);
$('#copyLink').addEventListener('click', async () => {
  if (!room) return;
  const url = `${location.origin}${location.pathname}?room=${room.code}`;
  try {
    await navigator.clipboard.writeText(url);
    $('#lobbyStatus').textContent = '已複製連結';
  } catch {
    $('#lobbyStatus').textContent = url;
  }
});

/** Top-right line in online games: ping, and what happened to the other player. */
function updateNetInfo(): void {
  const el = $('#netinfo');
  if (!session?.isOnline) {
    el.classList.add('hidden');
    return;
  }
  const parts: string[] = [];
  if (netStatus === 'waking') parts.push('<span class="warn">伺服器啟動中…</span>');
  else if (netStatus === 'reconnecting') parts.push('<span class="warn">連線中斷，重新連線中…</span>');
  else if (net) parts.push(`${room?.code ?? ''}　延遲 ${Math.round(session.ping)} ms`);
  const other = room?.seats[(1 - mySeat) as 0 | 1];
  if (other && !other.taken) parts.push('<span class="warn">對手已離開，由電腦接手</span>');
  else if (other && !other.connected) parts.push(`<span class="warn">對手斷線，電腦代打中（${other.rejoinLeft} 秒內可回來）</span>`);
  el.innerHTML = parts.join('<br>');
  el.classList.toggle('hidden', !parts.length);
}
setInterval(updateNetInfo, 500);

// Opened from a room link.
if (linkCode && !onlineAvailable) {
  showMenuMsg('這個網址沒有連線伺服器，目前只能和電腦對戰');
} else if (linkCode && storedToken(linkCode)) {
  // This tab already had a seat there (page reloaded): go straight back in.
  connectNet().join(linkCode, playerName(), homeSel.value);
  showMenuMsg('重新加入房間中…');
} else if (linkCode) {
  showMenuMsg(`選好隊伍後按「加入房間」加入 ${linkCode}`);
}

// ------------------------------------------------------------ box score

function showBox(title: string, canResume: boolean): void {
  if (!session) return;
  $('#boxTitle').textContent = title;
  $('#boxTables').innerHTML = renderBoxScore(session.state, session.teams);
  const s = session.state;
  const team = session.team;
  const subs = canResume && s.settings.mode === 'game' && team >= 0;
  $('#boxLineup').classList.toggle('hidden', !subs);
  if (subs) pauseLineup.render(s, team as 0 | 1, session.subActions);
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
  if (!session || session.state.phase === 'final' || (session.isOnline && !net)) return;
  session.paused = !session.paused;
  // Online the game keeps running behind the stats screen.
  if (session.paused) showBox(session.isOnline ? '數據（比賽進行中）' : '暫停', true);
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
  const overlay = !$('#boxscore').classList.contains('hidden') || !$('#timeoutPanel').classList.contains('hidden');
  touch.show(touchOn && !!session && !overlay);
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
