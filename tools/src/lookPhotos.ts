import { analyzeHeadshot, decodePng, defaultLook, type Look } from './looks';
import type { RawTeam } from './roster';

/** Small version of an ESPN headshot: plenty for colour sampling, ~40 KB each. */
function smallPhoto(url: string): string {
  const u = new URL(url);
  return u.hostname === 'a.espncdn.com' ? `https://a.espncdn.com/combiner/i?img=${u.pathname}&w=260&h=190` : url;
}

async function readPhoto(url: string) {
  try {
    const res = await fetch(smallPhoto(url));
    if (!res.ok) return null;
    return analyzeHeadshot(decodePng(Buffer.from(await res.arrayBuffer())));
  } catch {
    return null;
  }
}

/**
 * Gives every player without a look one (and, with relook, re-reads everyone's
 * skin, hair and beard). Accessories already chosen are kept. Photos are only
 * read in memory, never saved.
 */
export async function fillLooks(
  teams: RawTeam[],
  photoOf: (name: string) => string | undefined,
  relook: boolean,
): Promise<{ analysed: number; defaults: number }> {
  const todo = teams.flatMap((t) => t.players).filter((p) => relook || !p[5]);
  let analysed = 0;
  let defaults = 0;
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const p = todo[next++];
      const url = photoOf(p[0]);
      const read = url ? await readPhoto(url) : null;
      const keep: Partial<Look> = p[5] ?? {};
      if (read) {
        analysed++;
        // A re-read replaces hair colour too, so drop the old one first.
        const { hairColor: _old, ...rest } = keep;
        // Defaults first: they bring the rolled accessories for anyone without them.
        p[5] = { ...defaultLook(p[0]), ...rest, ...read };
      } else if (!p[5]) {
        defaults++;
        p[5] = defaultLook(p[0]);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { analysed, defaults };
}

