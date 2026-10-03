import { ROSTER_SEASON, ROSTER_VERSION, newCareer, upgradeCareer, type CareerState } from '@webnba/shared';
import { esc } from './boxscore';
import { CareerHub, careerSummary, type CareerHost } from './careerHub';
import { CreateForm } from './careerCreate';
import { cloud, cloudBackend, signInEmail, signInGoogle, signOut, watchAccount, type Account } from './cloud';
import { SLOTS, SaveStore, type Conflict, type Slot, type SlotInfo } from './saves';

/** localStorage, or a stand-in when the browser blocks it (saves then last until the tab closes). */
function storage(): Storage | Map<string, string> {
  try {
    return window.localStorage;
  } catch {
    return new Map<string, string>();
  }
}
const kv = storage();
const store = new SaveStore(
  kv instanceof Map ? { getItem: (k) => kv.get(k) ?? null, setItem: (k, v) => void kv.set(k, v), removeItem: (k) => void kv.delete(k) } : kv,
);
let account: Account | null = null;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' });
};

export type CareerScreen = 'account' | 'career' | 'create' | 'hub';

/** The career slot being played. */
let activeSlot: Slot = 1;
let hub: CareerHub;
let form: CreateForm;

/**
 * The account screen (sign in with Google or an e-mail link, sign out), the
 * career screen's three save slots, creating a player and opening a career.
 */
export function initCareerMenu(show: (screen: CareerScreen) => void, page: Omit<CareerHost, 'save'>): void {
  go = show;
  hub = new CareerHub({ ...page, save: saveCareer });
  form = new CreateForm($('#createForm'), (player) => page.preview(player, CREATE_TEAM));
  $('#createBtn').addEventListener('click', () => void createCareer());
  document.querySelectorAll<HTMLElement>('[data-to=career]').forEach((b) =>
    b.addEventListener('click', () => show('career')),
  );
  $('#authStatus').addEventListener('click', () => openAccount());
  $('#careerAccount').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-act=login]')) openAccount();
  });

  $('#googleBtn').addEventListener('click', async () => {
    accountMsg('正在前往 Google…');
    const err = await signInGoogle();
    if (err) accountMsg(`無法登入：${err}`, true);
  });
  $('#emailForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $<HTMLInputElement>('#emailInput').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      accountMsg('請輸入正確的 e-mail', true);
      return;
    }
    accountMsg('寄送中…');
    const err = await signInEmail(email);
    accountMsg(err ? `寄送失敗：${err}` : `登入連結已寄到 ${email}，到信箱點連結就會回到這裡並登入。`, !!err);
  });
  $('#signOutBtn').addEventListener('click', async () => {
    await signOut();
    accountMsg('已登出');
  });

  $('#careerSlots').addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]');
    if (!b) return;
    const slot = Number(b.dataset.slot) as SlotInfo['slot'];
    if (b.dataset.act === 'delete') {
      // Ask on the card itself rather than in a browser pop-up.
      const card = b.closest('.slot')!;
      card.classList.add('confirming');
      card.querySelector('.slotbtns')!.innerHTML =
        `<span class="ask">刪除後無法復原，確定刪除？</span>` +
        `<button type="button" class="danger" data-slot="${slot}" data-act="confirmDelete">刪除</button>` +
        `<button type="button" data-slot="${slot}" data-act="cancelDelete">取消</button>`;
    } else if (b.dataset.act === 'cancelDelete') {
      void renderCareer();
    } else if (b.dataset.act === 'confirmDelete') {
      try {
        await store.remove(slot);
      } catch {
        careerMsg('刪除失敗：連不上雲端，請稍後再試', true);
      }
      void renderCareer();
    } else if (b.dataset.act === 'create') {
      activeSlot = slot;
      createMsg('');
      show('create');
      form.reset();
    } else if (b.dataset.act === 'open') {
      const info = await store.load(slot);
      const career = info?.save.state as CareerState | undefined;
      if (career?.v === 1) upgradeCareer(career);
      if (!career || career.v !== 1) {
        careerMsg('這個存檔是舊版或已損壞，無法開啟', true);
        return;
      }
      activeSlot = slot;
      show('hub');
      hub.open(career);
    }
  });

  watchAccount(async (a) => {
    account = a;
    store.setOwner(a?.id ?? null, a && cloud ? cloudBackend() : null);
    renderAccount();
    if (a) {
      const { moved, left } = await store.adoptGuest();
      if (moved) careerMsg(`已把 ${moved} 個訪客存檔搬到雲端`);
      else if (left) careerMsg(`這台瀏覽器有 ${left} 個訪客存檔，但雲端存檔已滿，刪掉一格後重新整理就會搬上去`, true);
    }
    if (!$('#career').classList.contains('hidden')) void renderCareer();
  });
}

function accountMsg(text: string, bad = false): void {
  const el = $('#accountMsg');
  el.textContent = text;
  el.classList.toggle('bad', bad);
}

function careerMsg(text: string, bad = false): void {
  const el = $('#careerMsg');
  el.textContent = text;
  el.classList.toggle('bad', bad);
  el.classList.toggle('hidden', !text);
}

let go: (screen: CareerScreen) => void = () => {};

