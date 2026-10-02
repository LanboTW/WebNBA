import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  formatRoster,
  mapPosition,
  mergeRoster,
  normaliseName,
  parseHeight,
  validateCustomTeams,
  validateRoster,
  type RawRoster,
  type SourcePlayer,
} from '../src/roster';
import { ESPN_ABBR, toSource } from '../src/espn';
import { analyzeHeadshot, defaultLook, lookErrors, rollAccessories } from '../src/looks';
import { fillCustomLooks } from '../src/looksFill';
import { redact } from '../src/secrets';

// A frozen copy, so these tests keep passing after real roster updates.
const real = JSON.parse(readFileSync(new URL('../../shared/test/fixture-roster.json', import.meta.url), 'utf8')) as RawRoster;

/** The current roster as an "active players" feed: nothing changes. */
function feed(r: RawRoster): SourcePlayer[] {
  return r.teams.flatMap((t) =>
    t.players.map((p) => ({ name: p[0], team: t.abbr, number: p[1], heightM: p[2], position: null, draftYear: 2015 })),
  );
}
const team = (r: RawRoster, abbr: string) => r.teams.find((t) => t.abbr === abbr)!;
const names = (r: RawRoster, abbr: string) => team(r, abbr).players.map((p) => p[0]);

describe('roster update', () => {
  it('the live roster is valid and in the tool layout', () => {
    const text = readFileSync(new URL('../../shared/data/roster.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const live = JSON.parse(text) as RawRoster;
    expect(formatRoster(live)).toBe(text);
    expect(validateRoster(live)).toEqual([]);
  });

  it('changes nothing when the source agrees', () => {
    const { roster, changes } = mergeRoster(real, feed(real), 'active', {}, '2026-10-02');
    expect(changes).toEqual([]);
    expect(roster.teams).toEqual(real.teams);
    expect(roster.updated).toBe('2026-10-02');
  });

  it('moves a traded player with his ratings and new number', () => {
    const src = feed(real).map((p) => (p.name === 'Trae Young' ? { ...p, team: 'BOS', number: 3 } : p));
    const { roster, changes } = mergeRoster(real, src, 'active');
    expect(changes).toContainEqual({ kind: 'move', name: 'Trae Young', from: 'ATL', to: 'BOS' });
    expect(names(roster, 'ATL')).not.toContain('Trae Young');
    const trae = team(roster, 'BOS').players.find((p) => p[0] === 'Trae Young')!;
    expect(trae[1]).toBe(3);
    expect(trae[4]).toEqual(team(real, 'ATL').players[0][4]);
    expect(validateRoster(roster)).toEqual([]);
  });

  it('a better arrival starts and the weakest starter goes to the bench', () => {
    const src = feed(real).map((p) => (p.name === 'Trae Young' ? { ...p, team: 'BOS' } : p));
    const { roster } = mergeRoster(real, src, 'active');
    const bos = names(roster, 'BOS');
    expect(bos.slice(0, 5)).toContain('Trae Young');
    expect(bos.length).toBe(9);
  });

  it('drops players missing from an active feed and fills with newcomers', () => {
    const src = feed(real)
      .filter((p) => p.name !== 'Luke Kennard')
      .concat({ name: 'New Guy', team: 'ATL', number: 99, heightM: 1.96, position: 'G-F', draftYear: 2026 });
    const { roster, changes } = mergeRoster(real, src, 'active');
    expect(changes).toContainEqual({ kind: 'remove', name: 'Luke Kennard', team: 'ATL', reason: '不在現役名單' });
    expect(changes).toContainEqual({ kind: 'add', name: 'New Guy', team: 'ATL', tuned: false });
    const guy = team(roster, 'ATL').players.find((p) => p[0] === 'New Guy')!;
    expect(guy[3]).toBe('SG');
    expect(validateRoster(roster)).toEqual([]);
  });

  it('a full-history feed only follows known players to new teams', () => {
    const src = feed(real)
      .filter((p) => p.name !== 'Luke Kennard')
      .map((p) => (p.name === 'Jrue Holiday' ? { ...p, team: 'MIA' } : p))
      .concat({ name: 'Old Timer', team: 'ATL', number: 1, heightM: 2, position: 'F', draftYear: 1990 });
    const { roster, changes } = mergeRoster(real, src, 'all');
    expect(names(roster, 'ATL')).toContain('Luke Kennard');
    expect(names(roster, 'ATL')).not.toContain('Old Timer');
    expect(changes.some((c) => c.kind === 'move' && c.name === 'Jrue Holiday' && c.to === 'MIA')).toBe(true);
  });

  it('matches names regardless of accents, punctuation and suffixes', () => {
    expect(normaliseName('Luka Dončić')).toBe('luka doncic');
    expect(normaliseName("De'Aaron Fox")).toBe('deaaron fox');
    const src = feed(real).map((p) =>
      p.name === 'Jaren Jackson Jr.' ? { ...p, name: 'Jaren Jackson', team: 'LAL' } : p.name === 'P.J. Washington' ? { ...p, name: 'PJ Washington' } : p,
    );
    const { changes } = mergeRoster(real, src, 'active');
    expect(changes).toContainEqual({ kind: 'move', name: 'Jaren Jackson Jr.', from: 'MEM', to: 'LAL' });
    expect(changes.some((c) => c.kind === 'remove' && c.name === 'P.J. Washington')).toBe(false);
  });

  it('applies overrides and keeps teams within 5-10 players', () => {
    const src = feed(real).concat(
      Array.from({ length: 6 }, (_, i) => ({ name: `Rookie ${i}`, team: 'GSW', number: i, heightM: 2.0, position: 'F', draftYear: 2026 })),
    );
    const { roster, changes } = mergeRoster(real, src, 'active', { 'Rookie 3': { ratings: { three: 95, speed: 90 } } });
    const gsw = team(roster, 'GSW').players;
    expect(gsw.length).toBeLessThanOrEqual(10);
    expect(gsw.some((p) => p[0] === 'Rookie 3')).toBe(true);
    expect(changes).toContainEqual({ kind: 'add', name: 'Rookie 3', team: 'GSW', tuned: true });
    const r3 = gsw.find((p) => p[0] === 'Rookie 3')!;
    expect(r3[4][real.ratingKeys.indexOf('three')]).toBe(95);
  });

  it('refuses to strip a team below five players', () => {
    const gone = new Set(names(real, 'ATL').slice(0, 4));
    const { roster, changes } = mergeRoster(real, feed(real).filter((p) => !gone.has(p.name)), 'active');
    expect(names(roster, 'ATL')).toEqual(names(real, 'ATL'));
    expect(changes.some((c) => c.kind === 'warn' && c.text.startsWith('ATL'))).toBe(true);
  });

  it('parses API heights and positions', () => {
    expect(parseHeight('6-8')).toBe(2.03);
    expect(parseHeight('')).toBeNull();
    expect(mapPosition('G', 1.85)).toBe('PG');
    expect(mapPosition('F-C', 2.11)).toBe('C');
    expect(mapPosition('C-F', 2.08)).toBe('C');
  });

  it('reads ESPN athletes and maps their team abbreviations', () => {
    const p = toSource({ displayName: 'Stephen Curry', jersey: '30', height: 74, position: { abbreviation: 'G' }, experience: { years: 17 } }, 'GSW', 2027);
    expect(p).toEqual({ name: 'Stephen Curry', team: 'GSW', number: 30, heightM: 1.88, position: 'G', draftYear: 2009 });
    expect(toSource({ displayName: 'Two Way' }, 'ATL', null)).toMatchObject({ number: null, heightM: null, position: null, draftYear: null });
    const ours = new Set(real.teams.map((t) => t.abbr));
    for (const abbr of Object.values(ESPN_ABBR)) expect(ours.has(abbr)).toBe(true);
  });

  it('never prints secret values', () => {
    process.env.BALLDONTLIE_API_KEY = 'secret-key-123456';
    expect(redact('failed with secret-key-123456 in it')).toBe('failed with <BALLDONTLIE_API_KEY> in it');
    delete process.env.BALLDONTLIE_API_KEY;
  });
});

describe('custom teams', () => {
  const custom = JSON.parse(readFileSync(new URL('../../shared/data/custom-teams.json', import.meta.url), 'utf8'));
  const live = JSON.parse(readFileSync(new URL('../../shared/data/roster.json', import.meta.url), 'utf8')) as RawRoster;

  it('custom-teams.json is valid', () => {
    expect(validateCustomTeams(custom, live.teams)).toEqual([]);
  });

  it('every logo file exists and is at most 300 KB', () => {
    const logo = (path: string) => new URL(`../../client/public/logos/${path}`, import.meta.url);
    const paths = [...live.teams.map((t) => `nba/${t.abbr}.png`), ...custom.teams.flatMap((t: { logo?: string }) => (t.logo ? [t.logo] : []))];
    for (const p of paths) {
      expect(existsSync(logo(p)), `找不到 client/public/logos/${p}`).toBe(true);
      expect(statSync(logo(p)).size, `${p} 超過 300KB`).toBeLessThanOrEqual(300 * 1024);
    }
  });

  it('catches clashing abbreviations, bad colours and short benches', () => {
    const bad = {
      ratingKeys: real.ratingKeys,
      teams: [
        { abbr: 'GSW', name: 'Fake', primary: '#112233', secondary: '#445566', players: real.teams[0].players },
        { abbr: 'toolong', name: 'X', primary: 'red', secondary: '#445566', logo: '../x.gif', players: real.teams[0].players.slice(0, 3) },
      ],
    };
    const errors = validateCustomTeams(bad, real.teams);
    expect(errors).toContain('GSW：縮寫和其他隊伍重複');
    expect(errors.some((e) => e.includes('2–5'))).toBe(true);
    expect(errors.some((e) => e.includes('#RRGGBB'))).toBe(true);
    expect(errors.some((e) => e.includes('有 3 人'))).toBe(true);
    expect(errors.some((e) => e.includes('logo'))).toBe(true);
  });
});

describe('player looks', () => {
  /** A cut-out "headshot": head, neck and shoulders on transparent, with a hair cap of the given depth. */
  function headshot(skin: [number, number, number], hairPx: number) {
    const W = 260;
    const H = 190;
    const data = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const head = ((x - 130) / 40) ** 2 + ((y - 75) / 52) ** 2 <= 1;
        const neck = x >= 115 && x <= 145 && y >= 120 && y < 145;
        const body = x >= 40 && x <= 220 && y >= 145;
        if (!head && !neck && !body) continue;
        const hair = head && y < 23 + hairPx;
        const c = body ? [30, 60, 160] : hair ? [25, 20, 18] : skin;
        data.set([...c, 255], (y * W + x) * 4);
      }
    return { width: W, height: H, data };
  }

  it('reads skin tone and hair from a headshot', () => {
    expect(analyzeHeadshot(headshot([236, 196, 170], 20))).toMatchObject({ skin: 1, hair: 'short', beard: 'none' });
    expect(analyzeHeadshot(headshot([82, 52, 38], 0))).toMatchObject({ skin: 6, hair: 'bald' });
    expect(analyzeHeadshot({ width: 260, height: 190, data: new Uint8Array(260 * 190 * 4) })).toBeNull();
  });

  it('rolls the same accessories for the same name', () => {
    expect(rollAccessories('Stephen Curry')).toEqual(rollAccessories('Stephen Curry'));
    expect(lookErrors(defaultLook('x'))).toEqual([]);
    expect(lookErrors({ ...defaultLook('x'), skin: 9, hair: 'mullet', cape: true })).toHaveLength(3);
    expect(lookErrors({ hair: 'afro' }, true)).toEqual([]);
  });

  it('keeps a look when a player is traded', () => {
    const withLook = structuredClone(real);
    withLook.teams[0].players[0][5] = defaultLook(withLook.teams[0].players[0][0]);
    const name = withLook.teams[0].players[0][0];
    const src = feed(withLook).map((p) => (p.name === name ? { ...p, team: 'BOS' } : p));
    const { roster } = mergeRoster(withLook, src, 'active');
    expect(team(roster, 'BOS').players.find((p) => p[0] === name)![5]).toEqual(withLook.teams[0].players[0][5]);
    expect(formatRoster(roster)).toContain('"skin": 3, "hair": "short"');
  });

  it('looks:fill adds looks only where missing and leaves the rest of the file alone', () => {
    const text = [
      '{',
      '  "teams": [{ "abbr": "AB", "players": [',
      '      ["甲", 1, 1.9, "PG", [50, 50]],',
      '      ["乙", 2, 1.9, "SG", [50, 50], {"skin": 5, "hair": "afro"}]',
      '  ]}]',
      '}',
    ].join('\n');
    const { text: out, added } = fillCustomLooks(text);
    expect(added).toEqual(['甲']);
    const players = JSON.parse(out).teams[0].players;
    expect(players[0][5]).toEqual(defaultLook('甲'));
    expect(players[1][5]).toEqual({ skin: 5, hair: 'afro' });
    expect(out.split('\n')[1]).toBe(text.split('\n')[1]);
  });
});
