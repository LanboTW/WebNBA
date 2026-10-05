import {
  ROSTER_SEASON,
  ROSTER_UPDATED,
  ageInSeason,
  CUSTOM_TEAMS,
  NBA_TEAMS,
  POSITIONS,
  careerPlayTeam,
  findTeam,
  playOut,
  playerRating,
  teamRating,
  type Difficulty,
  DIFFICULTY_COINS,
  CUSTOM_LIMITS,
  MY_GROUP,
  customCohesion,
  customTeamInfo,
  keepRetired,
  type GameSettings,
  type GameState,
  type PlayerInfo,
  type TeamInfo,
} from '@webnba/shared';
import { Sfx } from './audio';
import { esc, renderBoxScore } from './boxscore';
import { Graphics, type QualitySetting } from './graphics';
import { Hud } from './hud';
import { logoHtml, setOfficialLogos } from './logos';
import type { CameraMode } from './camera';
import { Input } from './input';
import { LineupPanel } from './lineup';
import { PlayerDb } from './playerDb';
import { coinsText, wallet } from './wallet';
import { initMyTeam, renderMyTeam } from './myteamUi';
import { initCustom, renderCustom } from './customUi';
import { custom } from './myteamStore';
import { initCareerMenu, renderCareer, savedCareers } from './careerMenu';
import { Session } from './session';
import { Showcase } from './showcase';
import { openBugReport, type BugContext } from './bugReport';
import { TeamPicker } from './teamPicker';
import { TouchControls, isTouchDevice } from './touch';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const graphics = new Graphics($('#app'), isTouchDevice());

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

// ----------------------------------------------------------------- screens

type Screen = 'home' | 'quick' | 'practice' | 'players' | 'settings' | 'career' | 'account' | 'create' | 'hub' | 'myteam' | 'custom';
const SCREENS: Screen[] = ['home', 'quick', 'practice', 'players', 'settings', 'career', 'account', 'create', 'hub', 'myteam', 'custom'];
/** Screens with your career player on the court behind them. */
const CAREER_SCREENS: Screen[] = ['create', 'hub'];
/** Screens with a player on the court behind them; the rest are menus that need the room. */
/**
 * Phones skip the player on the court behind the menus: on a small screen the
 * menus need all the room (and the battery is better spent on games).
 */
const PHONE = isTouchDevice() && Math.min(screen.width, screen.height) < 600;
const SHOWCASE_SCREENS: Screen[] = PHONE ? [] : ['home', 'career', ...CAREER_SCREENS];
let current: Screen = 'home';
/** The first background player waits for the saves (see the end of this file). */
let booted = false;
/** The latest reload of the career players (see refreshCareerTeams). */
let careerLoad: Promise<void> = Promise.resolve();

function show(next: Screen): void {
  current = next;
  for (const s of SCREENS) $(`#${s}`).classList.toggle('hidden', s !== next || !!session);
  if (next === 'quick') refreshCards();
  if (next === 'practice') renderPractice();
  if (next === 'players') renderPlayerDb();
  if (next === 'myteam') renderMyTeam();
  if (next === 'custom') renderCustom();
  if (next === 'home' || next === 'quick' || next === 'practice' || next === 'custom') careerLoad = refreshCareerTeams();
  if (next === 'career') void renderCareer();
  document.body.classList.toggle('menu-solid', !session && !SHOWCASE_SCREENS.includes(next));
  if (!session) {
    if (!SHOWCASE_SCREENS.includes(next)) stopShowcase();
    // Leaving the career screens (or coming back from a menu): the rotating stars.
    else if (booted && (!showcase || (showcase.hold && !CAREER_SCREENS.includes(next)))) startShowcase();
  }
}

document.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go as Screen)));
document.querySelectorAll<HTMLElement>('.screen .back:not([data-to])').forEach((b) => b.addEventListener('click', () => show('home')));

wallet.watch((n) => ($('#coinStatus').textContent = `🪙 ${coinsText(n)}`));

$('#season').textContent = ROSTER_UPDATED ? `${ROSTER_SEASON}（${ROSTER_UPDATED} 更新）` : ROSTER_SEASON;

// ----------------------------------------------------------------- settings

const viewSel = $<HTMLSelectElement>('#viewSel');
const qualitySel = $<HTMLSelectElement>('#qualitySel');
const logoBox = $<HTMLInputElement>('#officialLogos');
const ruleBoxes = {
  fouls: $<HTMLInputElement>('#ruleFouls'),
  violations: $<HTMLInputElement>('#ruleViolations'),
  fatigue: $<HTMLInputElement>('#ruleFatigue'),
};

