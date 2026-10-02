/**
 * Career save slots. A guest's saves live only in this browser; a signed-in
 * player's live in the cloud, with a copy kept here so a dropped connection
 * never loses a game. Every cloud save carries a version number: saving over
 * a newer version (made on another device) is refused and reported as a
 * conflict for the player to settle.
 */

export const SLOTS = [1, 2, 3] as const;
export type Slot = (typeof SLOTS)[number];

/** What a slot card shows without loading the whole career. */
export interface SaveSummary {
  player: string;
  team: string;
  /** e.g. "2026-27 第 3 季 · 12 勝 5 敗" */
  detail: string;
}

export interface CareerSave {
  summary: SaveSummary;
  /** The career itself; its shape belongs to the career code. */
  state: unknown;
}

export interface SlotInfo {
  slot: Slot;
  version: number;
  updatedAt: string;
  save: CareerSave;
}

/** A save that could not be written because the cloud copy is newer. */
export interface Conflict {
  slot: Slot;
  local: SlotInfo;
  cloud: SlotInfo;
}

export type SaveResult = { ok: true; info: SlotInfo } | { ok: false; conflict: Conflict } | { ok: false; offline: true; info: SlotInfo };

export interface CloudRow {
  slot: number;
  version: number;
  updated_at: string;
  data: CareerSave;
}

/** The cloud table, as seen by the signed-in player (row level security does the rest). */
export interface Backend {
  list(): Promise<CloudRow[]>;
  /** False when the slot already has a row. */
  insert(slot: Slot, data: CareerSave, at: string): Promise<boolean>;
  /** Writes only if the row is still at fromVersion; false otherwise. */
  update(slot: Slot, data: CareerSave, fromVersion: number, at: string): Promise<boolean>;
  remove(slot: Slot): Promise<void>;
}

export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Local copy of a slot; dirty when it has not reached the cloud yet. */
interface Cached extends SlotInfo {
  dirty?: boolean;
}

const fromRow = (r: CloudRow): SlotInfo => ({ slot: r.slot as Slot, version: r.version, updatedAt: r.updated_at, save: r.data });

export class SaveStore {
  /** Signed-in player's id, or null for a guest. */
  private owner: string | null = null;
  private backend: Backend | null = null;

