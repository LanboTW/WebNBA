import type { Look } from './types';

/**
 * Team files (roster.json, custom-teams.json): the checks every team passes
 * and the one-player-per-line layout, shared by the roster tools and the
 * content editor.
 */

/** A player line: name, number, height (m), position, ratings (ratingKeys order), look. */
export type RawPlayer = [string, number, number, string, number[], Look?];

export interface RawTeam {
  abbr: string;
  name: string;
  primary: string;
  secondary: string;
  /** Menu heading for custom teams. */
  group?: string;
  /** Custom teams: a picture under client/public/logos/. */
  logo?: string;
  players: RawPlayer[];
}

export const TEAM_PLAYERS = { min: 5, max: 10 };

export const HAIR = ['bald', 'buzz', 'short', 'afro', 'twists', 'dreads', 'long', 'mohawk'] as const;
export const BEARD = ['none', 'stubble', 'full'] as const;
export const SLEEVE = ['none', 'left', 'right', 'both'] as const;
export const SHOE = ['white', 'black', 'team'] as const;
export const SOCKS = ['low', 'high'] as const;
/** Model types besides a standing player. */
export const BODY = ['wheelchair', 'homer', 'peter'] as const;

/** Field-by-field check, for roster.json, custom-teams.json and overrides.json. */
export function lookErrors(look: unknown, partial = false): string[] {
  if (typeof look !== 'object' || look === null) return ['外觀要是物件'];
  const l = look as Record<string, unknown>;
  const errors: string[] = [];
  const need = (k: string, ok: (v: unknown) => boolean, rule: string) => {
    if (l[k] === undefined ? !partial : !ok(l[k])) errors.push(`${k} ${rule}`);
  };
  const oneOf = (list: readonly string[]) => (v: unknown) => list.includes(v as string);
  const hex = (v: unknown) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
  need('skin', (v) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 6) || hex(v), '要是 1–6 或 #RRGGBB');
  need('hair', oneOf(HAIR), `要是 ${HAIR.join('/')}`);
  need('beard', oneOf(BEARD), `要是 ${BEARD.join('/')}`);
  need('headband', (v) => typeof v === 'boolean', '要是 true/false');
  need('sleeve', oneOf(SLEEVE), `要是 ${SLEEVE.join('/')}`);
  need('kneepad', (v) => typeof v === 'boolean', '要是 true/false');
  need('shoe', oneOf(SHOE), `要是 ${SHOE.join('/')}`);
  need('socks', oneOf(SOCKS), `要是 ${SOCKS.join('/')}`);
  if (l.hairColor !== undefined && !hex(l.hairColor)) errors.push('hairColor 要是 #RRGGBB');
  if (l.body !== undefined && !BODY.includes(l.body as (typeof BODY)[number])) errors.push(`body 要是 ${BODY.join('/')}`);
  const known = new Set(['skin', 'hair', 'hairColor', 'beard', 'headband', 'sleeve', 'kneepad', 'shoe', 'socks', 'body']);
  for (const k of Object.keys(l)) if (!known.has(k)) errors.push(`不認識的外觀欄位 ${k}`);
  return errors;
}