viewSel.value = load('view', 'broadcast');
viewSel.addEventListener('change', () => save('view', viewSel.value));
qualitySel.value = load('quality', 'auto');
graphics.setSetting(qualitySel.value as QualitySetting);
qualitySel.addEventListener('change', () => {
  save('quality', qualitySel.value);
  graphics.setSetting(qualitySel.value as QualitySetting);
});
logoBox.checked = load('officialLogos', '1') === '1';
setOfficialLogos(logoBox.checked);
logoBox.addEventListener('change', () => {
  save('officialLogos', logoBox.checked ? '1' : '0');
  setOfficialLogos(logoBox.checked);
  menuPicker.render();
  practicePicker.render();
  if (current === 'players') renderPlayerDb();
  showTag();
});
for (const [key, box] of Object.entries(ruleBoxes)) {
  box.checked = load(`rule.${key}`, '1') === '1';
  box.addEventListener('change', () => save(`rule.${key}`, box.checked ? '1' : '0'));
}

function menuRules(): GameSettings['rules'] {
  return {
    fouls: ruleBoxes.fouls.checked,
    violations: ruleBoxes.violations.checked,
    fatigue: ruleBoxes.fatigue.checked,
  };
}

// ----------------------------------------------------------------- team lists

// NBA teams by conference, then each custom group (historical, Taiwan, ...) in file order.
const byName = (a: TeamInfo, b: TeamInfo) => a.name.localeCompare(b.name);
const teamGroups = new Map<string, TeamInfo[]>([
  ['NBA東', NBA_TEAMS.filter((t) => t.conference === 'East').sort(byName)],
  ['NBA西', NBA_TEAMS.filter((t) => t.conference === 'West').sort(byName)],
]);
for (const t of CUSTOM_TEAMS) teamGroups.set(t.group!, [...(teamGroups.get(t.group!) ?? []), t]);
const ALL_TEAMS = [...teamGroups.values()].flat();

function fillTeamSelect(sel: HTMLSelectElement): void {
  for (const [label, teams] of teamGroups) {
    if (label === CAREER_GROUP) continue;
    const group = document.createElement('optgroup');
    group.label = label;
    for (const t of teams) group.appendChild(new Option(`${t.name} (${t.abbr})　${teamRating(t)}`, t.abbr));
    sel.appendChild(group);
  }
}

// ----------------------------------------------------------------- my teams

/**
 * 我的球隊: in quick games and practice, the custom teams and each career
 * player's team (him in its starting five); in street games, two pick-lists:
 * the career players (retired ones too) and the custom players.
 */
interface MyEntry {
  /** The selects' value: career:<slot>, cteam:<id>, cstars or cplayers. */
  key: string;
  team: TeamInfo;
  /** The tile caption. */
  label: string;
  /** The dropdown text. */
  option: string;
  /** A career player's team: him (practice starts on him). */
  player?: PlayerInfo;
}
const CAREER_GROUP = MY_GROUP;
/** Saved career players on their teams (also the home screen's stars). */
let careerTeams: MyEntry[] = [];
let quickMine: MyEntry[] = [];
let streetMine: MyEntry[] = [];
/** The team lists with 我的球隊 added: quick games and practice, and street games. */
const quickGroups = new Map(teamGroups);
const streetGroups = new Map(teamGroups);
const isMineKey = (k: string) => /^(career:|cteam:|cstars$|cplayers$)/.test(k);
const allMine = () => [...quickMine, ...streetMine];

/** A select's value to its team: an NBA (or data-file) abbr, or one of 我的球隊. */
function teamFor(key: string): TeamInfo {
  return allMine().find((x) => x.key === key)?.team ?? findTeam(key);
}
function keyOf(t: TeamInfo): string {
  return allMine().find((x) => x.team === t)?.key ?? t.abbr;
}
function tileLabel(t: TeamInfo): string {
  return allMine().find((x) => x.team === t)?.label ?? t.abbr;
}

/** A custom team behind a select's value (cteam:<id>), if it is one. */
function customTeamOf(key: string) {
  return custom.ready ? custom.save.teams.find((t) => `cteam:${t.id}` === key) : undefined;
}
/** How well a team knows each other: custom teams build it game by game; everyone else is 70. */
function cohesionFor(key: string): number {
  const t = customTeamOf(key);
  return t ? customCohesion(t) : 70;
}
/** The custom teams in the quick game under way (they get a game together at its end). */
let quickCustom: string[] = [];

/** Reloads the career players from the save slots (keeping the retired ones) into the team lists. */
async function refreshCareerTeams(): Promise<void> {
  let saves: Awaited<ReturnType<typeof savedCareers>> = [];
  try {
    saves = await savedCareers();
  } catch {
    // No saves to read: the lists just stay NBA teams.
  }
  careerTeams = saves.flatMap(({ slot, career }) => {
    const base = careerPlayTeam(career, NBA_TEAMS);
    if (!base) return [];
    const player = base.players.find((p) => p.name === career.player.info.name)!;
    return [{ key: `career:${slot}`, team: base, label: player.name, option: `${player.name}（${base.name}）　${teamRating(base)}`, player }];
  });
  // Retired careers join the roster (older retired saves too, the first time they are seen).
  if (custom.ready && saves.some(({ career }) => keepRetired(custom.save, career))) {
    for (const { career } of saves) keepRetired(custom.save, career);
    custom.commit();
  }
  rebuildMine();
}

