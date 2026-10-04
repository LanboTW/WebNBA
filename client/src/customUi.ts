import {
  ARCHETYPES,
  CUSTOM_LIMITS,
  POSITIONS,
  RATING_KEYS,
  customTeamInfo,
  findTeam,
  hasMember,
  memberInfo,
  nbaPool,
  newId,
  playerNameProblem,
  playerRating,
  randomLook,
  teamProblem,
  teamRating,
  templateRatings,
  type ArchetypeId,
  type CustomTeam,
  type PlayerInfo,
  type Position,
  type TeamMember,
} from '@webnba/shared';
import { esc } from './boxscore';
import { HAIR_COLORS, LOOK_FIELDS, POSITION_LABEL, RATING_LABEL } from './careerCreate';
import { custom } from './myteamStore';

/**
 * 自訂隊伍/人員: make players (any ratings 25-99, a type to start from, the
 * career looks), build teams of up to 13 from them, NBA players and career
 * players, and see the retired career players kept for street games.
 */

type Tab = 'players' | 'teams' | 'retired';
type Source = 'custom' | 'nba' | 'career';

/** What main.ts provides: the career players there are right now (retired ones come from the save). */
export interface CustomHost {
  careerPlayers(): PlayerInfo[];
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

let host: CustomHost = { careerPlayers: () => [] };
let tab: Tab = 'players';
let message = '';
/** The id waiting for a delete confirmation. */
let confirmDel: string | null = null;

interface PlayerDraft {
  id: string | null;
  info: PlayerInfo;
  arch: ArchetypeId;
  tplOvr: number;
}
let pdraft: PlayerDraft | null = null;

let tdraft: CustomTeam | null = null;
let addSrc: Source = 'custom';
let query = '';

const ovrClass = (v: number) => (v >= 90 ? 'r-elite' : v >= 80 ? 'r-good' : v >= 65 ? '' : 'r-weak');
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const cm = (m: number) => Math.round(m * 100);

function freshPlayer(): PlayerDraft {
  const position: Position = 'SF';
  const heightM = 2.01;
  return {
    id: null,
    arch: 'allround',
    tplOvr: 75,
    info: {
      name: '',
      number: Math.floor(Math.random() * 100),
      heightM,
      position,
      ratings: templateRatings(position, 'allround', heightM, 75),
      look: { ...randomLook(), hairColor: HAIR_COLORS[0] },
    },
  };
}

function freshTeam(): CustomTeam {
  return { id: '', name: '', abbr: '', primary: '#c8372d', secondary: '#ffffff', members: [] };
}

// ----------------------------------------------------------------- players

function chips<T>(set: string, current: T, options: [T, string][], swatch = false): string {
  return (
    `<div class="chips${swatch ? ' swatches' : ''}">` +
    options
      .map(([v, label]) => {
        const on = v === current ? ' on' : '';
        const body = swatch ? `<i style="background:${label}"></i>` : esc(label);
        return `<button type="button" class="chip${on}" data-set="${set}" data-value='${esc(JSON.stringify(v))}'>${body}</button>`;
      })
      .join('') +
    '</div>'
  );
}

function playerRow(id: string, p: PlayerInfo, extra = '', editable = true): string {
  const ovr = playerRating(p);
  const del =
    confirmDel === id
      ? `<span class="cuconfirm">刪除 ${esc(p.name)}？<button type="button" class="small danger" data-del="${id}">確定</button><button type="button" class="small" data-act="nodel">取消</button></span>`
      : `<button type="button" class="small" data-askdel="${id}">刪除</button>`;
  return (
    `<div class="curow${pdraft?.id === id ? ' sel' : ''}"><b class="cuovr ${ovrClass(ovr)}">${ovr}</b><div class="cuinfo"><b>${esc(p.name)}</b>` +
    `<span>${p.position}・#${p.number}・${cm(p.heightM)} 公分${extra}</span></div>` +
    (editable ? `<button type="button" class="small" data-edit="${id}">編輯</button>` : '') +
    del +
    `</div>`
  );
}

function playerEditor(): string {
  if (!pdraft) return `<p class="fine mtnodetail">點「新增隊員」或一名隊員的「編輯」，在這裡設定名字、位置、能力與外觀。</p>`;
  const d = pdraft;
  const p = d.info;
  const problem = playerNameProblem(custom.save, p.name, d.id ?? undefined);
  const arch = ARCHETYPES.filter((a) => a.positions.includes(p.position));
  const tpl = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 99];
  return (
    `<h3 class="mth">${d.id ? '編輯隊員' : '新增隊員'}<small>總評 <b id="cuOvr">${playerRating(p)}</b></small></h3>` +
    `<div class="row"><label class="grow">名字<input name="name" maxlength="20" autocomplete="off" placeholder="例如 林小明" value="${esc(p.name)}" /></label>` +
    `<label class="narrow">背號<input name="number" type="number" min="0" max="99" value="${p.number}" /></label></div>` +
    `<div class="field"><span>位置</span>${chips('p.position', p.position, POSITIONS.map((x) => [x, `${x} ${POSITION_LABEL[x]}`]))}</div>` +
    `<div class="field"><span>身高 <b id="cuHeight">${cm(p.heightM)} 公分</b></span><input name="height" type="range" min="${cm(CUSTOM_LIMITS.height[0])}" max="${cm(
      CUSTOM_LIMITS.height[1],
    )}" step="1" value="${cm(p.heightM)}" /></div>` +
    `<h3 class="mth">從範本開始</h3><div class="row">` +
    `<label>球員類型<select name="arch">${arch.map((a) => `<option value="${a.id}"${a.id === d.arch ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>` +
    `<label>目標總評<select name="tpl">${tpl.map((v) => `<option value="${v}"${v === d.tplOvr ? ' selected' : ''}>${v}</option>`).join('')}</select></label>` +
    `<button type="button" class="small" data-act="template">套用範本</button></div>` +
    `<h3 class="mth">能力<small>每項 ${CUSTOM_LIMITS.rating[0]}–${CUSTOM_LIMITS.rating[1]}，自由調整</small></h3><div class="curatings">` +
    RATING_KEYS.map(
      (k) =>
        `<label class="curating"><span>${RATING_LABEL[k]}</span><input name="r.${k}" type="range" min="${CUSTOM_LIMITS.rating[0]}" max="${CUSTOM_LIMITS.rating[1]}" value="${p.ratings[k]}" /><b data-rv="${k}">${p.ratings[k]}</b></label>`,
    ).join('') +
    `</div>` +
    `<h3 class="mth">外觀<button type="button" class="small" data-act="randlook">隨機外觀</button></h3>` +
    LOOK_FIELDS.map((f) => {
      const current = f.key === 'hairColor' ? (p.look?.hairColor ?? HAIR_COLORS[0]) : p.look?.[f.key];
      return `<div class="field look"><span>${f.label}</span>${chips(`look.${f.key}`, current, f.options, f.swatch)}</div>`;
    }).join('') +
    `<div class="cuactions"><span class="fine left" id="cuProblem">${problem ? esc(problem) : ''}</span>` +
    `<button type="button" class="small" data-act="pcancel">取消</button><button type="button" class="small go" data-act="psave"${problem ? ' disabled' : ''}>儲存</button></div>`
  );
}

function playersTab(): string {
  const s = custom.save;
  const full = s.players.length >= CUSTOM_LIMITS.players;
  const list = s.players.map((x) => {
    const teams = s.teams.filter((t) => t.members.some((m) => m.src === 'custom' && m.id === x.id)).map((t) => t.name);
    return playerRow(x.id, x.info, teams.length ? `・${esc(teams.join('、'))}` : '');
  });
  return cols(
    `<div class="mtbar"><span>自訂隊員 <b>${s.players.length}</b> / ${CUSTOM_LIMITS.players}</span>` +
      `<button type="button" class="small go" data-act="pnew"${full ? ' disabled' : ''}>＋ 新增隊員</button></div>` +
      `<div class="culist mtscroll">${list.join('') || '<p class="fine">還沒有自訂隊員。</p>'}</div>` +
      '<p class="fine left">自訂隊員可以在街頭籃球的「我的球隊」挑，也能放進自訂隊伍。</p>',
    playerEditor(),
    true,
  );
}

// ----------------------------------------------------------------- teams

function pool(): { info: PlayerInfo; member: TeamMember; tag: string }[] {
  const s = custom.save;
  const q = query.trim().toLowerCase();
  const match = (p: PlayerInfo) => !q || p.name.toLowerCase().includes(q);
  if (addSrc === 'custom') return s.players.filter((x) => match(x.info)).map((x) => ({ info: x.info, member: { src: 'custom', id: x.id }, tag: '自訂' }));
  if (addSrc === 'career') {
    const seen = new Set<string>();
    return [...host.careerPlayers(), ...s.retired.map((r) => r.info)]
      .filter((p) => !seen.has(p.name) && !!seen.add(p.name) && match(p))
      .map((info) => ({ info, member: { src: 'career', info: clone(info) }, tag: '生涯' }));
  }
  return nbaPool()
    .filter((x) => match(x.info))
    .sort((a, b) => playerRating(b.info) - playerRating(a.info))
    .slice(0, q ? 80 : 40)
    .map((x) => ({ info: x.info, member: { src: 'nba', info: clone(x.info) }, tag: x.team.abbr }));
}

function teamEditor(): string {
  if (!tdraft) return `<p class="fine mtnodetail">點「新增隊伍」或一支隊伍的「編輯」，在這裡設定隊名、顏色和陣容。</p>`;
  const s = custom.save;
  const t = tdraft;
  const problem = teamProblem(s, t);
  const info = customTeamInfo(s, t);
  const rows = t.members
    .map((m, i) => {
      const p = memberInfo(s, m);
      if (!p) return '';
      const tag = m.src === 'custom' ? '自訂' : m.src === 'career' ? '生涯' : 'NBA';
      return (
        `<div class="curow small"><span class="cuslot">${i < 5 ? '先發' : '板凳'}</span><b class="cuovr ${ovrClass(playerRating(p))}">${playerRating(p)}</b>` +
        `<div class="cuinfo"><b>${esc(p.name)}</b><span>${p.position}・${tag}</span></div>` +
        `<button type="button" class="small" data-mv="${i}:-1"${i === 0 ? ' disabled' : ''}>↑</button>` +
        `<button type="button" class="small" data-mv="${i}:1"${i === t.members.length - 1 ? ' disabled' : ''}>↓</button>` +
        `<button type="button" class="small" data-rm="${i}">✕</button></div>`
      );
    })
    .join('');
  const full = t.members.length >= CUSTOM_LIMITS.teamMax;
  const adds = pool()
    .map((x) => {
      const on = hasMember(s, t, x.info.name);
      return `<button type="button" class="chip" data-add='${esc(JSON.stringify(x.member))}'${on || full ? ' disabled' : ''}>${x.info.position} ${esc(x.info.name)} ${playerRating(
        x.info,
      )}<small> ${esc(x.tag)}</small></button>`;
    })
    .join('');
  const srcTabs = (
    [
      ['custom', '自訂隊員'],
      ['nba', 'NBA 球員'],
      ['career', '生涯球員'],
    ] as const
  )
    .map(([k, l]) => `<button type="button" data-src="${k}" class="${k === addSrc ? 'on' : ''}">${l}</button>`)
    .join('');
  return (
    `<h3 class="mth">${t.id ? '編輯隊伍' : '新增隊伍'}<small>${t.members.length} 人・評分 ${t.members.length >= 5 ? teamRating(info) : '—'}</small></h3>` +
    `<div class="row"><label class="grow">隊名<input name="tname" maxlength="16" autocomplete="off" placeholder="例如 台北夜鷹" value="${esc(t.name)}" /></label>` +
    `<label class="narrow">縮寫<input name="tabbr" maxlength="3" autocomplete="off" placeholder="TPE" value="${esc(t.abbr)}" /></label></div>` +
    `<div class="row"><label>主色<input name="tprimary" type="color" value="${esc(t.primary)}" /></label><label>副色<input name="tsecondary" type="color" value="${esc(
      t.secondary,
    )}" /></label></div>` +
    `<h3 class="mth">陣容<small>${CUSTOM_LIMITS.teamMin}–${CUSTOM_LIMITS.teamMax} 人，前 5 人先發</small></h3><div class="culist">${rows || '<p class="fine">還沒有球員，從下面加入。</p>'}</div>` +
    `<h3 class="mth">加入球員</h3><nav class="tabs mtsize">${srcTabs}</nav>` +
    `<input type="search" name="tquery" placeholder="搜尋名字" value="${esc(query)}" />` +
    `<div class="chips mtscroll cupool">${adds || '<span class="fine">沒有可加入的球員。</span>'}</div>` +
    '<p class="fine left">NBA 和生涯球員加入時會存下當下的能力；自訂隊員會跟著你的編輯更新。</p>' +
    `<div class="cuactions"><span class="fine left">${problem ? esc(problem) : ''}</span>` +
    `<button type="button" class="small" data-act="tcancel">取消</button><button type="button" class="small go" data-act="tsave"${problem ? ' disabled' : ''}>儲存</button></div>`
  );
}