/** Rules every team follows, NBA or custom. */
export function validateTeams(teams: RawTeam[], ratingKeys: string[], heights: [number, number] = [1.6, 2.4], partialLooks = false): string[] {
  const errors: string[] = [];
  for (const t of teams) {
    if (!/^#[0-9a-fA-F]{6}$/.test(t.primary) || !/^#[0-9a-fA-F]{6}$/.test(t.secondary)) errors.push(`${t.abbr} 顏色要寫成 #RRGGBB`);
    if (t.players.length < TEAM_PLAYERS.min || t.players.length > TEAM_PLAYERS.max) errors.push(`${t.abbr} 有 ${t.players.length} 人`);
    const names = new Set<string>();
    for (const p of t.players) {
      if (names.has(p[0])) errors.push(`${t.abbr} 重複球員 ${p[0]}`);
      names.add(p[0]);
      if (p[4].length !== ratingKeys.length || p[4].some((v) => !(v >= 1 && v <= 99))) errors.push(`${p[0]} 能力值不正確`);
      if (!(p[2] >= heights[0] && p[2] <= heights[1])) errors.push(`${p[0]} 身高 ${p[2]} 不合理`);
      if (!['PG', 'SG', 'SF', 'PF', 'C'].includes(p[3])) errors.push(`${p[0]} 位置 ${p[3]} 不正確`);
      if (p[5] !== undefined) for (const e of lookErrors(p[5], partialLooks)) errors.push(`${p[0]} 外觀：${e}`);
    }
  }
  return errors;
}

/**
 * custom-teams.json: same rules as NBA teams, plus abbreviations that fit the
 * scoreboard and never collide. Fun teams may stretch heights a little, and a
 * look may set only some fields (just a wheelchair, say): the game fills in the rest.
 * `logos`: the files under client/public/logos/, when known.
 */
export function validateCustomTeams(custom: { ratingKeys: string[]; teams: RawTeam[] }, nba: { abbr: string }[], logos?: Set<string>): string[] {
  const errors = validateTeams(custom.teams, custom.ratingKeys, [1.4, 2.6], true);
  const seen = new Set(nba.map((t) => t.abbr));
  for (const t of custom.teams) {
    if (!/^[A-Z0-9]{2,5}$/.test(t.abbr)) errors.push(`${t.abbr}：縮寫要 2–5 個大寫英文或數字`);
    if (seen.has(t.abbr)) errors.push(`${t.abbr}：縮寫和其他隊伍重複`);
    seen.add(t.abbr);
    if (!t.name) errors.push(`${t.abbr}：缺少隊名`);
    if (t.logo !== undefined && (typeof t.logo !== 'string' || !/^[\w./-]+\.(png|webp|svg)$/i.test(t.logo) || t.logo.includes('..')))
      errors.push(`${t.abbr}：logo 要寫成 logos/ 底下的 .png／.webp／.svg 路徑，例如 "taiwan/tpe.png"`);
    else if (t.logo && logos && !logos.has(t.logo)) errors.push(`${t.abbr}：client/public/logos/ 裡沒有「${t.logo}」`);
  }
  return errors;
}

const LOOK_ORDER: (keyof Look)[] = ['skin', 'hair', 'hairColor', 'beard', 'headband', 'sleeve', 'kneepad', 'shoe', 'socks', 'body'];

/** A look on one line, fields always in the same order. */
export function formatLook(look: Look): string {
  const fields = LOOK_ORDER.filter((k) => look[k] !== undefined).map((k) => `${JSON.stringify(k)}: ${JSON.stringify(look[k])}`);
  return `{${fields.join(', ')}}`;
}

/** A player on one line (heights with two decimals, as written by hand). */
export function formatPlayer(p: RawPlayer): string {
  const q = JSON.stringify;
  return `[${q(p[0])}, ${p[1]}, ${p[2].toFixed(2)}, ${q(p[3])}, [${p[4].join(', ')}]${p[5] ? `, ${formatLook(p[5])}` : ''}]`;
}

/** custom-teams.json: the team's own fields on one line, then one player per line. */
export function formatCustomTeams(file: { $comment?: string; ratingKeys: string[]; teams: RawTeam[] }): string {
  const q = JSON.stringify;
  const team = (t: RawTeam) => {
    const head = [t.group !== undefined ? `"group": ${q(t.group)}` : '', `"abbr": ${q(t.abbr)}`, `"name": ${q(t.name)}`, `"primary": ${q(t.primary)}`, `"secondary": ${q(t.secondary)}`]
      .filter(Boolean)
      .join(', ');
    return [
      '  {',
      `    ${head},`,
      ...(t.logo ? [`    "logo": ${q(t.logo)},`] : []),
      '    "players": [',
      t.players.map((p) => `      ${formatPlayer(p)}`).join(',\n'),
      '    ]',
      '  }',
    ].join('\n');
  };
  return [
    '{',
    ...(file.$comment ? [`  "$comment": ${q(file.$comment)},`] : []),
    `  "ratingKeys": [${file.ratingKeys.map((k) => q(k)).join(', ')}],`,
    '  "teams": [',
    file.teams.map(team).join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
}