/** Rebuilds 我的球隊 from the career players and the custom players and teams. */
function rebuildMine(): void {
  const cs = custom.ready ? custom.save : null;
  const teams = (cs?.teams ?? [])
    .map((t) => ({ t, info: customTeamInfo(cs!, t) }))
    .filter((x) => x.info.players.length >= CUSTOM_LIMITS.teamMin);
  quickMine = [
    ...teams.map(({ t, info }) => ({ key: `cteam:${t.id}`, team: info, label: info.abbr, option: `${info.name}（${info.abbr}）　${teamRating(info)}` })),
    ...careerTeams,
  ];
  const seen = new Set<string>();
  const stars = [...careerTeams.map((x) => x.player!), ...(cs?.retired ?? []).map((r) => r.info)].filter((p) => !seen.has(p.name) && !!seen.add(p.name));
  const own = (cs?.players ?? []).map((p) => p.info);
  streetMine = [];
  if (stars.length) {
    const team: TeamInfo = { abbr: '生涯', name: '生涯球員', primary: '#ff7a1a', secondary: '#14161f', group: MY_GROUP, players: stars };
    streetMine.push({ key: 'cstars', team, label: '生涯球員', option: `生涯球員（${stars.length} 人，含退休）` });
  }
  if (own.length) {
    const team: TeamInfo = { abbr: '自訂', name: '自訂隊員', primary: '#7a3cff', secondary: '#ffffff', group: MY_GROUP, players: own };
    streetMine.push({ key: 'cplayers', team, label: '自訂隊員', option: `自訂隊員（${own.length} 人）` });
  }
  for (const [groups, list] of [
    [quickGroups, quickMine],
    [streetGroups, streetMine],
  ] as const) {
    groups.delete(MY_GROUP);
    if (list.length) groups.set(MY_GROUP, list.map((x) => x.team));
  }
  for (const [sel, pref, list] of [
    [homeSel, 'home', quickMine],
    [awaySel, 'away', quickMine],
    [practiceTeam, 'practiceTeam', quickMine],
    [streetTeam, 'streetTeam', streetMine],
  ] as const) {
    const was = sel.value;
    sel.querySelector('optgroup[data-mine]')?.remove();
    if (list.length) {
      const group = document.createElement('optgroup');
      group.label = MY_GROUP;
      group.dataset.mine = '1';
      for (const x of list) group.appendChild(new Option(x.option, x.key));
      sel.appendChild(group);
    }
    // Keep the pick, or bring back a remembered pick of 我的球隊 now that it is loaded.
    const saved = load(pref, '');
    sel.value = isMineKey(was) || !isMineKey(saved) ? was : saved;
    if (!sel.value) sel.value = was && !isMineKey(was) ? was : 'GSW';
  }
  menuPicker.sync();
  practicePicker.sync();
  streetPicker.sync();
  if (current === 'quick') refreshCards();
  if (current === 'practice') renderPractice();
}

// ----------------------------------------------------------------- quick mode

const homeSel = $<HTMLSelectElement>('#homeSel');
const awaySel = $<HTMLSelectElement>('#awaySel');
const modeSel = $<HTMLSelectElement>('#modeSel');
const diffSel = $<HTMLSelectElement>('#diffSel');
const quarterSel = $<HTMLSelectElement>('#quarterSel');
fillTeamSelect(homeSel);
fillTeamSelect(awaySel);
homeSel.value = load('home', 'GSW');
awaySel.value = load('away', 'LAL');
if (!homeSel.value) homeSel.value = 'GSW';
if (!awaySel.value) awaySel.value = 'LAL';
modeSel.value = load('mode', 'game');
if (!modeSel.value) modeSel.value = 'game';
diffSel.value = load('diff', 'normal');
quarterSel.value = load('quarter', '180');

// The picker edits whichever side's card is selected; on phones that is two steps.
const menuPicker = new TeamPicker($('#menuPicker'), quickGroups, homeSel, keyOf, tileLabel);
let pickSide: 'home' | 'away' = 'home';
function setPickSide(side: 'home' | 'away'): void {
  pickSide = side;
  menuPicker.bind(side === 'home' ? homeSel : awaySel);
  $('#homeSide').classList.toggle('active', side === 'home');
  $('#awaySide').classList.toggle('active', side === 'away');
  $('#quick').classList.toggle('step-away', side === 'away');
  $('#stepNext').classList.toggle('hidden', side === 'away');
  $('#stepBack').classList.toggle('hidden', side === 'home');
}
$('#homeSide').addEventListener('click', () => setPickSide('home'));
$('#awaySide').addEventListener('click', () => setPickSide('away'));
$('#stepNext').addEventListener('click', () => setPickSide('away'));
$('#stepBack').addEventListener('click', () => setPickSide('home'));
setPickSide('home');

