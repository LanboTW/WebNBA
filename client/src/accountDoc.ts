import { cloud, watchAccount, type Account } from './cloud';

/**
 * One piece of the account's saved data (the MyTeam collection, the custom
 * players and teams). A guest keeps it in this browser; signed in, it lives
 * next to the coins in the account_data row (data.<field>), written with the
 * same version check. Every change is saved here at once and marked unsynced
 * until the cloud has it, so a failed write is retried. A guest's copy becomes
 * the account's the first time they sign in, unless the account already has one.
 */

const TABLE = 'account_data';

export interface DocSpec<T> {
  /** The key in account_data.data, and the browser keys' stem. */
  field: string;
  /** Reads anything that looks like the document (null when it does not). */
  upgrade: (raw: unknown) => T | null;
  /** The document on first use. */
  create: () => T;
}

export class AccountDoc<T> {
  private account: Account | null = null;
  private value: T | null;
  private listeners: (() => void)[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  /** False until the signed-in player's copy has been read. */
  ready = !cloud;
  offline = false;

  constructor(private readonly spec: DocSpec<T>) {
    this.value = this.readLocal(this.guestKey);
    watchAccount((a) => {
      this.account = a;
      this.ready = !a;
      this.queue = this.queue.then(() => this.load());
    });
  }

  private get guestKey(): string {
    return `webnba.${this.spec.field}`;
  }
  private accountKey(id: string): string {
    return `webnba.${this.spec.field}.${id}`;
  }
  private dirtyKey(id: string): string {
    return `webnba.${this.spec.field}Dirty.${id}`;
  }

  private readLocal(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? this.spec.upgrade(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }
  private writeLocal(key: string, v: string | null): void {
    try {
      if (v === null) localStorage.removeItem(key);
      else localStorage.setItem(key, v);
    } catch {
      // Storage unavailable: kept for this visit only.
    }
  }

  /** The document, made on first use. */
  get save(): T {
    if (!this.value) {
      this.value = this.spec.create();
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
      this.writeLocal(this.guestKey, text);
    } else {
      this.writeLocal(this.accountKey(a.id), text);
      this.writeLocal(this.dirtyKey(a.id), '1');
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
    const field = this.spec.field;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const doc = this.value;
        const row = await this.read();
        const at = new Date().toISOString();
        let ok: boolean;
        if (!row) {
          const { error } = await cloud.from(TABLE).insert({ data: { coins: 0, [field]: doc }, version: 1, updated_at: at });
          if (error && error.code !== '23505') throw new Error(error.message);
          ok = !error;
        } else {
          const { data, error } = await cloud
            .from(TABLE)
            .update({ data: { ...row.data, [field]: doc }, version: row.version + 1, updated_at: at })
            .eq('version', row.version)
            .select('version');
          if (error) throw new Error(error.message);
          ok = (data ?? []).length === 1;
        }
        if (ok) {
          if (this.value === doc) this.writeLocal(this.dirtyKey(a.id), null);
          this.offline = false;
          return;
        }
      }
    } catch (e) {
      this.offline = true;
      console.warn(`${field} is not synced yet:`, e instanceof Error ? e.message : e);
    }
  }

  private async load(): Promise<void> {
    const a = this.account;
    if (!a || !cloud) {
      this.value = this.readLocal(this.guestKey);
      this.ready = true;
      this.emit();
      return;
    }
    // Unsynced changes from this browser win; else the cloud's copy.
    const local = this.readLocal(this.accountKey(a.id));
    const dirty =
      !!local &&
      (() => {
        try {
          return localStorage.getItem(this.dirtyKey(a.id)) === '1';
        } catch {
          return false;
        }
      })();
    this.value = local;
    try {
      const row = await this.read();
      const remote = this.spec.upgrade(row?.data[this.spec.field]);
      if (this.account?.id !== a.id) return;
      if (dirty && local) {
        this.value = local;
        await this.flush(a);
      } else if (remote) {
        this.value = remote;
        this.writeLocal(this.accountKey(a.id), JSON.stringify(remote));
      } else {
        // A new account: the guest's copy moves over.
        const guest = this.readLocal(this.guestKey);
        if (guest) {
          this.value = guest;
          this.writeLocal(this.guestKey, null);
          this.writeLocal(this.accountKey(a.id), JSON.stringify(guest));
          this.writeLocal(this.dirtyKey(a.id), '1');
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
