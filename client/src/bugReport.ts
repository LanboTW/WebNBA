import { cloud } from './cloud';

/**
 * The game's version (client/package.json, put in at build time) and the
 * in-game bug report: a short form saved to the bug_reports table
 * (supabase/schema.sql). Anyone may send one; nobody can read them back
 * through the page, only from the Supabase dashboard.
 */
export const APP_VERSION: string = __APP_VERSION__;

const ISSUES = 'https://github.com/LanboTW/WebNBA/issues/new';
const CATEGORIES = [
  ['ui', '畫面'],
  ['controls', '操作'],
  ['crash', '當機／錯誤'],
  ['balance', '數值平衡'],
  ['other', '其他'],
] as const;
type Category = (typeof CATEGORIES)[number][0];
export const BUG_MAX = 1000;
const BUG_MIN = 5;
/** One report a minute from each device. */
const WAIT_MS = 60_000;
const LAST_KEY = 'webnba.bug.last';

/** Where the player was when they opened the form (screen, mode, score...). */
export type BugContext = Record<string, string | number>;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

let category: Category = 'other';
let context: BugContext = {};

function device(): BugContext {
  return {
    ua: navigator.userAgent.slice(0, 300),
    screen: `${window.innerWidth}×${window.innerHeight}`,
    touch: document.body.classList.contains('touch') ? 1 : 0,
  };
}

function lastSent(): number {
  try {
    return Number(localStorage.getItem(LAST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function markSent(): void {
  try {
    localStorage.setItem(LAST_KEY, String(Date.now()));
  } catch {
    // Private mode: the database's own limit still applies.
  }
}

/** One line of what goes along with the report, for the player to see. */
function contextText(): string {
  const all = { 版本: `v${APP_VERSION}`, ...context, ...device() };
  return Object.entries(all)
    .filter(([k]) => k !== 'ua' && k !== 'touch')
    .map(([k, v]) => (k === 'screen' ? `螢幕 ${v}` : k === '版本' ? v : `${k} ${v}`))
    .join('　·　');
}

function issueUrl(text: string): string {
  const body = `${text}\n\n---\n版本：v${APP_VERSION}\n${Object.entries({ ...context, ...device() })
    .map(([k, v]) => `${k}：${v}`)
    .join('\n')}`;
  return `${ISSUES}?title=${encodeURIComponent('[回報] ')}&body=${encodeURIComponent(body)}`;
}

function message(text: string, bad = false): void {
  const el = $('#bugMsg');
  el.textContent = text;
  el.classList.toggle('bad', bad);
  el.classList.toggle('hidden', !text);
}

function renderCategories(): void {
  $('#bugCats').innerHTML = CATEGORIES.map(
    ([id, label]) => `<button type="button" class="chip${id === category ? ' on' : ''}" data-cat="${id}">${label}</button>`,
  ).join('');
}

function refresh(): void {
  const text = $<HTMLTextAreaElement>('#bugText').value.trim();
  $('#bugCount').textContent = `${text.length} / ${BUG_MAX}`;
  $<HTMLAnchorElement>('#bugGithub').href = issueUrl(text);
}

export function openBugReport(ctx: BugContext = {}): void {
  context = ctx;
  renderCategories();
  $('#bugContext').textContent = contextText();
  message(cloud ? '' : '線上回報目前沒有開啟，請改用下方 GitHub 連結。', !cloud);
  $<HTMLButtonElement>('#bugSend').disabled = !cloud;
  refresh();
  $('#bugReport').classList.remove('hidden');
  $<HTMLTextAreaElement>('#bugText').focus({ preventScroll: true });
}

export function closeBugReport(): void {
  $('#bugReport').classList.add('hidden');
}

export function bugReportOpen(): boolean {
  return !$('#bugReport').classList.contains('hidden');
}

async function send(): Promise<void> {
  if (!cloud) return;
  const text = $<HTMLTextAreaElement>('#bugText').value.trim();
  if (text.length < BUG_MIN) return message(`請多寫一點（至少 ${BUG_MIN} 個字）：發生了什麼、在哪個畫面。`, true);
  const wait = Math.ceil((lastSent() + WAIT_MS - Date.now()) / 1000);
  if (wait > 0) return message(`剛剛才送出過，請 ${wait} 秒後再試。`, true);
  const btn = $<HTMLButtonElement>('#bugSend');
  btn.disabled = true;
  message('送出中…');
  const row = {
    version: APP_VERSION,
    category,
    body: text.slice(0, BUG_MAX),
    context: { ...context, ...device() },
  };
  // The database fills in the account when signed in (user_id defaults to auth.uid()).
  const { error } = await cloud.from('bug_reports').insert(row);
  btn.disabled = false;
  if (error) {
    console.error('Bug report failed:', error.message);
    return message('送出失敗，請稍後再試，或改用下方 GitHub 連結。', true);
  }
  markSent();
  $<HTMLTextAreaElement>('#bugText').value = '';
  refresh();
  message('已送出，謝謝回報！');
}

$('#bugCats').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cat]');
  if (!b) return;
  category = b.dataset.cat as Category;
  renderCategories();
});
$('#bugText').addEventListener('input', refresh);
$('#bugSend').addEventListener('click', () => void send());
$('#bugClose').addEventListener('click', closeBugReport);
// Keys typed here must not steer the game behind it.
$('#bugReport').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') closeBugReport();
});
$('#bugReport').addEventListener('keyup', (e) => e.stopPropagation());
for (const el of document.querySelectorAll<HTMLElement>('.vertext')) el.textContent = `v${APP_VERSION}`;
