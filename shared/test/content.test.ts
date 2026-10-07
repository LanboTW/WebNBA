import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONTENT_WIDTH,
  NBA_TEAMS,
  checkContent,
  formatCustomTeams,
  formatJson,
  previewSpecial,
  validMonthDay,
  validateCustomTeams,
  type ContentMyTeam,
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
