/**
 * npm run roster:update [-- --yes] [-- --commit]
 *
 * Pulls current teams from balldontlie, merges them into
 * shared/data/roster.json (ratings are kept; overrides.json is applied),
 * shows the changes and writes after confirmation.
 *
 *   --yes     no confirmation prompt (scheduled runs)
 *   --commit  run the tests, then commit the new roster to GitHub
 *             (needs GITHUB_TOKEN; pushing redeploys Pages and the server)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { BallDontLie } from './balldontlie';
import { commitFile } from './github';
import { describe, formatRoster, mergeRoster, validateRoster, type Overrides, type RawRoster } from './roster';
import { fail, loadLocalEnv, log, redact, secret } from './secrets';

const root = fileURLToPath(new URL('../../', import.meta.url));
const ROSTER = 'shared/data/roster.json';
const OVERRIDES = 'shared/data/overrides.json';
const args = new Set(process.argv.slice(2).filter((a) => a !== '--'));

async function main(): Promise<void> {
  loadLocalEnv(`${root}.env`);
  const key = secret('BALLDONTLIE_API_KEY');
  if (!key) fail('沒有 BALLDONTLIE_API_KEY。本機請寫在專案根目錄的 .env（不會進 git），Render 請設在環境變數。');
  const commit = args.has('--commit');
  const token = secret('GITHUB_TOKEN');
  if (commit && !token) fail('--commit 需要 GITHUB_TOKEN（只給 WebNBA repo Contents 讀寫權限的 fine-grained token）。');

  const path = (p: string) => `${root}${p}`;
  const before = readFileSync(path(ROSTER), 'utf8');
  const current = JSON.parse(before) as RawRoster;
  const overrides: Overrides = existsSync(path(OVERRIDES)) ? JSON.parse(readFileSync(path(OVERRIDES), 'utf8')) : {};
  delete (overrides as Record<string, unknown>)['$comment'];

  log('讀取 balldontlie 球員資料…');
  const { kind, players } = await new BallDontLie(key).players();
  log(`取得 ${players.length} 名球員（${kind === 'active' ? '現役名單' : '全部歷史球員，只追蹤轉隊'}）`);

  const { roster, changes } = mergeRoster(current, players, kind, overrides);
  const errors = validateRoster(roster);
  if (errors.length) fail(`更新後的名單有問題，不寫入：\n${errors.join('\n')}`);

  for (const c of changes) log(describe(c));
  const strip = (r: RawRoster) => formatRoster({ ...r, updated: undefined });
  if (strip(roster) === strip(current)) {
    log('名單沒有變動。');
    return;
  }

  if (!args.has('--yes')) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('寫入 roster.json？(y/N) ');
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') {
      log('沒有寫入。');
      return;
    }
  }

  const next = formatRoster(roster);
  writeFileSync(path(ROSTER), next);
  log(`已寫入 ${ROSTER}`);
  if (!commit) return;

  log('執行測試…');
  const test = spawnSync('npx', ['vitest', 'run'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (test.status !== 0) {
    writeFileSync(path(ROSTER), before);
    fail('測試失敗，已還原名單，不推送。');
  }

  const summary = changes.filter((c) => c.kind !== 'warn').map(describe);
  const sha = await commitFile({
    token: token!,
    repo: process.env.GITHUB_REPO || 'LanboTW/WebNBA',
    branch: process.env.GITHUB_BRANCH || 'main',
    path: ROSTER,
    content: next,
    message: `Roster update ${roster.updated}\n\n${summary.join('\n')}\n`,
  });
  log(sha === 'unchanged' ? 'GitHub 上的名單已是最新。' : `已推送到 GitHub（${sha.slice(0, 7)}），網頁與伺服器會自動重新部署。`);
}

main().catch((e: unknown) => fail('名單更新失敗：', redact(e instanceof Error ? e.message : String(e))));
