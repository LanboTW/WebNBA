import { cloud, watchAccount, type Account } from './cloud';

/**
 * The account's coins (and, later, everything else that belongs to the
 * account rather than a career slot). A guest keeps them in this browser;
 * signed in, they live in the account_data table (supabase/schema.sql), one
 * row per player, written with a version check so two devices never overwrite
 * each other. Changes are deltas: a write that fails is kept and retried, and
 * a guest's coins join the account the first time they sign in.
 */

const TABLE = 'account_data';
const GUEST_KEY = 'webnba.coins';
const pendingKey = (id: string) => `webnba.coinsPending.${id}`;

interface AccountData {
  coins: number;
}

function readNumber(key: string): number {
  try {
    return Number(localStorage.getItem(key) ?? 0) || 0;
  } catch {
    return 0;
  }
}
function writeNumber(key: string, v: number): void {
  try {
    if (v) localStorage.setItem(key, String(v));
    else localStorage.removeItem(key);
  } catch {
    // Storage unavailable: the number lives for this visit only.
  }
}

class Wallet {
  private account: Account | null = null;
  private value = readNumber(GUEST_KEY);
  private listeners: ((coins: number) => void)[] = [];
  /** Cloud writes run one at a time. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Set when the cloud table can't be reached (e.g. schema.sql not run yet). */
  offline = false;

  constructor() {
    watchAccount((a) => {
      this.account = a;
      this.queue = this.queue.then(() => this.load());
    });
  }

  get coins(): number {
    return this.value;
  }

  /** Calls back now and on every change. */
  watch(cb: (coins: number) => void): void {
    this.listeners.push(cb);
    cb(this.value);
  }

  private set(v: number): void {
    this.value = v;
    for (const cb of this.listeners) cb(v);
  }

  /** Adds (or, negative, spends) coins. Spending more than there is fails. */
  async add(delta: number): Promise<boolean> {
    delta = Math.round(delta);
    if (!delta) return true;
    if (this.value + delta < 0) return false;
    this.set(this.value + delta);
    const a = this.account;
    if (!a || !cloud) {
      writeNumber(GUEST_KEY, this.value);
      return true;
    }
    // Remember it until the cloud has it.
    writeNumber(pendingKey(a.id), readNumber(pendingKey(a.id)) + delta);
    this.queue = this.queue.then(() => this.flush(a));
    await this.queue;
    return true;
  }

  private async read(): Promise<{ version: number; data: AccountData } | null> {
    const { data, error } = await cloud!.from(TABLE).select('version, data').maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { version: data.version as number, data: data.data as AccountData } : null;
  }

  /** Writes the pending delta for this account into its row (creating it), retrying on a version clash. */
  private async flush(a: Account): Promise<void> {
    if (!cloud || this.account?.id !== a.id) return;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const delta = readNumber(pendingKey(a.id));
        const row = await this.read();
        const coins = Math.max(0, (row?.data.coins ?? 0) + delta);
        const at = new Date().toISOString();
        let ok: boolean;
        if (!row) {
          const { error } = await cloud.from(TABLE).insert({ data: { coins }, version: 1, updated_at: at });
          if (error && error.code !== '23505') throw new Error(error.message);
          ok = !error;
        } else {
          const { data, error } = await cloud
            .from(TABLE)
            .update({ data: { ...row.data, coins }, version: row.version + 1, updated_at: at })
            .eq('version', row.version)
            .select('version');
          if (error) throw new Error(error.message);
          ok = (data ?? []).length === 1;
        }
        if (ok) {
          writeNumber(pendingKey(a.id), readNumber(pendingKey(a.id)) - delta);
          if (this.account?.id === a.id) this.set(coins + readNumber(pendingKey(a.id)));
          this.offline = false;
          return;
        }
      }
    } catch (e) {
      // Kept as pending; tried again on the next change or sign-in.
      this.offline = true;
      console.warn('Coins are not synced yet:', e instanceof Error ? e.message : e);
    }
  }

  /** On sign-in: a guest's coins join the account, then the account's total shows. */
  private async load(): Promise<void> {
    const a = this.account;
    if (!a || !cloud) {
      this.set(readNumber(GUEST_KEY));
      return;
    }
    const guest = readNumber(GUEST_KEY);
    if (guest) {
      writeNumber(pendingKey(a.id), readNumber(pendingKey(a.id)) + guest);
      writeNumber(GUEST_KEY, 0);
    }
    // Show what we know at once, then the cloud's total.
    this.set(readNumber(pendingKey(a.id)));
    await this.flush(a);
    if (this.offline) return;
    try {
      const row = await this.read();
      if (this.account?.id === a.id) this.set((row?.data.coins ?? 0) + readNumber(pendingKey(a.id)));
    } catch {
      this.offline = true;
    }
  }
}

export const wallet = new Wallet();

/** "1,234" */
export const coinsText = (n: number) => Math.round(n).toLocaleString('en-US');