/** Colours the player wears while being created: the combine's blue squad. */
const CREATE_TEAM = { abbr: 'BLUE', name: '試訓藍隊', primary: '#1d4ed8', secondary: '#f4f4f4', players: [] };

function createMsg(text: string): void {
  const el = $('#createMsg');
  el.textContent = text;
  el.classList.toggle('hidden', !text);
}

async function createCareer(): Promise<void> {
  const problem = form.problem();
  if (problem) {
    createMsg(problem);
    return;
  }
  const d = form.draft;
  const career = newCareer({
    ...d,
    rosterVersion: ROSTER_VERSION,
    year: Number(ROSTER_SEASON.slice(0, 4)) || new Date().getFullYear(),
    seed: (Math.random() * 2 ** 31) | 0,
  });
  go('hub');
  hub.open(career);
  await hub.save();
  void renderCareer();
}

async function saveCareer(career: CareerState): Promise<string | null> {
  const res = await store.save(activeSlot, { summary: careerSummary(career), state: career });
  if (res.ok) return null;
  if ('conflict' in res) return '別台裝置有比較新的存檔，回「存檔」選擇要保留哪一份';
  return '連不上雲端，已先存在這台裝置，連上後會自動同步';
}

function openAccount(): void {
  go('account');
  accountMsg('');
  renderAccount();
}

function renderAccount(): void {
  $('#authStatus').textContent = account ? `已登入 · ${account.label}` : cloud ? '訪客 · 登入' : '訪客';
  $('#accountNoCloud').classList.toggle('hidden', !!cloud);
  $('#accountGuest').classList.toggle('hidden', !cloud || !!account);
  $('#accountUser').classList.toggle('hidden', !account);
  if (account) $('#accountName').textContent = account.label;
}

/** Every saved career (for quick games, practice and the menu background). */
export async function savedCareers(): Promise<{ slot: number; career: CareerState }[]> {
  const { slots } = await store.list();
  return slots.flatMap((info) => {
    const career = info?.save.state as CareerState | undefined;
    return info && career?.v === 1 ? [{ slot: info.slot, career: upgradeCareer(career) }] : [];
  });
}

/** Fills the career screen: who is playing, then the three slots. */
export async function renderCareer(): Promise<void> {
  $('#careerAccount').innerHTML = account
    ? `已登入 <b>${esc(account.label)}</b>，存檔會同步到雲端，換電腦也能接著玩。`
    : cloud
      ? `訪客模式：存檔只在這台瀏覽器。<button type="button" class="link" data-act="login">登入</button>後可以同步到雲端。`
      : '訪客模式：存檔只在這台瀏覽器。';
  $('#careerSlots').innerHTML = '<p class="sub">讀取存檔中…</p>';
  const { slots, offline, conflicts } = await store.list();
  if (offline) careerMsg('連不上雲端，先顯示這台電腦上的存檔', true);
  $('#careerSlots').innerHTML = SLOTS.map((slot) => slotCard(slot, slots[slot - 1])).join('');
  if (conflicts.length) showConflict(conflicts[0]);
}

function slotCard(slot: number, info: SlotInfo | null): string {
  if (!info) {
    return (
      `<div class="slot empty"><span class="slotno">${slot}</span><div class="slotbody"><b>空的存檔欄位</b><span>建立新球員，從選秀試訓開始</span></div>` +
      `<div class="slotbtns"><button type="button" class="primary" data-slot="${slot}" data-act="create">建立球員</button></div></div>`
    );
  }
  // Worked out again from the save, so it follows the current overall scale.
  const state = info.save.state as CareerState | undefined;
  const s = state?.v === 1 ? careerSummary(upgradeCareer(state)) : info.save.summary;
  return (
    `<div class="slot"><span class="slotno">${slot}</span><div class="slotbody"><b>${esc(s.player)}</b>` +
    `<span>${esc(s.team)} · ${esc(s.detail)}</span><span class="when">最後儲存 ${when(info.updatedAt)}</span></div>` +
    `<div class="slotbtns"><button type="button" class="primary" data-slot="${slot}" data-act="open">繼續</button>` +
    `<button type="button" data-slot="${slot}" data-act="delete">刪除</button></div></div>`
  );
}

/** Another device saved this slot after we last saw it: ask which copy to keep. */
function showConflict(c: Conflict): void {
  const box = $('#conflict');
  const line = (label: string, i: SlotInfo) => `<li><b>${label}</b>　${esc(i.save.summary.detail)}（${when(i.updatedAt)}）</li>`;
  box.innerHTML =
    `<p>存檔 ${c.slot} 在別台裝置有比較新的進度：</p><ul>${line('雲端', c.cloud)}${line('這台', c.local)}</ul>` +
    `<div class="buttons"><button type="button" class="primary" data-keep="cloud">載入雲端</button><button type="button" data-keep="local">用這台覆蓋</button></div>`;
  box.classList.remove('hidden');
  box.onclick = async (e) => {
    const keep = (e.target as HTMLElement).closest<HTMLElement>('[data-keep]')?.dataset.keep as 'cloud' | 'local' | undefined;
    if (!keep) return;
    box.classList.add('hidden');
    const res = await store.resolve(c, keep);
    if (!res.ok && 'conflict' in res) showConflict(res.conflict);
    void renderCareer();
  };
}
