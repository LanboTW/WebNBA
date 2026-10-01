import { parseHeight, type SourceKind, type SourcePlayer } from './roster';
import { log } from './secrets';

/** BALLDONTLIE_API_BASE only exists for testing against a mock server. */
const API = process.env.BALLDONTLIE_API_BASE || 'https://api.balldontlie.io/v1';

interface ApiPlayer {
  first_name: string;
  last_name: string;
  position: string | null;
  height: string | null;
  jersey_number: string | null;
  draft_year: number | null;
  team: { abbreviation: string } | null;
}

interface Page {
  data: ApiPlayer[];
  meta?: { next_cursor?: number | null };
}

class HttpError extends Error {
  constructor(readonly status: number, path: string) {
    super(`balldontlie ${path} 回應 ${status}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Minimal client. The key goes only in the Authorization header; errors
 * mention the path and status, never the headers.
 */
export class BallDontLie {
  private last = 0;

  constructor(
    private readonly key: string,
    /** Milliseconds between requests (free tier: 5 per minute). */
    private gap = Number(process.env.BALLDONTLIE_GAP_MS) || 12_500,
  ) {}

  private async get(path: string): Promise<Page> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.last + this.gap - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      const res = await fetch(`${API}${path}`, { headers: { Authorization: this.key } });
      if (res.status === 429 && attempt < 5) {
        log('請求太頻繁，等 60 秒…');
        await sleep(60_000);
        continue;
      }
      if (res.status === 401 && path.startsWith('/players?')) {
        throw new Error('balldontlie 拒絕這把金鑰（401），請確認 BALLDONTLIE_API_KEY 是否正確');
      }
      if (!res.ok) throw new HttpError(res.status, path.split('?')[0]);
      return (await res.json()) as Page;
    }
  }

  private async all(path: string): Promise<ApiPlayer[]> {
    const out: ApiPlayer[] = [];
    let cursor: number | null | undefined;
    do {
      const sep = path.includes('?') ? '&' : '?';
      const page = await this.get(`${path}${sep}per_page=100${cursor ? `&cursor=${cursor}` : ''}`);
      out.push(...page.data);
      cursor = page.meta?.next_cursor;
      if (out.length % 1000 < 100) log(`  已讀取 ${out.length} 名球員…`);
    } while (cursor);
    return out;
  }

  /**
   * Current players if the key's plan allows it (ALL-STAR and up), otherwise
   * every player in the database (free plan), which only tells us teams.
   */
  async players(): Promise<{ kind: SourceKind; players: SourcePlayer[] }> {
    try {
      const active = await this.all('/players/active');
      return { kind: 'active', players: active.map(toSource) };
    } catch (e) {
      if (!(e instanceof HttpError) || (e.status !== 401 && e.status !== 403)) throw e;
      log('這把金鑰不能讀現役名單（需要 ALL-STAR 方案），改用免費方案：只追蹤既有球員的轉隊。');
      log('免費方案每分鐘只能請求 5 次，讀完全部球員約需 10–15 分鐘。');
      return { kind: 'all', players: (await this.all('/players')).map(toSource) };
    }
  }
}

function toSource(p: ApiPlayer): SourcePlayer {
  const number = p.jersey_number !== null && /^\d+$/.test(p.jersey_number) ? Number(p.jersey_number) : null;
  return {
    name: `${p.first_name} ${p.last_name}`.trim(),
    team: p.team?.abbreviation ?? null,
    number,
    heightM: parseHeight(p.height),
    position: p.position,
    draftYear: p.draft_year,
  };
}
