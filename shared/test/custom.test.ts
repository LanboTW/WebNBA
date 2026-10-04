import { describe, expect, it } from 'vitest';
import {
  CUSTOM_LIMITS,
  NBA_TEAMS,
  customTeamInfo,
  emptyCustom,
  keepRetired,
  newId,
  playerNameProblem,
  playerRating,
  teamProblem,
  templateRatings,
  upgradeCustom,
  type CareerState,
  type CustomTeam,
  type PlayerInfo,
} from '../src';

const info = (name: string, ovr = 70): PlayerInfo => ({
  name,
  number: 7,
  heightM: 2.0,
  position: 'SF',
  ratings: templateRatings('SF', 'allround', 2.0, ovr),
});

describe('custom players and teams', () => {
  it('templates land on the overall asked for, inside 25-99', () => {
    for (const ovr of [50, 75, 90, 99]) {
      const r = templateRatings('PG', 'shooter', 1.9, ovr);
      expect(Math.abs(playerRating({ position: 'PG', ratings: r }) - ovr)).toBeLessThanOrEqual(1);
      for (const v of Object.values(r)) {
        expect(v).toBeGreaterThanOrEqual(CUSTOM_LIMITS.rating[0]);
        expect(v).toBeLessThanOrEqual(CUSTOM_LIMITS.rating[1]);
      }
    }
  });

  it('names must be new: not an NBA player, not another custom player', () => {
    const s = emptyCustom();
    s.players.push({ id: newId(s, 'p'), info: info('Jason Lin') });
    expect(playerNameProblem(s, '')).not.toBeNull();
    expect(playerNameProblem(s, NBA_TEAMS[0].players[0].name)).toContain('NBA');
    expect(playerNameProblem(s, 'jason lin')).toContain('同名');
    expect(playerNameProblem(s, 'jason lin', 'p1')).toBeNull();
    expect(playerNameProblem(s, '林小明')).toBeNull();
  });

  it('teams need a name, a free abbreviation and 5-13 players; custom members follow edits', () => {
    const s = emptyCustom();
    for (let i = 0; i < 6; i++) s.players.push({ id: newId(s, 'p'), info: info(`Custom ${i}`) });
    const team: CustomTeam = { id: '', name: '台北夜鷹', abbr: 'tpe', primary: '#000000', secondary: '#ffffff', members: [] };
    expect(teamProblem(s, team)).toContain('至少');
    team.members = s.players.slice(0, 5).map((p) => ({ src: 'custom', id: p.id }));
    expect(teamProblem(s, team)).toBeNull();
    expect(teamProblem(s, { ...team, abbr: 'GSW' })).toContain('NBA');
    team.members.push({ src: 'nba', info: NBA_TEAMS[0].players[0] });
    const t = customTeamInfo(s, team);
    expect(t.abbr).toBe('TPE');
    expect(t.players).toHaveLength(6);
    s.players[0].info = info('Renamed', 90);
    expect(customTeamInfo(s, team).players[0].name).toBe('Renamed');
    s.players.shift();
    expect(customTeamInfo(s, team).players).toHaveLength(5);
  });

  it('keeps a retired career player once, newest first, up to the limit', () => {
    const s = emptyCustom();
    const career = (name: string, year: number) =>
      ({
        stage: 'retired',
        year,
        team: 'BOS',
        player: { info: info(name), age: 38 },
        history: [{ team: 'BOS' }, { team: 'LAL' }],
        hall: [{ me: true }],
      }) as unknown as CareerState;
    expect(keepRetired(s, career('Old Star', 2026))).toBe(true);
    expect(keepRetired(s, career('Old Star', 2026))).toBe(false);
    expect(s.retired[0]).toMatchObject({ team: 'LAL', seasons: 2, hall: true });
    expect(keepRetired(s, { ...career('Active', 2027), stage: 'season' } as CareerState)).toBe(false);
    for (let i = 0; i < 40; i++) keepRetired(s, career(`R ${i}`, 2030 + i));
    expect(s.retired).toHaveLength(CUSTOM_LIMITS.retired);
    expect(s.retired[0].info.name).toBe('R 39');
  });

  it('reads old or broken saves', () => {
    expect(upgradeCustom(null)).toBeNull();
    expect(upgradeCustom({ players: 'x' })).toEqual({ v: 1, next: 1, players: [], teams: [], retired: [] });
  });
});