function teamsTab(): string {
  const s = custom.save;
  const full = s.teams.length >= CUSTOM_LIMITS.teams;
  const list = s.teams
    .map((t) => {
      const info = customTeamInfo(s, t);
      const ok = info.players.length >= CUSTOM_LIMITS.teamMin;
      const del =
        confirmDel === t.id
          ? `<span class="cuconfirm">刪除 ${esc(t.name)}？<button type="button" class="small danger" data-del="${t.id}">確定</button><button type="button" class="small" data-act="nodel">取消</button></span>`
          : `<button type="button" class="small" data-askdel="${t.id}">刪除</button>`;
      return (
        `<div class="curow${tdraft?.id === t.id ? ' sel' : ''}"><span class="cuabbr" style="background:${esc(t.primary)};color:${esc(t.secondary)}">${esc(info.abbr)}</span>` +
        `<div class="cuinfo"><b>${esc(info.name)}</b><span>${info.players.length} 人・評分 ${ok ? teamRating(info) : '—'}${ok ? '' : '・人數不足，不能上場'}</span></div>` +
        `<button type="button" class="small" data-tedit="${t.id}">編輯</button>${del}</div>`
      );
    })
    .join('');
  return cols(
    `<div class="mtbar"><span>自訂隊伍 <b>${s.teams.length}</b> / ${CUSTOM_LIMITS.teams}</span>` +
      `<button type="button" class="small go" data-act="tnew"${full ? ' disabled' : ''}>＋ 新增隊伍</button></div>` +
      `<div class="culist mtscroll">${list || '<p class="fine">還沒有自訂隊伍。</p>'}</div>` +
      '<p class="fine left">自訂隊伍在快速對戰和練習的「我的球隊」分組裡。</p>',
    teamEditor(),
    true,
  );
}

