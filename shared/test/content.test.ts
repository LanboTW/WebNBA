import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTENT_WIDTH, checkContent, formatJson, previewSpecial, validMonthDay, type ContentMyTeam, type SpecialFile } from '../src';

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
