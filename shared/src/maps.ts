import mapsJson from '../data/maps.json';
import type { TeamInfo } from './types';

/**
 * Maps (shared/data/maps.json, made in the content editor): how the court and
 * its surroundings look. Purely visual: the court's size and the rules never
 * change. A game draws full-court or half-court lines by its mode; any map
 * works for both.
 */

export const MAP_BASES = ['indoor', 'outdoor'] as const;
export const MAP_FLOORS = ['maple', 'darkwood', 'asphalt', 'concrete', 'sport'] as const;
export const MAP_TIMES = ['day', 'dusk', 'night'] as const;
/** Colours that follow the home team: primary, secondary, and darker shades of them. */
export const MAP_TEAM_COLORS = ['home', 'home2', 'home-dark', 'home2-dark'] as const;

export type MapBase = (typeof MAP_BASES)[number];
export type MapFloor = (typeof MAP_FLOORS)[number];
export type MapTime = (typeof MAP_TIMES)[number];

export const MAP_BASE_LABEL: Record<MapBase, string> = { indoor: '室內館', outdoor: '戶外' };
export const MAP_FLOOR_LABEL: Record<MapFloor, string> = { maple: '楓木', darkwood: '深色木', asphalt: '柏油', concrete: '水泥', sport: '塑膠地墊' };
export const MAP_TIME_LABEL: Record<MapTime, string> = { day: '白天', dusk: '黃昏', night: '夜晚' };
export const MAP_COLOR_LABEL: Record<(typeof MAP_TEAM_COLORS)[number], string> = {
  home: '主隊主色',
  home2: '主隊副色',
  'home-dark': '主隊主色（暗）',
  'home2-dark': '主隊副色（暗）',
};

/** A colour field: #rrggbb or one of MAP_TEAM_COLORS. */
export type MapColor = string;

export interface MapDef {
  id: string;
  name: string;
  base: MapBase;
  floor: MapFloor;
  /** The court surface; none = the floor's own colour. */
  court?: MapColor;
  /** Around the court (indoors the floor past the lines, outdoors the ground). */
  apron: MapColor;
  lines: MapColor;
  paint: MapColor;
  /** Inside the three-point line, outside the paint; none = the court colour. */
  arc?: MapColor;
  /** Centre circle picture under client/public/ (maps/<id>.webp); none = the home team's logo. */
  logo?: string;
  time: MapTime;
  /** Indoors: share of seats filled (0-1, default 1). */
  crowd?: number;
  /** Indoors: the stands (drawn dimmed). Default: the home team's colour. */
  seats?: MapColor;
  /** Outdoors: chain-link fence. */
  fence?: boolean;
  /** Outdoors: city blocks and trees past the fence. */
  buildings?: boolean;
}

export interface MapFile {
  $comment?: string;
  maps: MapDef[];
}

/** The NBA arena every team plays in unless its own map says otherwise. */
export const DEFAULT_ARENA: MapDef = {
  id: 'arena',
  name: '預設室內館',
  base: 'indoor',
  floor: 'maple',
  apron: 'home-dark',
  lines: '#ffffff',
  paint: 'home',
  time: 'day',
  crowd: 1,
  seats: 'home',
};

/** Street games' own court. */
export const DEFAULT_STREET: MapDef = {
  id: 'street',
  name: '街頭球場',
  base: 'outdoor',
  floor: 'asphalt',
  court: '#2f6b8a',
  apron: '#3d3f43',
  lines: '#f5f5f0',
  paint: '#c4553a',
  time: 'day',
  fence: true,
  buildings: true,
};

/** Built into the game: always there, never edited (the fallbacks). */
export const BUILTIN_MAPS: MapDef[] = [DEFAULT_ARENA, DEFAULT_STREET];
/** The maps in maps.json, in file order. */
export const MAPS: MapDef[] = (mapsJson as unknown as MapFile).maps;

export function findMap(id: string | undefined): MapDef | undefined {
  return id ? (BUILTIN_MAPS.find((m) => m.id === id) ?? MAPS.find((m) => m.id === id)) : undefined;
}

