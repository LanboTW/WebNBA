/**
 * npm run roster:update [-- --yes] [-- --source balldontlie] [-- --relook]
 *
 * Pulls current team rosters (ESPN by default, no key needed; balldontlie
 * as a fallback, key in .env), merges them into
 * shared/data/roster.json (ratings are kept; overrides.json is applied),
 * shows the changes, writes after confirmation and runs the tests.
 * Publishing is a normal commit + push, which redeploys Pages and the server.
 *
 *   --yes                 no confirmation prompt
 *   --source balldontlie  use balldontlie instead of ESPN
 *   --relook              re-read skin, hair and beard from every headshot
 *                         (normally only players without a look are read)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { BallDontLie } from './balldontlie';
import { espnPlayers } from './espn';
import { fillLooks } from './lookPhotos';
import {
  describe,
  formatRoster,
  mergeRoster,
  normaliseName,
  validateRoster,
  type Overrides,
  type RawRoster,
  type SourceKind,
  type SourcePlayer,
} from './roster';
import { fail, loadLocalEnv, log, redact, secret } from './secrets';

const root = fileURLToPath(new URL('../../', import.meta.url));
const ROSTER = 'shared/data/roster.json';
const OVERRIDES = 'shared/data/overrides.json';
/** Past seasons' rosters: their MyTeam cards move to the 復刻 pack. */
const ARCHIVE = 'shared/data/card-archive.json';
const argv = process.argv.slice(2).filter((a) => a !== '--');
const args = new Set(argv);
const source = argv.find((a) => a.startsWith('--source='))?.slice(9) ?? (argv.includes('--source') ? argv[argv.indexOf('--source') + 1] : 'espn');

async function fetchSource(ours: string[]): Promise<{ kind: SourceKind; players: SourcePlayer[]; season: string | null }> {
  if (source === 'espn') {
    log('讀取 ESPN 各隊現役名單…');
    return { kind: 'active', ...(await espnPlayers(ours)) };
  }
  if (source === 'balldontlie') {
    loadLocalEnv(`${root}.env`);
    const key = secret('BALLDONTLIE_API_KEY');
    if (!key) fail('沒有 BALLDONTLIE_API_KEY。請寫在專案根目錄的 .env（格式見 .env.example，.env 不會進 git）。');
    log('讀取 balldontlie 球員資料…');
    return { ...(await new BallDontLie(key).players()), season: null };
  }
  return fail(`不認識的資料來源「${source}」，可用 espn（預設）或 balldontlie。`);
}

async function main(): Promise<void> {
  const path = (p: string) => `${root}${p}`;
  const before = readFileSync(path(ROSTER), 'utf8');
  const current = JSON.parse(before) as RawRoster;
  const overrides: Overrides = existsSync(path(OVERRIDES)) ? JSON.parse(readFileSync(path(OVERRIDES), 'utf8')) : {};
  delete (overrides as Record<string, unknown>)['$comment'];

  const { kind, players, season } = await fetchSource(current.teams.map((t) => t.abbr));
  log(`取得 ${players.length} 名球員（${kind === 'active' ? '現役名單' : '全部歷史球員，只追蹤轉隊'}）`);

  const { roster, changes } = mergeRoster(current, players, kind, overrides);
  const photos = new Map(players.flatMap((p) => (p.photo ? [[normaliseName(p.name), p.photo] as const] : [])));
  const looks = await fillLooks(roster.teams, (name) => photos.get(normaliseName(name)), args.has('--relook'));
  if (looks.analysed + looks.defaults) log(`外觀：分析 ${looks.analysed} 人的照片${looks.defaults ? `，${looks.defaults} 人沒有可用照片，用預設值` : ''}`);
  if (season && season !== current.season) {
    log(`球季：${current.season} → ${season}`);
    roster.season = season;
  }
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

  // A new season: last season's roster is kept, and its MyTeam cards become 復刻 cards.
  const archiveBefore = existsSync(path(ARCHIVE)) ? readFileSync(path(ARCHIVE), 'utf8') : null;
  if (roster.season !== current.season) {
    const archive = archiveBefore ? (JSON.parse(archiveBefore) as { $comment?: string; seasons: RawRoster[] }) : { seasons: [] };
    if (!archive.seasons.some((s) => s.season === current.season)) archive.seasons.push({ season: current.season, ratingKeys: current.ratingKeys, teams: current.teams });
    writeFileSync(path(ARCHIVE), `${JSON.stringify(archive, null, 1)}\n`);
    log(`${current.season} 球季的名單已存進 ${ARCHIVE}（MyTeam 復刻卡）`);
  }
  writeFileSync(path(ROSTER), formatRoster(roster));
  log(`已寫入 ${ROSTER}，執行測試…`);
  const test = spawnSync('npx', ['vitest', 'run'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (test.status !== 0) {
    writeFileSync(path(ROSTER), before);
    if (archiveBefore !== null) writeFileSync(path(ARCHIVE), archiveBefore);
    fail('測試失敗，已還原名單。');
  }
  log('測試通過。確認沒問題後 commit 並 push，GitHub Pages 和 Render 伺服器會自動重新部署。');
}

main().catch((e: unknown) => fail('名單更新失敗：', redact(e instanceof Error ? e.message : String(e))));