  constructor(
    private readonly kv: KeyValue,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  get signedIn(): boolean {
    return !!this.backend;
  }

  /** Switch to a signed-in player (or back to the guest with null). */
  setOwner(owner: string | null, backend: Backend | null): void {
    this.owner = owner;
    this.backend = owner ? backend : null;
  }

  private key(slot: Slot, owner = this.owner): string {
    return `webnba.career.${owner ?? 'guest'}.${slot}`;
  }

  private read(slot: Slot, owner = this.owner): Cached | null {
    try {
      const raw = this.kv.getItem(this.key(slot, owner));
      return raw ? (JSON.parse(raw) as Cached) : null;
    } catch {
      return null;
    }
  }

  private write(info: Cached, owner = this.owner): void {
    try {
      this.kv.setItem(this.key(info.slot, owner), JSON.stringify(info));
    } catch {
      // Storage full or blocked: the cloud copy (if any) still has it.
    }
  }

  private drop(slot: Slot, owner = this.owner): void {
    try {
      this.kv.removeItem(this.key(slot, owner));
    } catch {
      // Nothing to clean up.
    }
  }

  /**
   * All three slots. Signed in, the cloud is the truth: its rows replace the
   * local copies, except local saves that never made it up, which are pushed
   * now (or reported as conflicts if the cloud moved on meanwhile).
   */
  async list(): Promise<{ slots: (SlotInfo | null)[]; offline: boolean; conflicts: Conflict[] }> {
    const local = SLOTS.map((s) => this.read(s));
    if (!this.backend) return { slots: local.map((c) => (c ? strip(c) : null)), offline: false, conflicts: [] };
    let rows: CloudRow[];
    try {
      rows = await this.backend.list();
    } catch {
      return { slots: local.map((c) => (c ? strip(c) : null)), offline: true, conflicts: [] };
    }
    const conflicts: Conflict[] = [];
    const slots: (SlotInfo | null)[] = [];
    for (const slot of SLOTS) {
      const row = rows.find((r) => r.slot === slot);
      const cloud = row ? fromRow(row) : null;
      const mine = local[slot - 1];
      if (mine?.dirty) {
        const res = await this.push(mine, cloud);
        if (res.ok) slots.push(res.info);
        else if ('conflict' in res) {
          conflicts.push(res.conflict);
          slots.push(cloud);
        } else slots.push(strip(mine));
        continue;
      }
      if (cloud) this.write(cloud);
      else this.drop(slot);
      slots.push(cloud);
    }
    return { slots, offline: false, conflicts };
  }

  async load(slot: Slot): Promise<SlotInfo | null> {
    const { slots } = await this.list();
    return slots[slot - 1];
  }

  /** Saves a slot: locally at once, then to the cloud when signed in. */
  async save(slot: Slot, save: CareerSave): Promise<SaveResult> {
    const prev = this.read(slot);
    const info: Cached = { slot, version: prev?.version ?? 0, updatedAt: this.now(), save, dirty: !!this.backend };
    if (!this.backend) {
      info.version += 1;
      this.write(info);
      return { ok: true, info: strip(info) };
    }
    this.write(info);
    return this.push(info, undefined);
  }

  /**
   * Sends a local save up. Its version is the cloud version it was based on;
   * if the cloud is no longer at that version, it is a conflict.
   * cloudKnown: the cloud row if already fetched (null = no row), undefined = not fetched.
   */
  private async push(info: Cached, cloudKnown: SlotInfo | null | undefined): Promise<SaveResult> {
    const backend = this.backend!;
    const at = info.updatedAt;
    try {
      const written = info.version === 0 ? await backend.insert(info.slot, info.save, at) : await backend.update(info.slot, info.save, info.version, at);
      if (written) {
        const done: SlotInfo = { slot: info.slot, version: info.version + 1, updatedAt: at, save: info.save };
        this.write(done);
        return { ok: true, info: done };
      }
      const cloud = cloudKnown !== undefined ? cloudKnown : await this.fetch(info.slot);
      if (!cloud) {
        // The row was deleted elsewhere: start it again.
        const again: Cached = { ...info, version: 0 };
        return this.push(again, null);
      }
      return { ok: false, conflict: { slot: info.slot, local: strip(info), cloud } };
    } catch {
      return { ok: false, offline: true, info: strip(info) };
    }
  }

  private async fetch(slot: Slot): Promise<SlotInfo | null> {
    const row = (await this.backend!.list()).find((r) => r.slot === slot);
    return row ? fromRow(row) : null;
  }

  /** Settles a conflict: keep the cloud copy, or write this device's over it. */
  async resolve(conflict: Conflict, keep: 'cloud' | 'local'): Promise<SaveResult> {
    if (keep === 'cloud') {
      this.write(conflict.cloud);
      return { ok: true, info: conflict.cloud };
    }
    const info: Cached = { ...conflict.local, version: conflict.cloud.version, dirty: true };
    this.write(info);
    return this.push(info, undefined);
  }

  async remove(slot: Slot): Promise<void> {
    if (this.backend) await this.backend.remove(slot);
    this.drop(slot);
  }

  /** Guest saves on this browser (shown so they can be moved up after signing in). */
  guestSlots(): SlotInfo[] {
    return SLOTS.map((s) => this.read(s, null)).filter((c): c is Cached => !!c).map(strip);
  }

  /**
   * Moves the guest saves into the signed-in player's empty slots. Returns
   * how many moved and how many stayed behind for lack of room.
   */
  async adoptGuest(): Promise<{ moved: number; left: number }> {
    const guests = this.guestSlots();
    if (!guests.length || !this.backend) return { moved: 0, left: guests.length };
    const { slots, offline } = await this.list();
    if (offline) return { moved: 0, left: guests.length };
    const free = SLOTS.filter((s) => !slots[s - 1]);
    let moved = 0;
    for (const g of guests) {
      const slot = free.shift();
      if (!slot) break;
      const res = await this.save(slot, g.save);
      if (!res.ok) {
        // Not up yet: do not delete the guest copy.
        break;
      }
      this.drop(g.slot, null);
      moved++;
    }
    return { moved, left: guests.length - moved };
  }
}

function strip(c: Cached): SlotInfo {
  return { slot: c.slot, version: c.version, updatedAt: c.updatedAt, save: c.save };
}