function renderCard(el: HTMLElement, t: TeamInfo): void {
  el.style.setProperty('--team', t.primary === '#000000' ? t.secondary : t.primary);
  const row = (p: PlayerInfo) =>
    `<div class="prow"><span>${p.position}　#${p.number} ${esc(p.name)}</span><b class="ovr">${playerRating(p)}</b></div>`;
  el.innerHTML =
    `<div class="thead">${logoHtml(t)}<b>${esc(t.name)}</b><span class="tovr" title="先發五人平均">${teamRating(t)}</span></div>` +
    (t.group === MY_GROUP && customTeamOf(keyOf(t)) ? `<div class="benchlbl">凝聚力 ${cohesionFor(keyOf(t))}（一起打越多場越高，上限 90）</div>` : '') +
    t.players.slice(0, 5).map(row).join('') +
    `<div class="benchlbl">替補</div>` +
    t.players.slice(5).map(row).join('');
}
function refreshCards(): void {
  renderCard($('#homeCard'), teamFor(homeSel.value));
  renderCard($('#awayCard'), teamFor(awaySel.value));
  menuPicker.render();
  renderStreet();
  $('#startBtn').textContent = modeSel.value === 'watch' ? '開始觀戰' : '開始比賽';
}
[homeSel, awaySel, modeSel].forEach((s) => s.addEventListener('change', refreshCards));

$('#randomBtn').addEventListener('click', () => {
  if (quickKind === 'street') return randomStreet();
  const pick = () => ALL_TEAMS[Math.floor(Math.random() * ALL_TEAMS.length)].abbr;
  homeSel.value = pick();
  do awaySel.value = pick();
  while (awaySel.value === homeSel.value);
  menuPicker.sync();
  refreshCards();
});

$('#startBtn').addEventListener('click', () => {
  sfx.unlock();
  if (quickKind === 'street') return startStreet();
  save('home', homeSel.value);
  save('away', awaySel.value);
  save('mode', modeSel.value);
  save('diff', diffSel.value);
  save('quarter', quarterSel.value);
  startSession([teamFor(homeSel.value), teamFor(awaySel.value)], {
    mode: 'game',
    humanTeams: modeSel.value === 'watch' ? [] : [0],
    difficulty: diffSel.value as Difficulty,
    quarterSeconds: Number(quarterSel.value),
    seed: (Math.random() * 2 ** 31) | 0,
    rules: menuRules(),
    cohesion: [cohesionFor(homeSel.value), cohesionFor(awaySel.value)],
  });
  quickCustom = [homeSel.value, awaySel.value].filter((k) => customTeamOf(k));
});

// ----------------------------------------------------------------- street

/**
 * Street games: the quick screen's other side. Each seat takes any player
 * from any team (career players too); the two sides play in red and blue.
 */
type QuickKind = 'full' | 'street';
let quickKind: QuickKind = load('quickKind', 'full') === 'street' ? 'street' : 'full';

/** A seat: the team's key (as in the selects), his roster index and name (lists of 我的球隊 can change order). */
interface Seat {
  team: string;
  idx: number;
  name?: string;
}
const STREET_SIDES: [TeamInfo, TeamInfo] = [
  { abbr: '紅隊', name: '紅隊', primary: '#c8372d', secondary: '#ffffff', players: [] },
  { abbr: '藍隊', name: '藍隊', primary: '#2a5db0', secondary: '#ffffff', players: [] },
];
let streetSize = Math.min(3, Math.max(1, Number(load('streetSize', '3')) || 3));
let streetSeats: [(Seat | null)[], (Seat | null)[]] = (() => {
  try {
    const saved = JSON.parse(load('streetSeats', '')) as [(Seat | null)[], (Seat | null)[]];
    if (Array.isArray(saved) && saved.length === 2) return saved;
  } catch {
    // Nothing saved yet.
  }
  return [[], []];
})();
let streetSel: { side: 0 | 1; i: number } = { side: 0, i: 0 };
const streetTeam = $<HTMLSelectElement>('#streetTeam');
const streetTarget = $<HTMLSelectElement>('#streetTarget');
const streetMitt = $<HTMLInputElement>('#streetMitt');
fillTeamSelect(streetTeam);
streetTeam.value = load('streetTeam', 'GSW');
if (!streetTeam.value) streetTeam.value = 'GSW';
streetTarget.value = load('streetTarget', '21');
streetMitt.checked = load('streetMitt', '0') === '1';
const streetPicker = new TeamPicker($('#streetPicker'), streetGroups, streetTeam, keyOf, tileLabel);
streetTeam.addEventListener('change', renderStreet);

/** The player in a seat (one of 我的球隊 waits until it has loaded). */
function seatPlayer(s: Seat | null | undefined): { p: PlayerInfo; t: TeamInfo } | null {
  if (!s) return null;
  const t = allMine().find((x) => x.key === s.team)?.team ?? (isMineKey(s.team) ? null : findTeam(s.team));
  let p = t?.players[s.idx];
  if (t && s.name && p?.name !== s.name) p = t.players.find((x) => x.name === s.name);
  return t && p ? { p, t } : null;
}

