import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { Backend, CareerSave, CloudRow, Slot } from './saves';

/**
 * Supabase: sign-in and the career_saves table (supabase/schema.sql). The URL
 * and publishable key are public by design; row level security keeps every
 * player to their own rows. No secret key ever reaches the page.
 */
const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const cloud: SupabaseClient | null = URL && KEY ? createClient(URL, KEY) : null;

const TABLE = 'career_saves';

export interface Account {
  id: string;
  /** Name for the menu: the Google name, else the part of the e-mail before the @. */
  label: string;
}

function account(user: User | null | undefined): Account | null {
  if (!user) return null;
  const meta = user.user_metadata as { full_name?: string; name?: string } | undefined;
  const label = meta?.full_name || meta?.name || user.email?.split('@')[0] || '玩家';
  return { id: user.id, label };
}

/** Calls back now and on every sign-in or sign-out (including returning from Google or an e-mail link). */
export function watchAccount(cb: (a: Account | null) => void): void {
  if (!cloud) {
    cb(null);
    return;
  }
  let last: string | null | undefined;
  const emit = (u: User | null | undefined) => {
    const a = account(u);
    if ((a?.id ?? null) === last) return;
    last = a?.id ?? null;
    cb(a);
  };
  cloud.auth.onAuthStateChange((_event, session) => emit(session?.user));
  void cloud.auth.getSession().then(({ data }) => emit(data.session?.user));
}

/** Where Google and e-mail links send the player back: this page, without any query or hash. */
const returnUrl = () => `${location.origin}${location.pathname}`;

export async function signInGoogle(): Promise<string | null> {
  if (!cloud) return '雲端存檔尚未設定';
  const { error } = await cloud.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: returnUrl() } });
  return error ? error.message : null;
}

export async function signInEmail(email: string): Promise<string | null> {
  if (!cloud) return '雲端存檔尚未設定';
  const { error } = await cloud.auth.signInWithOtp({ email, options: { emailRedirectTo: returnUrl() } });
  return error ? error.message : null;
}

export async function signOut(): Promise<void> {
  await cloud?.auth.signOut();
}

/** The career_saves table for the signed-in player. */
export function cloudBackend(): Backend {
  const db = cloud!;
  const fail = (error: { message: string } | null) => {
    if (error) throw new Error(error.message);
  };
  return {
    async list() {
      const { data, error } = await db.from(TABLE).select('slot, version, updated_at, data').order('slot');
      fail(error);
      return (data ?? []) as CloudRow[];
    },
    async insert(slot: Slot, data: CareerSave, at: string) {
      const { error } = await db.from(TABLE).insert({ slot, data, version: 1, updated_at: at });
      // 23505: the slot already has a row.
      if (error?.code === '23505') return false;
      fail(error);
      return true;
    },
    async update(slot: Slot, data: CareerSave, fromVersion: number, at: string) {
      const { data: rows, error } = await db
        .from(TABLE)
        .update({ data, version: fromVersion + 1, updated_at: at })
        .eq('slot', slot)
        .eq('version', fromVersion)
        .select('slot');
      fail(error);
      return (rows ?? []).length === 1;
    },
    async remove(slot: Slot) {
      const { error } = await db.from(TABLE).delete().eq('slot', slot);
      fail(error);
    },
  };
}
