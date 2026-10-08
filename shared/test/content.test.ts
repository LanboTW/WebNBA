import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONTENT_WIDTH,
  DEFAULT_ARENA,
  DEFAULT_PLANT,
  DEFAULT_STREET,
  MAPS,
  NBA_TEAMS,
  checkContent,
  formatCustomTeams,
  formatJson,
  gameMap,
  mapColor,
  previewSpecial,
  validMonthDay,
  validateCustomTeams,
  validateMaps,
  type ContentMyTeam,
  type MapDef,
  type MapFile,
  type Look,
  type RawTeam,
  type SpecialFile,
} from '../src';

const read = (f: string) => readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const special = (): SpecialFile => JSON.parse(read('special-cards.json'));
const myteam = (): ContentMyTeam => JSON.parse(read('myteam.json'));
// The card pictures (the folder is not in git until it has one).
const cardsDir = new URL('../../client/public/cards/', import.meta.url);
const images = new Set(existsSync(cardsDir) ? readdirSync(cardsDir).filter((f) => !f.startsWith('.')) : []);

describe('content files (the content editor)', () => {
  it('the shipped files pass the checks', () => {
    expect(checkContent(special(), myteam(), images).errors).toEqual([]);
  });

  it('the editor writes the files back as they are', () => {
    expect(formatJson(special(), CONTENT_WIDTH.special) + '\n').toBe(read('special-cards.json'));
    expect(formatJson(myteam(), CONTENT_WIDTH.myteam) + '\n').toBe(read('myteam.json'));
    expect(formatCustomTeams(JSON.parse(read('custom-teams.json')))).toBe(read('custom-teams.json'));
  });

  it('custom team logos: a path under logos/ that exists', () => {
    const file = JSON.parse(read('custom-teams.json')) as { ratingKeys: string[]; teams: RawTeam[] };
    const team = { ...file.teams[0], logo: 'custom/don.webp' };
    const check = (logos: string[]) => validateCustomTeams({ ...file, teams: [team] }, NBA_TEAMS, new Set(logos));
    expect(check(['custom/don.webp'])).toEqual([]);
    expect(check([]).some((e) => e.includes('沒有「custom/don.webp」'))).toBe(true);
    expect(validateCustomTeams({ ...file, teams: [{ ...team, logo: '../x.png' }] }, NBA_TEAMS).some((e) => e.includes('logo 要寫成'))).toBe(true);
  });

  it('custom players may set only a model type; an unknown one is caught', () => {
    const file = JSON.parse(read('custom-teams.json')) as { ratingKeys: string[]; teams: RawTeam[] };
    const team = file.teams.find((t) => t.abbr === 'DON')!;
    expect(team.players.find((p) => p[0] === '郭柏呈')![5]).toEqual({ body: 'wheelchair' });
    expect(validateCustomTeams({ ...file, teams: [team] }, NBA_TEAMS)).toEqual([]);
    const bad = { ...team, players: team.players.map((p, i) => (i ? p : ([...p.slice(0, 5), { body: 'robot' }] as unknown as RawTeam['players'][number]))) };
    expect(validateCustomTeams({ ...file, teams: [bad] }, NBA_TEAMS).some((e) => e.includes('body 要是'))).toBe(true);
    for (const body of ['homer', 'peter'] as const) {
      const toon = { ...team, players: team.players.map((p, i) => (i ? p : ([p[0], p[1], p[2], p[3], p[4], { body } as Look] as RawTeam['players'][number]))) };
      expect(validateCustomTeams({ ...file, teams: [toon] }, NBA_TEAMS)).toEqual([]);
    }
  });

  it('catches mistakes in plain words', () => {
    const s = special();
    const m = myteam();
    s.cards.push({ id: 'Bad Id', player: 'Nobody Known', ovr: 100, theme: 'nope' });
    s.cards.push({ ...s.cards[0] });
    m.holidays.push({ id: 'x', name: '測試', desc: '', from: '13-01', to: '02-30', levels: [] });
    m.packs = m.packs.filter((p) => p.id !== 'premium');
    m.packs.push({ id: 'p2', name: '測試包', price: 0, count: 12, guarantee: 'black', tiers: ['white'] });
    const { errors } = checkContent(s, m, images);
    const has = (text: string) => expect(errors.some((e) => e.includes(text)), text).toBe(true);
    has('id 只能用小寫英文');
    has('不在名單上，要選位置');
    has('總評要是 66–99');
    has('主題「nope」不存在');
    has('重複');
    has('日期要是 MM-DD');
    has('至少要 1 關');
    has('價格要是正整數');
    has('張數要是 1–10');
    has('保底等級比卡包能開出的等級還高');
    has('「premium」被關卡、任務或活動的獎勵用到');
  });

  it('maps: the shipped file passes, is written back as it is, and mistakes are caught', () => {
    const file = (): MapFile => JSON.parse(read('maps.json'));
    const teams = (JSON.parse(read('custom-teams.json')) as { teams: RawTeam[] }).teams;
    expect(validateMaps(file(), teams)).toEqual([]);
    expect(formatJson(file(), CONTENT_WIDTH.maps) + '\n').toBe(read('maps.json'));
    const ok = file().maps[0];
    const bad = (m: Partial<MapDef> & Record<string, unknown>, team?: RawTeam) => validateMaps({ maps: [{ ...ok, ...m } as MapDef] }, team ? [team] : [], new Set());
    const has = (errors: string[], text: string) => expect(errors.some((e) => e.includes(text)), text).toBe(true);
    has(bad({ id: 'Bad Id' }), 'id 只能用小寫英文');
    has(bad({ id: 'arena' }), '重複');
    has(bad({ name: '' }), '缺少名稱');
    has(bad({ base: 'space' as never }), '底板要是');
    has(bad({ floor: 'ice' as never }), '地板材質要是');
    has(bad({ time: 'noon' as never }), '時段要是');
    has(bad({ lines: 'white' }), 'lines 要是 #RRGGBB');
    has(bad({ seats: '#12345' }), 'seats 要是');
    has(bad({ crowd: 2 }), '觀眾密度');
    has(bad({ logo: 'x.png' }), 'logo 要寫成 maps/');
    has(bad({ logo: 'maps/x.webp' }), '裡沒有「maps/x.webp」');
    has(bad({ sky: 1 }), '不認識的欄位 sky');
    has(bad({ buildings: true }), '不認識的欄位 buildings');
    has(bad({ scenery: 'park' as never }), '周邊景觀要是');
    // The power plant's scenery and id are the built-in map's own.
    has(bad({ scenery: 'plant' }), '周邊景觀要是');
    has(bad({ id: 'plant' }), '重複');
    has(bad({}, { ...teams[0], map: 'gone' }), '被隊伍用到的地圖不能刪');
    expect(bad({ paint: 'home2-dark', arc: 'home' })).toEqual([]);
  });

  it('maps: colours that follow the home team, and which map a game uses', () => {
    const home = { ...NBA_TEAMS[0], primary: '#ff0000', secondary: '#0000c8' };
    expect(mapColor('home', home)).toBe('#ff0000');
    expect(mapColor('home2', home)).toBe('#0000c8');
    expect(mapColor('home-dark', home)).toBe('#c90000');
    expect(mapColor('#123456', home)).toBe('#123456');
    expect(gameMap(undefined, home, false)).toBe(DEFAULT_ARENA);
    expect(gameMap(undefined, home, true)).toBe(DEFAULT_STREET);
    expect(gameMap(undefined, { ...home, map: MAPS[0].id }, false)).toBe(MAPS[0]);
    // A missing map falls back; a picked one wins over the home team's.
    expect(gameMap(undefined, { ...home, map: 'gone' }, false)).toBe(DEFAULT_ARENA);
    expect(gameMap('street', { ...home, map: MAPS[0].id }, false)).toBe(DEFAULT_STREET);
    // The power plant is built in: pickable, and a team's home.
    expect(gameMap('plant', home, true)).toBe(DEFAULT_PLANT);
    expect(gameMap(undefined, { ...home, map: 'plant' }, false)).toBe(DEFAULT_PLANT);
  });

  it('custom teams: a home map has to exist and is written on its own line', () => {
    const file = JSON.parse(read('custom-teams.json')) as { ratingKeys: string[]; teams: RawTeam[] };
    const team = { ...file.teams[0], map: MAPS[0].id };
    const ids = new Set(['arena', 'street', ...MAPS.map((m) => m.id)]);
    expect(validateCustomTeams({ ...file, teams: [team] }, NBA_TEAMS, undefined, ids)).toEqual([]);
    expect(validateCustomTeams({ ...file, teams: [{ ...team, map: 'gone' }] }, NBA_TEAMS, undefined, ids).some((e) => e.includes('主場地圖「gone」不存在'))).toBe(true);
    const text = formatCustomTeams({ ...file, teams: [team] });
    expect(text).toContain(`    "map": "${MAPS[0].id}",\n    "players": [`);
    expect((JSON.parse(text) as { teams: RawTeam[] }).teams[0].map).toBe(MAPS[0].id);
  });

  it('days and previews', () => {
    expect(validMonthDay('02-29')).toBe(true);
    expect(validMonthDay('04-31')).toBe(false);
    expect(validMonthDay('1-05')).toBe(false);
    const s = special();
    const c = previewSpecial({ id: 'new', player: 'Someone New', ovr: 95, theme: 'xmas', position: 'C', heightM: 2.13, style: 'rim' }, s.themes);
    expect(c.tier).toBe('orange');
    expect(c.label).toBe('聖誕');
    expect(c.ratings.length).toBeGreaterThan(5);
  });
});