function setQuickKind(kind: QuickKind): void {
  quickKind = kind;
  save('quickKind', kind);
  document.querySelectorAll<HTMLElement>('#quickKind [data-kind]').forEach((b) => b.classList.toggle('on', b.dataset.kind === kind));
  $('#quick').classList.toggle('kind-street', kind === 'street');
  $<HTMLButtonElement>('#startBtn').disabled = kind === 'street' && !streetReady();
  renderStreet();
}
$('#quickKind').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-kind]');
  if (b) setQuickKind(b.dataset.kind as QuickKind);
});
$('#streetSize').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-size]');
  if (!b) return;
  streetSize = Number(b.dataset.size);
  save('streetSize', String(streetSize));
  if (streetSel.i >= streetSize) streetSel = { side: streetSel.side, i: 0 };
  renderStreet();
});

function renderStreet(): void {
  if (quickKind !== 'street') return;
  document
    .querySelectorAll<HTMLElement>('#streetSize [data-size]')
    .forEach((b) => b.classList.toggle('on', Number(b.dataset.size) === streetSize));
  ([0, 1] as const).forEach((side) => {
    const color = STREET_SIDES[side].primary;
    $(side === 0 ? '#streetHome' : '#streetAway').innerHTML = Array.from({ length: streetSize }, (_, i) => {
      const got = seatPlayer(streetSeats[side][i]);
      const on = streetSel.side === side && streetSel.i === i ? ' on' : '';
      const body = got
        ? `${logoHtml(got.t, 'slogo')}<span class="nm">${esc(got.p.name)}</span><span class="pos">${got.p.position}</span><b>${playerRating(got.p)}</b>`
        : '<span class="nm empty">＋ 選球員</span>';
      return `<button type="button" class="seat${on}" data-side="${side}" data-i="${i}" style="--team:${color}">${body}</button>`;
    }).join('');
  });
  const t = teamFor(streetTeam.value);
  const color = t.primary === '#000000' ? t.secondary : t.primary;
  const taken = new Set(([0, 1] as const).flatMap((side) => streetSeats[side].slice(0, streetSize).map((s) => seatPlayer(s)?.p.name)));
  $('#streetPlayers').innerHTML = t.players
    .map((p, i) => {
      const used = taken.has(p.name);
      return (
        `<button type="button" class="pl${used ? ' on' : ''}" data-pi="${i}" style="--team:${color}"${used ? ' disabled' : ''}>` +
        `<span class="num">#${p.number}</span><span class="nm">${esc(p.name)}</span><span class="pos">${p.position}</span><b>${playerRating(p)}</b></button>`
      );
    })
    .join('');
  streetPicker.render();
  $<HTMLButtonElement>('#startBtn').disabled = !streetReady();
}

function streetReady(): boolean {
  return ([0, 1] as const).every((side) => Array.from({ length: streetSize }, (_, i) => seatPlayer(streetSeats[side][i])).every(Boolean));
}

function saveSeats(): void {
  save('streetSeats', JSON.stringify(streetSeats));
}

$('#quick').addEventListener('click', (e) => {
  if (quickKind !== 'street') return;
  const el = e.target as HTMLElement;
  const seat = el.closest<HTMLElement>('[data-side]');
  const pick = el.closest<HTMLElement>('[data-pi]');
  if (seat) {
    streetSel = { side: Number(seat.dataset.side) as 0 | 1, i: Number(seat.dataset.i) };
    renderStreet();
  } else if (pick) {
    const idx = Number(pick.dataset.pi);
    streetSeats[streetSel.side][streetSel.i] = { team: streetTeam.value, idx, name: teamFor(streetTeam.value).players[idx]?.name };
    saveSeats();
    // On to the next empty seat: yours first, then the other side.
    const order = ([0, 1] as const).flatMap((side) => Array.from({ length: streetSize }, (_, i) => ({ side, i })));
    const next = order.find((o) => !seatPlayer(streetSeats[o.side][o.i]));
    if (next) streetSel = next;
    renderStreet();
  }
});

function randomStreet(): void {
  const pool = [...ALL_TEAMS, ...streetMine.map((x) => x.team)].flatMap((t) =>
    t.players.map((p, idx) => ({ team: keyOf(t), idx, name: p.name })),
  );
  const used = new Set<string>();
  streetSeats = [[], []];
  for (const side of [0, 1] as const) {
    for (let i = 0; i < streetSize; i++) {
      let s = pool[Math.floor(Math.random() * pool.length)];
      while (used.has(s.name)) s = pool[Math.floor(Math.random() * pool.length)];
      used.add(s.name);
      streetSeats[side][i] = { team: s.team, idx: s.idx, name: s.name };
    }
  }
  saveSeats();
  renderStreet();
}

function startStreet(): void {
  if (!streetReady()) return;
  save('mode', modeSel.value);
  save('diff', diffSel.value);
  save('streetTeam', streetTeam.value);
  save('streetTarget', streetTarget.value);
  save('streetMitt', streetMitt.checked ? '1' : '0');
  // Guards first: the sim spaces players and matches them up by slot.
  const side = (s: 0 | 1): TeamInfo => ({
    ...STREET_SIDES[s],
    players: streetSeats[s]
      .slice(0, streetSize)
      .map((x) => seatPlayer(x)!.p)
      .sort((a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position)),
  });
  startSession([side(0), side(1)], {
    mode: 'game',
    humanTeams: modeSel.value === 'watch' ? [] : [0],
    difficulty: diffSel.value as Difficulty,
    seed: (Math.random() * 2 ** 31) | 0,
    rules: { fouls: ruleBoxes.fouls.checked, violations: false, fatigue: false },
    street: { target: Number(streetTarget.value), makeItTakeIt: streetMitt.checked },
  });
}
setQuickKind(quickKind);

