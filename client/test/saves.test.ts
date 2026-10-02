import { describe, expect, it } from 'vitest';
import { SaveStore, type Backend, type CareerSave, type CloudRow, type KeyValue, type Slot } from '../src/saves';

/** The cloud table with row level security already applied: one player's rows. */
class FakeCloud implements Backend {
  rows = new Map<number, CloudRow>();
  down = false;

  private check(): void {
    if (this.down) throw new Error('offline');
  }
  async list() {
    this.check();
    return [...this.rows.values()].map((r) => structuredClone(r));
  }
  async insert(slot: Slot, data: CareerSave, at: string) {
    this.check();
    if (this.rows.has(slot)) return false;
    this.rows.set(slot, { slot, version: 1, updated_at: at, data: structuredClone(data) });
    return true;
  }
  async update(slot: Slot, data: CareerSave, fromVersion: number, at: string) {
    this.check();
    const row = this.rows.get(slot);
    if (!row || row.version !== fromVersion) return false;
    this.rows.set(slot, { slot, version: fromVersion + 1, updated_at: at, data: structuredClone(data) });
    return true;
  }
  async remove(slot: Slot) {
    this.check();
    this.rows.delete(slot);
  }
}

function memory(): KeyValue {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

const career = (player: string, games = 0): CareerSave => ({ summary: { player, team: 'GSW', detail: `${games} 場` }, state: { games } });

/** Two browsers signed in to the same account. */
function twoDevices() {
  const db = new FakeCloud();
  const a = new SaveStore(memory());
  const b = new SaveStore(memory());
  a.setOwner('u1', db);
  b.setOwner('u1', db);
  return { db, a, b };
}

describe('career saves', () => {
  it('keeps guest saves in this browser only', async () => {
    const store = new SaveStore(memory());
    expect((await store.save(1, career('Rookie'))).ok).toBe(true);
    const { slots } = await store.list();
    expect(slots[0]?.save.summary.player).toBe('Rookie');
    expect(slots[1]).toBeNull();
    expect(store.signedIn).toBe(false);
  });

  it('saves to the cloud and sees it from another device', async () => {
    const { db, a, b } = twoDevices();
    await a.save(2, career('Rookie', 1));
    await a.save(2, career('Rookie', 2));
    expect(db.rows.get(2)?.version).toBe(2);
    const seen = await b.load(2);
    expect((seen?.save.state as { games: number }).games).toBe(2);
  });

  it('reports a conflict instead of overwriting a newer save from another device', async () => {
    const { db, a, b } = twoDevices();
    await a.save(1, career('Rookie', 1));
    await b.list(); // b has version 1
    await a.save(1, career('Rookie', 5)); // cloud moves to version 2
    const res = await b.save(1, career('Rookie', 2));
    expect(res.ok).toBe(false);
    if (res.ok || !('conflict' in res)) throw new Error('expected a conflict');
    expect((res.conflict.cloud.save.state as { games: number }).games).toBe(5);
    expect((db.rows.get(1)!.data.state as { games: number }).games).toBe(5);

    // Overwrite with this device's copy.
    const forced = await b.resolve(res.conflict, 'local');
    expect(forced.ok).toBe(true);
    expect((db.rows.get(1)!.data.state as { games: number }).games).toBe(2);
    expect(db.rows.get(1)!.version).toBe(3);
  });

  it('keeping the cloud copy settles a conflict without writing', async () => {
    const { db, a, b } = twoDevices();
    await a.save(1, career('Rookie', 1));
    await b.list();
    await a.save(1, career('Rookie', 5));
    const res = await b.save(1, career('Rookie', 2));
    if (res.ok || !('conflict' in res)) throw new Error('expected a conflict');
    await b.resolve(res.conflict, 'cloud');
    expect(db.rows.get(1)!.version).toBe(2);
    expect(((await b.load(1))!.save.state as { games: number }).games).toBe(5);
  });

  it('keeps a save made offline and sends it up later', async () => {
    const { db, a } = twoDevices();
    await a.save(3, career('Rookie', 1));
    db.down = true;
    const res = await a.save(3, career('Rookie', 4));
    expect(res.ok).toBe(false);
    expect('offline' in res && res.offline).toBe(true);
    const offline = await a.list();
    expect(offline.offline).toBe(true);
    expect((offline.slots[2]!.save.state as { games: number }).games).toBe(4);
    db.down = false;
    const back = await a.list();
    expect(back.conflicts).toHaveLength(0);
    expect((db.rows.get(3)!.data.state as { games: number }).games).toBe(4);
  });

  it('moves guest saves into free cloud slots after signing in', async () => {
    const db = new FakeCloud();
    const kv = memory();
    const store = new SaveStore(kv);
    await store.save(1, career('Guest A'));
    await store.save(2, career('Guest B'));
    await db.insert(1, career('Cloud'), 'x');
    store.setOwner('u1', db);
    expect(store.guestSlots()).toHaveLength(2);
    expect(await store.adoptGuest()).toEqual({ moved: 2, left: 0 });
    expect([...db.rows.values()].map((r) => r.data.summary.player).sort()).toEqual(['Cloud', 'Guest A', 'Guest B']);
    expect(store.guestSlots()).toHaveLength(0);
  });

  it('leaves guest saves alone when there is no room', async () => {
    const db = new FakeCloud();
    const store = new SaveStore(memory());
    await store.save(1, career('Guest'));
    for (const s of [1, 2, 3] as const) await db.insert(s, career(`Cloud ${s}`), 'x');
    store.setOwner('u1', db);
    expect(await store.adoptGuest()).toEqual({ moved: 0, left: 1 });
    expect(store.guestSlots()).toHaveLength(1);
  });

  it('deletes a slot everywhere', async () => {
    const { db, a, b } = twoDevices();
    await a.save(1, career('Rookie'));
    await b.list();
    await a.remove(1);
    expect(db.rows.size).toBe(0);
    expect((await b.list()).slots[0]).toBeNull();
  });
});