/** The map a game is played on: the one picked, else the home team's own, else the default for the mode. */
export function gameMap(picked: string | undefined, home: TeamInfo, street: boolean): MapDef {
  return findMap(picked) ?? (street ? DEFAULT_STREET : (findMap(home.map) ?? DEFAULT_ARENA));
}

/** A colour field as #rrggbb for this home team. */
export function mapColor(c: MapColor, home: TeamInfo): string {
  if (c === 'home') return home.primary;
  if (c === 'home2') return home.secondary;
  if (c === 'home-dark' || c === 'home2-dark') {
    const hex = c === 'home-dark' ? home.primary : home.secondary;
    const n = parseInt(hex.slice(1), 16);
    // 0.6 of the light (in linear terms), as the arena floor has always been.
    const ch = (s: number) => Math.round(((n >> s) & 255) * 0.79);
    return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
  }
  return c;
}

/** The file's key order for a map. */
export const MAP_KEYS: (keyof MapDef)[] = ['id', 'name', 'base', 'floor', 'court', 'apron', 'lines', 'paint', 'arc', 'logo', 'time', 'crowd', 'seats', 'fence', 'buildings'];

/**
 * maps.json's checks. `teams`: the custom teams, whose home maps have to
 * exist (so a map a team uses cannot be deleted). `pictures`: files under
 * client/public/maps/, when known.
 */
export function validateMaps(file: MapFile, teams: { abbr: string; map?: string }[] = [], pictures?: Set<string>): string[] {
  const errors: string[] = [];
  const ids = new Set<string>(BUILTIN_MAPS.map((m) => m.id));
  const color = (v: unknown) => typeof v === 'string' && (/^#[0-9a-fA-F]{6}$/.test(v) || (MAP_TEAM_COLORS as readonly string[]).includes(v));
  const colorRule = `要是 #RRGGBB 或 ${MAP_TEAM_COLORS.join('/')}`;
  for (const raw of file.maps) {
    const m = raw as unknown as Record<string, unknown>;
    const who = `地圖「${String(m.name || m.id || '?')}」`;
    if (typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(m.id)) errors.push(`${who}：id 只能用小寫英文、數字和 -`);
    else if (ids.has(m.id)) errors.push(`${who}：id「${m.id}」重複（arena、street 是內建的）`);
    ids.add(String(m.id));
    if (typeof m.name !== 'string' || !m.name.trim()) errors.push(`${who}：缺少名稱`);
    const oneOf = (k: string, list: readonly string[], label: string) => {
      if (!list.includes(m[k] as string)) errors.push(`${who}：${label}要是 ${list.join('/')}`);
    };
    oneOf('base', MAP_BASES, '底板');
    oneOf('floor', MAP_FLOORS, '地板材質');
    oneOf('time', MAP_TIMES, '時段');
    for (const k of ['apron', 'lines', 'paint']) if (!color(m[k])) errors.push(`${who}：${k} ${colorRule}`);
    for (const k of ['court', 'arc', 'seats']) if (m[k] !== undefined && !color(m[k])) errors.push(`${who}：${k} ${colorRule}`);
    if (m.crowd !== undefined && !(typeof m.crowd === 'number' && m.crowd >= 0 && m.crowd <= 1)) errors.push(`${who}：觀眾密度要是 0–1`);
    for (const k of ['fence', 'buildings']) if (m[k] !== undefined && typeof m[k] !== 'boolean') errors.push(`${who}：${k} 要是 true/false`);
    if (m.logo !== undefined) {
      if (typeof m.logo !== 'string' || !/^maps\/[a-z0-9][a-z0-9-]*\.webp$/.test(m.logo)) errors.push(`${who}：logo 要寫成 maps/<名稱>.webp`);
      else if (pictures && !pictures.has(m.logo)) errors.push(`${who}：client/public/ 裡沒有「${m.logo}」`);
    }
    for (const k of Object.keys(m)) if (k !== '$comment' && !(MAP_KEYS as string[]).includes(k)) errors.push(`${who}：不認識的欄位 ${k}`);
  }
  for (const t of teams) if (t.map !== undefined && !ids.has(t.map)) errors.push(`${t.abbr} 的主場是地圖「${t.map}」，它不存在（被隊伍用到的地圖不能刪）`);
  return errors;
}