// ----------------------------------------------------------------- retired

function retiredTab(): string {
  const s = custom.save;
  const rows = s.retired
    .map((r) => {
      const team = findTeam(r.team);
      return playerRow(r.key, r.info, `・最後效力 ${esc(team.abbr === r.team ? team.name : r.team)}・${r.seasons} 季${r.hall ? '・名人堂' : ''}`, false);
    })
    .join('');
  return (
    `<div class="mtbar"><span>退休名冊 <b>${s.retired.length}</b> / ${CUSTOM_LIMITS.retired}</span></div>` +
    '<p class="fine left">生涯球員退休時自動收進這裡（退休時的能力），存檔格可以拿去開新生涯，他們仍然能在街頭籃球的「我的球隊」上場、也能放進自訂隊伍。超過 30 人時最舊的會離開。</p>' +
    `<div class="culist cuwide">${rows || '<p class="fine">還沒有退休的生涯球員。</p>'}</div>`
  );
}

// ----------------------------------------------------------------- render

function cols(left: string, right: string, rightFirst = false): string {
  return `<div class="cols mtcols"><div class="col">${left}</div><div class="col">${rightFirst ? `<div class="q-top">${right}</div>` : right}</div></div>`;
}

export function renderCustom(): void {
  const root = $('#cuBody');
  if (!custom.ready) {
    root.innerHTML = '<p class="fine">讀取中…</p>';
    return;
  }
  const tabs: [Tab, string][] = [
    ['players', '自訂隊員'],
    ['teams', '自訂隊伍'],
    ['retired', '退休名冊'],
  ];
  $('#cuTabs').innerHTML = tabs.map(([id, l]) => `<button type="button" data-tab="${id}" class="${tab === id ? 'on' : ''}">${l}</button>`).join('');
  root.innerHTML = (message ? `<p class="msg">${esc(message)}</p>` : '') + (tab === 'players' ? playersTab() : tab === 'teams' ? teamsTab() : retiredTab());
}