// ----------------------------------------------------------------- player database

const playerDb = new PlayerDb();
const rosterYear = parseInt(ROSTER_SEASON, 10);
function renderPlayerDb(): void {
  // Career players are in the career's own database; here, the real rosters.
  const groups = new Map([...teamGroups].filter(([g]) => g !== CAREER_GROUP));
  playerDb.mount($('#playerDb'), { groups, age: (p) => ageInSeason(p.name, rosterYear) });
}

// ----------------------------------------------------------------- practice

const practiceTeam = $<HTMLSelectElement>('#practiceTeam');
fillTeamSelect(practiceTeam);
practiceTeam.value = load('practiceTeam', homeSel.value);
if (!practiceTeam.value) practiceTeam.value = 'GSW';
let practicePlayer = Number(load('practicePlayer', '0'));
const practicePicker = new TeamPicker($('#practicePicker'), quickGroups, practiceTeam, keyOf, tileLabel);
practiceTeam.addEventListener('change', () => {
  // A career team: start on him.
  const mine = careerTeams.find((x) => x.key === practiceTeam.value);
  practicePlayer = mine?.player ? mine.team.players.indexOf(mine.player) : 0;
  renderPractice();
});

function renderPractice(): void {
  const t = teamFor(practiceTeam.value);
  if (!t.players[practicePlayer]) practicePlayer = 0;
  const color = t.primary === '#000000' ? t.secondary : t.primary;
  $('#practicePlayers').innerHTML = t.players
    .map(
      (p, i) =>
        `<button type="button" class="pl${i === practicePlayer ? ' on' : ''}" data-i="${i}" style="--team:${color}">` +
        `<span class="num">#${p.number}</span><span class="nm">${esc(p.name)}</span><span class="pos">${p.position}</span><b>${playerRating(p)}</b></button>`,
    )
    .join('');
  practicePicker.render();
}
$('#practicePlayers').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
  if (!b) return;
  practicePlayer = Number(b.dataset.i);
  renderPractice();
});

/** The two practice feeders (陪練員): plain players with a sure pass. */
function feeder(n: number): PlayerInfo {
  return {
    name: `陪練員 ${n}`,
    number: 90 + n,
    heightM: 1.9,
    position: 'SG',
    ratings: { speed: 70, jump: 50, close: 50, mid: 50, three: 50, ft: 50, handle: 60, pass: 95, steal: 30, block: 30, defense: 30, rebound: 60, stamina: 99 },
    look: { skin: n === 1 ? 2 : 5, hair: 'short', beard: 'none', headband: false, sleeve: 'none', kneepad: false, shoe: 'white', socks: 'low' },
  };
}

$('#practiceBtn').addEventListener('click', () => {
  sfx.unlock();
  save('practiceTeam', practiceTeam.value);
  save('practicePlayer', String(practicePlayer));
  const t = teamFor(practiceTeam.value);
  const me = t.players[practicePlayer];
  const lineup: TeamInfo = { ...t, players: [me, feeder(1), feeder(2)] };
  startSession([lineup, lineup], { mode: 'practice', humanTeams: [0], seed: (Math.random() * 2 ** 31) | 0, feeders: true });
});

// ----------------------------------------------------------------- menu background

let showcase: Showcase | null = null;

/**
 * A random NBA player (half the time one of your career players, when you
 * have any), or (`pinned`) the career player, who stays until replaced.
 */
function startShowcase(pinned?: { player: PlayerInfo; team: TeamInfo }): void {
  stopShowcase();
  const mine = !pinned && careerTeams.length && Math.random() < 0.5 ? careerTeams[Math.floor(Math.random() * careerTeams.length)] : null;
  const team = pinned?.team ?? mine?.team ?? NBA_TEAMS[Math.floor(Math.random() * NBA_TEAMS.length)];
  const player = pinned?.player ?? mine?.player ?? team.players[Math.floor(Math.random() * team.players.length)];
  showcase = new Showcase(player, team, hud, window.innerWidth / window.innerHeight, !!pinned);
  graphics.attach(showcase.session.scene, showcase.session.arena);
  document.body.classList.add('attract');
  if (import.meta.env.DEV) (window as unknown as { __showcase: Showcase }).__showcase = showcase;
  showTag();
}
function stopShowcase(): void {
  showcase?.dispose();
  showcase = null;
  document.body.classList.remove('attract');
  $('#fade').style.opacity = '0';
}

let restyle: PlayerInfo | null = null;

