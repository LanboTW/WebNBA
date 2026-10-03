import { newMyTeam, upgradeMyTeam, type MyTeamSave } from '@webnba/shared';
import { cloud, watchAccount, type Account } from './cloud';

/**
 * The account's MyTeam collection. A guest keeps it in this browser; signed
 * in, it lives next to the coins in the account_data row (data.myteam),
 * written with the same version check. Every change is saved here at once
 * and marked unsynced until the cloud has it, so a failed write is retried.
 * A guest's collection becomes the account's the first time they sign in,
 * unless the account already has one.
 */

const TABLE = 'account_data';
const GUEST_KEY = 'webnba.myteam';
const accountKey = (id: string) => `webnba.myteam.${id}`;
const dirtyKey = (id: string) => `webnba.myteamDirty.${id}`;

function readLocal(key: string): MyTeamSave | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? upgradeMyTeam(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
function writeLocal(key: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    // Storage unavailable: kept for this visit only.
  }
}

class MyTeamStore {
  private account: Account | null = null;
  private value: MyTeamSave | null = readLocal(GUEST_KEY);
  private listeners: (() => void)[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  /** False until the signed-in player's collection has been read. */
  ready = !cloud;
  offline = false;

  constructor() {
    watchAccount((a) => {
      this.account = a;
      this.ready = !a;
      this.queue = this.queue.then(() => this.load());
    });
  }

  /** The collection, made on first use (with the starter cards). */
  get save(): MyTeamSave {
    if (!this.value) {
      this.value = newMyTeam();
      this.commit();
    }
    return this.value;
  }

  get started(): boolean {
    return !!this.value;
  }

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  /** Saves after a change (call it after changing `save`). */
  commit(): void {
    const text = JSON.stringify(this.value);
    const a = this.account;
    if (!a || !cloud) {
      writeLocal(GUEST_KEY, text);
    } else {
      writeLocal(accountKey(a.id), text);
      writeLocal(dirtyKey(a.id), '1');
      this.queue = this.queue.then(() => this.flush(a));
    }
    this.emit();
  }

  /** Waits for every cloud write so far. */
  async synced(): Promise<void> {
    await this.queue;
  }

  private async read(): Promise<{ version: number; data: Record<string, unknown> } | null> {
    const { data, error } = await cloud!.from(TABLE).select('version, data').maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { version: data.version as number, data: data.data as Record<string, unknown> } : null;
  }

  private async flush(a: Account): Promise<void> {
    if (!cloud || this.account?.id !== a.id || !this.value) return;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const myteam = this.value;
        const row = await this.read();
        const at = new Date().toISOString();
        let ok: boolean;
        if (!row) {
          const { error } = await cloud.from(TABLE).insert({ data: { coins: 0, myteam }, version: 1, updated_at: at });
          if (error && error.code !== '23505') throw new Error(error.message);
          ok = !error;
        } else {
          const { data, error } = await cloud
            .from(TABLE)
            .update({ data: { ...row.data, myteam }, version: row.version + 1, updated_at: at })
            .eq('version', row.version)
            .select('version');
          if (error) throw new Error(error.message);
          ok = (data ?? []).length === 1;
        }
        if (ok) {
          if (this.value === myteam) writeLocal(dirtyKey(a.id), null);
          this.offline = false;
          return;
        }
      }
    } catch (e) {
      this.offline = true;
      console.warn('MyTeam is not synced yet:', e instanceof Error ? e.message : e);
    }
  }

  private async load(): Promise<void> {
    const a = this.account;
    if (!a || !cloud) {
      this.value = readLocal(GUEST_KEY);
      this.ready = true;
      this.emit();
      return;
    }
    // Unsynced changes from this browser win; else the cloud's copy.
    const local = readLocal(accountKey(a.id));
    const dirty = !!local && (() => {
      try {
        return localStorage.getItem(dirtyKey(a.id)) === '1';
      } catch {
        return false;
      }
    })();
    this.value = local;
    try {
      const row = await this.read();
      const remote = upgradeMyTeam(row?.data.myteam);
      if (this.account?.id !== a.id) return;
      if (dirty && local) {
        this.value = local;
        await this.flush(a);
      } else if (remote) {
        this.value = remote;
        writeLocal(accountKey(a.id), JSON.stringify(remote));
      } else {
        // A new account: the guest's collection moves over.
        const guest = readLocal(GUEST_KEY);
        if (guest) {
          this.value = guest;
          writeLocal(GUEST_KEY, null);
          writeLocal(accountKey(a.id), JSON.stringify(guest));
          writeLocal(dirtyKey(a.id), '1');
          await this.flush(a);
        }
      }
    } catch {
      this.offline = true;
    }
    this.ready = true;
    this.emit();
  }
}

export const myteam = new MyTeamStore();