/** Live bits of the player editor that change while typing or sliding (no re-render, to keep focus). */
function refreshPlayerBits(): void {
  if (!pdraft) return;
  const root = $('#cuBody');
  root.querySelector('#cuOvr')!.textContent = String(playerRating(pdraft.info));
  root.querySelector('#cuHeight')!.textContent = `${cm(pdraft.info.heightM)} 公分`;
  const problem = playerNameProblem(custom.save, pdraft.info.name, pdraft.id ?? undefined);
  root.querySelector('#cuProblem')!.textContent = problem ?? '';
  root.querySelector<HTMLButtonElement>('[data-act="psave"]')!.disabled = !!problem;
}

function refreshTeamBits(): void {
  if (!tdraft) return;
  const root = $('#cuBody');
  const problem = teamProblem(custom.save, tdraft);
  const actions = root.querySelector('.cuactions')!;
  actions.querySelector('span')!.textContent = problem ?? '';
  actions.querySelector<HTMLButtonElement>('[data-act="tsave"]')!.disabled = !!problem;
}

function scrollTop(): void {
  if (window.innerWidth < 1100) $('#custom').scrollTo({ top: 0, behavior: 'smooth' });
}

export function initCustom(h: CustomHost): void {
  host = h;
  custom.onChange(() => {
    if (!$('#custom').classList.contains('hidden')) renderCustom();
  });
  $('#cuTabs').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab as Tab;
    message = '';
    confirmDel = null;
    renderCustom();
  });
  const root = $('#cuBody');
  root.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    const s = custom.save;
    const data = (attr: string) => el.closest<HTMLElement>(`[${attr}]`)?.getAttribute(attr) ?? null;
    const act = data('data-act');
    message = '';
    if (data('data-set') && pdraft) {
      const [group, key] = data('data-set')!.split('.');
      const value = JSON.parse(data('data-value')!);
      if (group === 'look') (pdraft.info.look as unknown as Record<string, unknown>)[key] = value;
      else if (key === 'position') {
        pdraft.info.position = value as Position;
        if (!ARCHETYPES.some((a) => a.id === pdraft!.arch && a.positions.includes(value))) pdraft.arch = 'allround';
      }
    } else if (act === 'pnew') {
      pdraft = freshPlayer();
      scrollTop();
    } else if (data('data-edit')) {
      const x = s.players.find((p) => p.id === data('data-edit'));
      if (x) pdraft = { id: x.id, info: clone(x.info), arch: 'allround', tplOvr: Math.round(playerRating(x.info) / 5) * 5 };
      scrollTop();
    } else if (act === 'template' && pdraft) {
      const p = pdraft.info;
      p.ratings = templateRatings(p.position, pdraft.arch, p.heightM, pdraft.tplOvr);
    } else if (act === 'randlook' && pdraft) {
      pdraft.info.look = { ...randomLook(), hairColor: HAIR_COLORS[Math.floor(Math.random() * 3)] };
    } else if (act === 'pcancel') pdraft = null;
    else if (act === 'psave' && pdraft) {
      const d = pdraft;
      if (playerNameProblem(s, d.info.name, d.id ?? undefined)) return;
      d.info.name = d.info.name.trim();
      if (d.id) {
        const x = s.players.find((p) => p.id === d.id);
        if (x) x.info = d.info;
      } else if (s.players.length < CUSTOM_LIMITS.players) s.players.push({ id: newId(s, 'p'), info: d.info });
      message = `已儲存 ${d.info.name}`;
      pdraft = null;
      custom.commit();
      return;
    } else if (data('data-askdel')) confirmDel = data('data-askdel');
    else if (act === 'nodel') confirmDel = null;
    else if (data('data-del')) {
      const id = data('data-del')!;
      if (tab === 'players') {
        s.players = s.players.filter((p) => p.id !== id);
        // The teams lose him too.
        for (const t of s.teams) t.members = t.members.filter((m) => !(m.src === 'custom' && m.id === id));
        if (pdraft?.id === id) pdraft = null;
      } else if (tab === 'teams') {
        s.teams = s.teams.filter((t) => t.id !== id);
        if (tdraft?.id === id) tdraft = null;
      } else s.retired = s.retired.filter((r) => r.key !== id);
      confirmDel = null;
      custom.commit();
      return;
    } else if (act === 'tnew') {
      tdraft = freshTeam();
      query = '';
      scrollTop();
    } else if (data('data-tedit')) {
      const t = s.teams.find((x) => x.id === data('data-tedit'));
      if (t) tdraft = clone(t);
      scrollTop();
    } else if (data('data-src')) {
      addSrc = data('data-src') as Source;
      query = '';
    } else if (data('data-add') && tdraft) {
      const m = JSON.parse(data('data-add')!) as TeamMember;
      const p = memberInfo(s, m);
      if (p && !hasMember(s, tdraft, p.name) && tdraft.members.length < CUSTOM_LIMITS.teamMax) tdraft.members.push(m);
    } else if (data('data-rm') && tdraft) tdraft.members.splice(Number(data('data-rm')), 1);
    else if (data('data-mv') && tdraft) {
      const [i, d] = data('data-mv')!.split(':').map(Number);
      const j = i + d;
      if (j >= 0 && j < tdraft.members.length) [tdraft.members[i], tdraft.members[j]] = [tdraft.members[j], tdraft.members[i]];
    } else if (act === 'tcancel') tdraft = null;
    else if (act === 'tsave' && tdraft) {
      const t = tdraft;
      if (teamProblem(s, t)) return;
      t.name = t.name.trim();
      t.abbr = t.abbr.trim().toUpperCase();
      if (t.id) {
        const i = s.teams.findIndex((x) => x.id === t.id);
        if (i >= 0) s.teams[i] = t;
      } else if (s.teams.length < CUSTOM_LIMITS.teams) s.teams.push({ ...t, id: newId(s, 't') });
      message = `已儲存 ${t.name}`;
      tdraft = null;
      custom.commit();
      return;
    } else return;
    renderCustom();
  });
  root.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (tab === 'players' && pdraft) {
      const p = pdraft.info;
      if (el.name === 'name') p.name = el.value;
      else if (el.name === 'number') {
        const n = Math.round(Number(el.value));
        if (Number.isFinite(n)) p.number = Math.max(0, Math.min(99, n));
      } else if (el.name === 'height') p.heightM = Number(el.value) / 100;
      else if (el.name.startsWith('r.')) {
        const k = el.name.slice(2) as keyof PlayerInfo['ratings'];
        p.ratings[k] = Number(el.value);
        root.querySelector(`[data-rv="${k}"]`)!.textContent = el.value;
      } else if (el.name === 'arch') pdraft.arch = el.value as ArchetypeId;
      else if (el.name === 'tpl') pdraft.tplOvr = Number(el.value);
      refreshPlayerBits();
    }
    if (tab === 'teams' && tdraft) {
      if (el.name === 'tname') tdraft.name = el.value;
      else if (el.name === 'tabbr') tdraft.abbr = el.value;
      else if (el.name === 'tprimary') tdraft.primary = el.value;
      else if (el.name === 'tsecondary') tdraft.secondary = el.value;
      else if (el.name === 'tquery') {
        query = el.value;
        // Redraw just the list, keeping the search box's focus.
        renderCustom();
        const box = root.querySelector<HTMLInputElement>('[name="tquery"]');
        box?.focus();
        box?.setSelectionRange(query.length, query.length);
        return;
      }
      refreshTeamBits();
    }
  });
}