/** The career screens' live preview: same team, so just restyle him (once per frame at most). */
function previewCareer(player: PlayerInfo, team: TeamInfo): void {
  if (session || PHONE) return;
  if (showcase?.hold && showcase.team.abbr === team.abbr && showcase.team.primary === team.primary) {
    if (!restyle) {
      requestAnimationFrame(() => {
        if (restyle && showcase?.hold) showcase.setPlayer(restyle);
        restyle = null;
        showTag();
      });
    }
    restyle = player;
    return;
  }
  startShowcase({ player, team });
}

/** Who is on the court behind the home screen. */
function showTag(): void {
  const el = $('#showTag');
  if (!showcase) {
    el.innerHTML = '';
    return;
  }
  const { player: p, team: t } = showcase;
  el.style.setProperty('--team', t.primary === '#000000' ? t.secondary : t.primary);
  el.innerHTML =
    `${logoHtml(t, 'taglogo')}<div><b>${esc(p.name)}</b>` +
    `<span>#${p.number} · ${p.position} · ${esc(t.name)} · 總評 ${playerRating(p)}</span></div>`;
}

// ----------------------------------------------------------------- matches

/** A career game in progress: who you are and what to do with the result. */
let careerPlay: { rosterIdx: number; done: (state: GameState) => void } | null = null;
/** A MyTeam game in progress: books the result once (at the final or on leaving), then back to MyTeam. */
let myteamPlay: { finish: (state: GameState, forfeit: boolean) => string; after: () => void; booked: boolean } | null = null;

function startSession(teams: [TeamInfo, TeamInfo], settings: Partial<GameSettings>, home: 0 | 1 = 0): void {
  stopShowcase();
  session?.dispose();
  // Career games keep their own camera choice (the player view by default).
  const career = settings.solo !== undefined;
  const view = career ? load('careerView', 'player') : viewSel.value;
  const onViewChange = (next: CameraMode) => {
    if (career) {
      save('careerView', next);
      return;
    }
    viewSel.value = next;
    save('view', next);
  };
  session = new Session(
    teams,
    settings,
    hud,
    input,
    sfx,
    { onFinal: showFinal, onViewChange },
    window.innerWidth / window.innerHeight,
    view as CameraMode,
    { home },
  );
  graphics.attach(session.scene, session.arena);
  // Dev-only hook for inspecting the sim from the browser console.
  if (import.meta.env.DEV) (window as unknown as { __session: Session }).__session = session;
  show(current);
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

function backToMenu(): void {
  const career = careerPlay;
  careerPlay = null;
  const mt = myteamPlay;
  myteamPlay = null;
  if (mt && session && !mt.booked) mt.finish(session.state, true);
  // Leaving a career game early: the computer plays out the rest.
  if (career && session && session.state.phase !== 'final') playOut(session.state);
  const state = session?.state;
  session?.dispose();
  session = null;
  $('#boxscore').classList.add('hidden');
  $('#quitBtn').textContent = '回主選單';
  if (career && state) {
    show('hub');
    career.done(state);
  } else if (mt) {
    show('myteam');
    mt.after();
  } else {
    show(current);
  }
}

/** Starts a career game with you on team 0 and the controls on you. */
function playCareer(
  teams: [TeamInfo, TeamInfo],
  settings: Partial<GameSettings>,
  rosterIdx: number,
  done: (state: GameState) => void,
  home = true,
): void {
  sfx.unlock();
  startSession(teams, settings, home ? 0 : 1);
  careerPlay = { rosterIdx, done };
  $('#quitBtn').textContent = '離開（電腦打完這場）';
}

// ------------------------------------------------------------ box score

const pauseLineup = new LineupPanel($('#boxLineup'));
/** The team whose box score shows (one at a time). */
let boxTeam: 0 | 1 = 0;

function showBoxTeam(): void {
  [...$('#boxTables').children].forEach((el, i) => el.classList.toggle('hidden', i !== boxTeam));
  $('#boxTabs')
    .querySelectorAll<HTMLElement>('[data-team]')
    .forEach((b) => b.classList.toggle('on', Number(b.dataset.team) === boxTeam));
}
$('#boxTabs').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-team]');
  if (!b) return;
  boxTeam = Number(b.dataset.team) as 0 | 1;
  showBoxTeam();
});

function showBox(title: string, canResume: boolean): void {
  if (!session) return;
  $('#boxTitle').textContent = title;
  // Fouls and timeouts left: phones hide that row of the HUD, so it shows here.
  const info = session.state.settings.mode === 'game' && !session.state.settings.street;
  $('#boxInfo').classList.toggle('hidden', !info);
  if (info)
    $('#boxInfo').innerHTML = ([0, 1] as const)
      .map((t) => `<span><b>${esc(session!.teams[t].abbr)}</b> ${$(`#ti${t}`).innerHTML}</span>`)
      .join('');
  $('#boxTables').innerHTML = renderBoxScore(session.state, session.teams);
  const both = $('#boxTables').children.length === 2;
  boxTeam = session.team === 1 ? 1 : 0;
  $('#boxTabs').classList.toggle('hidden', !both);
  $('#boxTabs').innerHTML = both
    ? ([0, 1] as const)
        .map((t) => `<button type="button" data-team="${t}">${esc(session!.teams[t].name)}　${session!.state.score[t]}</button>`)
        .join('')
    : '';
  if (both) showBoxTeam();
  const s = session.state;
  const team = session.team;
  // Career games: the coach handles substitutions.
  const subs = canResume && s.settings.mode === 'game' && !s.settings.street && team >= 0 && !session.solo;
  $('#boxLineup').classList.toggle('hidden', !subs);
  if (subs) pauseLineup.render(s, team as 0 | 1, session.subActions);
  $('#resumeBtn').classList.toggle('hidden', !canResume);
  $('#boxscore').classList.remove('hidden');
}

/** Quick games against the computer pay coins: 150 for a win, 50 for a loss, scaled by its level. */
const QUICK_COINS = { win: 150, loss: 50 };
const paid = new WeakSet<Session>();

function showFinal(): void {
  if (!session) return;
  session.paused = true;
  const [a, b] = session.state.score;
  const [ta, tb] = session.teams;
  showBox(`終場　${ta.abbr} ${a} : ${b} ${tb.abbr}`, false);
  const s = session.state.settings;
  if (myteamPlay && !myteamPlay.booked) {
    myteamPlay.booked = true;
    $('#boxTitle').textContent += `　${myteamPlay.finish(session.state, false)}`;
    $('#quitBtn').textContent = '回 MyTeam';
  }
  if (!careerPlay && !myteamPlay && s.mode === 'game' && s.humanTeams.includes(0) && !paid.has(session)) {
    paid.add(session);
    // Custom teams that played get to know each other better.
    const played = [...new Set(quickCustom)].map(customTeamOf).filter((t) => !!t);
    for (const t of played) t.games = (t.games ?? 0) + 1;
    if (played.length) custom.commit();
    quickCustom = [];
    const coins = Math.round((a > b ? QUICK_COINS.win : QUICK_COINS.loss) * DIFFICULTY_COINS[s.difficulty]);
    void wallet.add(coins);
    $('#boxTitle').textContent += `　+${coins} 金幣`;
  }
  if (careerPlay) $('#quitBtn').textContent = '回生涯';
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
  if (input.consumePress('Escape')) {
    if (session) togglePause();
    else if (CAREER_SCREENS.includes(current)) show('career');
    else if (current !== 'home') show('home');
  }
  const overlay = !$('#boxscore').classList.contains('hidden') || !$('#timeoutPanel').classList.contains('hidden');
  touch.show(touchOn && !!session && !overlay);
  if (session) {
    session.frame(dt);
    graphics.render(session.scene, session.cam.camera, dt);
  } else if (showcase) {
    if (showcase.finished) startShowcase();
    showcase!.frame(dt);
    $('#fade').style.opacity = String(showcase!.fade);
    graphics.render(showcase!.session.scene, showcase!.camera, dt);
  } else {
    graphics.clear();
  }
  requestAnimationFrame(frame);
}

initCareerMenu(show, { preview: previewCareer, play: playCareer });
initCustom({ careerPlayers: () => careerTeams.map((x) => x.player!) });
// Custom players and teams change 我的球隊.
custom.onChange(() => rebuildMine());

initMyTeam({
  play(teams, settings, finish, after) {
    sfx.unlock();
    const rules = menuRules();
    startSession(teams, {
      ...settings,
      rules: settings.street ? { fouls: rules.fouls, violations: false, fatigue: false } : rules,
    });
    myteamPlay = { finish, after, booked: false };
    $('#quitBtn').textContent = '離開（算輸）';
  },
});
// ----------------------------------------------------------------- bug reports

const SCREEN_NAME: Record<Screen, string> = {
  home: '主畫面',
  quick: '快速模式',
  practice: '練習',
  players: '球員資料庫',
  settings: '設定',
  career: '生涯存檔',
  account: '帳號',
  create: '建立球員',
  hub: '生涯',
  myteam: 'MyTeam',
  custom: '自訂隊伍/人員',
};

/** What goes along with a report: the screen, and in a game its mode and score. */
function bugContext(): BugContext {
  if (!session) return { 畫面: SCREEN_NAME[current] };
  const s = session.state;
  const mode = careerPlay ? '生涯' : myteamPlay ? 'MyTeam' : s.settings.street ? '街頭' : s.settings.mode === 'game' ? '快速對戰' : s.settings.mode;
  const text = (sel: string) => $(sel).textContent?.trim() ?? '';
  return {
    比賽: mode,
    比分: `${session.teams[0].abbr} ${s.score[0]}–${s.score[1]} ${session.teams[1].abbr}`,
    時間: `${text('#scoreboard .period')} ${text('#scoreboard .clock')}`,
  };
}
document.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-bug]')) openBugReport(bugContext());
});

show('home');
// The first player on the court may be yours: wait a moment for the saves.
void Promise.race([careerLoad, new Promise((r) => setTimeout(r, 800))]).then(() => {
  booted = true;
  if (!showcase && !session && SHOWCASE_SCREENS.includes(current)) startShowcase();
});
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  graphics.resize();
  showcase?.resize(window.innerWidth / window.innerHeight);
  session?.resize(window.innerWidth / window.innerHeight);
});
