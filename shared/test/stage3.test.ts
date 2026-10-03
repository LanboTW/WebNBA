import { describe, expect, it } from 'vitest';
import {
  COURT,
  HOOP_X,
  NO_INPUT,
  SHOT_SWEET,
  attackHoopX,
  canDunk,
  createGame,
  giveBall,
  placePlayer,
  requestSub,
  runSpeed,
  startFreeThrows,
  type GameEvent,
  type GameSettings,
  type GameState,
  type RuleToggles,
} from '../src';
import { commonFoul, shootingFoul } from '../src/fouls';
import { startPeriod } from '../src/rules';
import { GSW, LAL, liveGame, run, shootAt } from './helpers';

const ALL_RULES: RuleToggles = { fouls: true, violations: true, fatigue: true };
const NO_FOULS: RuleToggles = { ...ALL_RULES, fouls: false };

/** Team 0 alone on the floor (no defence): for violation drills. */
function soloGame(x: number, z: number, settings: Partial<GameSettings> = {}): GameState {
  const state = createGame({ teams: [GSW, LAL], settings: { seed: 1, humanTeams: [0], ...settings }, playersPerTeam: [5, 0] });
  state.phase = 'live';
  state.possession = 0;
  state.shotClockOn = true;
  giveBall(state, 0);
  state.controlled[0] = 0;
  placePlayer(state, 0, x, z);
  [
    [-9, -5],
    [-9, 5],
    [-6, -2.5],
    [-6, 2.5],
  ].forEach(([tx, tz], i) => placePlayer(state, i + 1, tx, tz));
  return state;
}

const has = (events: GameEvent[], pred: (e: GameEvent) => boolean) => events.some(pred);

describe('dunks', () => {
  it('athletic bigs dunk with sprint + shoot near the rim and usually finish', () => {
    let dunks = 0;
    let made = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const state = liveGame(-3, 0, seed, {}, [LAL, GSW]);
      const big = state.players.find((p) => p.team === 0 && p.id !== 0 && canDunk(p))!;
      expect(big).toBeDefined();
      placePlayer(state, 0, -8, 0);
      giveBall(state, big.id);
      state.controlled[0] = big.id;
      placePlayer(state, big.id, HOOP_X - 1.6, 0.4);
      const events = shootAt(state, SHOT_SWEET, 30, { sprint: true });
      const shot = events.find((e) => e.type === 'shot');
      if (shot?.type === 'shot' && shot.kind === 'dunk') dunks++;
      if (events.some((e) => e.type === 'score' && e.kind === 'dunk')) made++;
    }
    expect(dunks).toBe(10);
    expect(made).toBeGreaterThanOrEqual(8);
  });

  it('players who cannot get up to the rim lay it in instead', () => {
    const state = liveGame(HOOP_X - 1.6, 0.4);
    expect(canDunk(state.players[0])).toBe(false);
    const events = shootAt(state, SHOT_SWEET, 5, { sprint: true });
    const shot = events.find((e) => e.type === 'shot');
    expect(shot?.type === 'shot' && shot.kind).toBe('layup');
  });
});

describe('free throws', () => {
  function takeFreeThrow(state: GameState, after: number): GameEvent[] {
    return [...run(state, 20), ...shootAt(state, SHOT_SWEET, after)];
  }

  it('lines everyone up, shoots each attempt with the meter and goes live on the last release', () => {
    const state = liveGame(0, 0);
    startFreeThrows(state, 0, 2, null);
    expect(state.phase).toBe('freeThrow');
    const shooter = state.players[0];
    expect(shooter.pos.x).toBeCloseTo(HOOP_X - (COURT.freeThrowFromBaseline - 1.575), 3);
    // Two defenders on the low blocks.
    const low = state.players.filter((p) => p.team === 1 && Math.abs(p.pos.x - (COURT.halfLength - 2.2)) < 0.01);
    expect(low).toHaveLength(2);

    const first = takeFreeThrow(state, 70);
    expect(first).toContainEqual({ type: 'freeThrow', shooterId: 0, index: 1, total: 2 });
    expect(state.phase).toBe('freeThrow');
    // Nobody else may move during the free throw.
    expect(state.players[5].vel).toEqual({ x: 0, y: 0, z: 0 });

    const second = takeFreeThrow(state, 2);
    expect(state.phase).toBe('live');
    const makes = [...first, ...second].filter((e) => e.type === 'score' && e.kind === 'free').length;
    expect(shooter.stats.fta).toBe(2);
    expect(shooter.stats.ftm).toBe(makes);
    expect(shooter.stats.fga).toBe(0);
    expect(state.score[0]).toBe(makes);
  });

  it('awards an and-one on a make, or shots equal to the shot value on a miss', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const state = liveGame(HOOP_X - 1.2, 0.3, seed);
      shootAt(state, SHOT_SWEET, 1);
      const shot = state.ball.shot!;
      expect(shot).not.toBeNull();
      shootingFoul(state, shot, state.players[5]);
      expect(state.pendingFT?.total).toBe(shot.willMake ? 1 : 2);
      for (let i = 0; i < 120 && state.phase !== 'freeThrow'; i++) run(state, 1);
      expect(state.phase).toBe('freeThrow');
      expect(state.score[0]).toBe(shot.willMake ? 2 : 0);
      expect(state.players[5].stats.pf).toBe(1);
    }
  });
});

describe('fouls', () => {
  it('a non-shooting foul gives a side inbound and at least 14 on the shot clock', () => {
    const state = liveGame(3, 0);
    state.shotClock = 5;
    commonFoul(state, state.players[5], state.players[0], 'reach');
    expect(state.teamFouls[1]).toBe(1);
    expect(state.shotClock).toBe(14);
    for (let i = 0; i < 60 && state.phase !== 'inbound'; i++) run(state, 1);
    expect(state.inbound?.team).toBe(0);
    expect(Math.abs(state.inbound!.spot.z)).toBeGreaterThan(COURT.halfWidth);
  });

  it('in the bonus a common foul sends the fouled player to the line for two', () => {
    const state = liveGame(3, 0);
    state.teamFouls[1] = 4;
    const events: GameEvent[] = [];
    commonFoul(state, state.players[5], state.players[0], 'reach');
    events.push(...state.events);
    expect(events).toContainEqual(expect.objectContaining({ type: 'foul', kind: 'reach', shots: 2, bonus: true }));
    for (let i = 0; i < 60 && state.phase !== 'freeThrow'; i++) run(state, 1);
    expect(state.freeThrow).toMatchObject({ shooterId: 0, total: 2 });
  });

  it('two fouls in the late window also put a team in the bonus', () => {
    const state = liveGame(3, 0);
    state.gameClock = 10;
    commonFoul(state, state.players[5], state.players[0], 'reach');
    expect(state.pendingFT).toBeNull();
    state.phase = 'live';
    commonFoul(state, state.players[6], state.players[0], 'reach');
    expect(state.pendingFT?.total).toBe(2);
  });

  it('driving into a set defender is a charge; in the restricted area it is a block', () => {
    const calls = (defX: number, startX: number) => {
      const kinds: string[] = [];
      for (let seed = 1; seed <= 160; seed++) {
        const state = liveGame(startX, 0, seed, { humanTeams: [0, 1] });
        state.controlled[1] = 5;
        placePlayer(state, 5, defX, 0);
        const events = run(state, 30, { ...NO_INPUT, moveX: 1, sprint: true }, NO_INPUT);
        for (const e of events) if (e.type === 'foul') kinds.push(e.kind);
      }
      return kinds;
    };
    const charges = calls(HOOP_X - 4.5, HOOP_X - 8);
    expect(charges.length).toBeGreaterThan(3);
    expect(charges.every((k) => k === 'charge')).toBe(true);
    const blocks = calls(HOOP_X - 0.7, HOOP_X - 4.5);
    expect(blocks.length).toBeGreaterThan(3);
    expect(blocks.every((k) => k === 'block')).toBe(true);
  });

  it('a charge is a turnover for the offence', () => {
    const events: GameEvent[] = [];
    // Drive in until the charge is called.
    for (let seed = 1; seed <= 200 && !events.some((e) => e.type === 'foul'); seed++) {
      const s = liveGame(HOOP_X - 8, 0, seed, { humanTeams: [0, 1] });
      s.controlled[1] = 5;
      placePlayer(s, 5, HOOP_X - 4.5, 0);
      const ev = run(s, 30, { ...NO_INPUT, moveX: 1, sprint: true }, NO_INPUT);
      if (ev.some((e) => e.type === 'foul')) {
        events.push(...ev);
        expect(s.possession).toBe(1);
        expect(s.players[0].stats.tov).toBe(1);
        expect(s.players[0].stats.pf).toBe(1);
      }
    }
    expect(events).toContainEqual({ type: 'turnover', team: 0, reason: 'offFoul', playerId: 0 });
  });

  it('can be switched off', () => {
    const state = liveGame(3, 0, 1, { rules: NO_FOULS });
    commonFoul(state, state.players[5], state.players[0], 'reach');
    expect(state.events.some((e) => e.type === 'foul')).toBe(false);
    expect(state.phase).toBe('live');
  });
});

describe('violations', () => {
  it('three seconds in the lane', () => {
    const state = soloGame(HOOP_X - 2, 0.5);
    const events = run(state, 110);
    expect(events).toContainEqual({ type: 'turnover', team: 0, reason: 'threeSec', playerId: 0 });
  });

  it('eight seconds to cross half court', () => {
    const state = soloGame(-6, 3);
    const early = run(state, 200);
    expect(early.some((e) => e.type === 'turnover')).toBe(false);
    const events = run(state, 60);
    expect(events).toContainEqual({ type: 'turnover', team: 0, reason: 'eightSec', playerId: 0 });
  });

  it('backcourt: no going back once the ball is in the frontcourt', () => {
    const state = soloGame(1.5, 2);
    run(state, 5);
    expect(state.frontcourt).toBe(true);
    const events = run(state, 60, { ...NO_INPUT, moveX: -1 });
    expect(events).toContainEqual({ type: 'turnover', team: 0, reason: 'backcourt', playerId: 0 });
  });

  it('five seconds to inbound', () => {
    const state = liveGame(-3, 0);
    state.tipWinner = 1;
    startPeriod(state, 2);
    expect(state.inbound?.team).toBe(0);
    const events = run(state, 160);
    expect(events).toContainEqual(expect.objectContaining({ type: 'turnover', team: 0, reason: 'fiveSec' }));
    expect(state.possession).toBe(1);
  });

  it('defensive three seconds is a technical free throw, then the offence keeps the ball', () => {
    const state = liveGame(HOOP_X - 7.5, 5, 1, { humanTeams: [0, 1] });
    state.controlled[1] = 9;
    placePlayer(state, 9, HOOP_X - 2.5, 0.8);
    const events = run(state, 150, NO_INPUT, NO_INPUT);
    expect(events).toContainEqual(expect.objectContaining({ type: 'foul', kind: 'defThree', shots: 1 }));
    for (let i = 0; i < 90 && state.phase !== 'freeThrow'; i++) run(state, 1, NO_INPUT, NO_INPUT);
    expect(state.freeThrow?.total).toBe(1);
    expect(state.freeThrow?.after?.team).toBe(0);
    // Shoot it, then team 0 inbounds.
    run(state, 20, NO_INPUT, NO_INPUT);
    for (let i = 0; i < 40 && state.players[state.freeThrow!.shooterId].action !== 'release'; i++) {
      run(state, 1, { ...NO_INPUT, shoot: i < 15 }, NO_INPUT);
    }
    for (let i = 0; i < 120 && state.phase !== 'inbound'; i++) run(state, 1, NO_INPUT, NO_INPUT);
    expect(state.inbound?.team).toBe(0);
  });

  it('can be switched off', () => {
    const state = soloGame(HOOP_X - 2, 0.5, { rules: { ...ALL_RULES, violations: false } });
    const events = run(state, 150);
    expect(events.some((e) => e.type === 'turnover')).toBe(false);
  });
});

describe('inbounds', () => {
  it('a guard takes the ball out after a score, even with a big man closer', () => {
    const state = liveGame(0, 0);
    const s = -Math.sign(attackHoopX(1, state.period));
    const big = state.players.find((p) => p.team === 1 && p.info.position !== 'PG' && p.info.position !== 'SG')!;
    placePlayer(state, big.id, s * (COURT.halfLength - 0.5), 1.3);
    state.phase = 'dead';
    state.phaseTimer = 0;
    state.pendingInbound = { team: 1, spot: { x: s * (COURT.halfLength + 0.45), y: 0, z: 1.3 } };
    run(state, 1, NO_INPUT, NO_INPUT);
    expect(state.phase).toBe('inbound');
    expect(['PG', 'SG']).toContain(state.players[state.inbound!.passerId].info.position);
  });
});

describe('stamina and substitutions', () => {
  it('playing drains energy and slows a tired player down', () => {
    const state = liveGame(-10, 0);
    run(state, 300, { ...NO_INPUT, moveX: 1, sprint: true });
    expect(state.players[0].energy).toBeLessThan(0.99);
    const p = state.players[0];
    p.energy = 1;
    const fresh = runSpeed(p);
    p.energy = 0.2;
    expect(runSpeed(p)).toBeLessThan(fresh * 0.95);
  });

  it('no drain with fatigue switched off', () => {
    const state = liveGame(-10, 0, 1, { rules: { ...ALL_RULES, fatigue: false } });
    run(state, 300, { ...NO_INPUT, moveX: 1, sprint: true });
    expect(state.players[0].energy).toBe(1);
  });

  it('tired players are subbed out at the next dead ball and keep their stats on the bench', () => {
    const state = liveGame(-3, 0);
    const tired = state.players[1];
    tired.energy = 0.3;
    tired.stats.pts = 7;
    const name = tired.info.name;
    state.shotClock = 0.1;
    const events = run(state, 60);
    expect(events).toContainEqual(expect.objectContaining({ type: 'sub', team: 0, slotId: 1, outName: name }));
    expect(tired.rosterIdx).toBeGreaterThanOrEqual(5);
    const benched = state.bench[0].find((b) => b.info.name === name)!;
    expect(benched.stats.pts).toBe(7);
    expect(benched.energy).toBeCloseTo(0.3, 1);
  });

  it('manual substitutions wait for a dead ball', () => {
    const state = liveGame(-3, 0);
    expect(requestSub(state, 0, 2, 6)).toBe(true);
    run(state, 5);
    expect(state.players[2].rosterIdx).toBe(2);
    state.shotClock = 0.1;
    run(state, 60);
    expect(state.players[2].rosterIdx).toBe(6);
    expect(state.subQueue).toHaveLength(0);
  });

  it('six fouls and you are out', () => {
    const state = liveGame(-3, 0);
    state.players[8].stats.pf = 5;
    state.phase = 'live';
    commonFoul(state, state.players[8], state.players[0], 'reach');
    expect(state.events).toContainEqual(expect.objectContaining({ type: 'fouledOut', team: 1 }));
    run(state, 60);
    expect(state.players[8].stats.pf).toBe(0);
    expect(state.bench[1].some((b) => b.stats.pf === 6)).toBe(true);
    expect(requestSub(state, 1, 8, state.bench[1].find((b) => b.stats.pf === 6)!.rosterIdx)).toBe(false);
  });
});

describe('timeouts', () => {
  it('can be called with the ball and resumes with a side inbound', () => {
    const state = liveGame(-3, 2);
    const events = run(state, 1, { ...NO_INPUT, timeout: true });
    expect(events).toContainEqual({ type: 'timeout', team: 0, left: 4 });
    expect(state.phase).toBe('timeout');
    run(state, 1);
    const end = run(state, 1, { ...NO_INPUT, timeout: true });
    expect(end).toContainEqual({ type: 'timeoutEnd' });
    expect(state.phase).toBe('inbound');
    expect(state.inbound?.team).toBe(0);
    expect(Math.abs(state.inbound!.spot.z)).toBeGreaterThan(COURT.halfWidth);
  });

  it('ends on its own after 30 seconds', () => {
    const state = liveGame(-3, 2);
    run(state, 1, { ...NO_INPUT, timeout: true });
    run(state, 30 * 30 - 5);
    expect(state.phase).toBe('timeout');
    run(state, 10);
    expect(state.phase).toBe('inbound');
  });

  it('cannot be called on defence during live play', () => {
    const state = liveGame(-3, 2);
    giveBall(state, 5);
    state.possession = 1;
    run(state, 1, { ...NO_INPUT, timeout: true });
    expect(state.phase).toBe('live');
    expect(state.timeoutsLeft[0]).toBe(5);
  });

  it('late in the fourth quarter a timeout advances the ball to the frontcourt', () => {
    const state = liveGame(-3, 2);
    state.period = 4;
    state.gameClock = 20;
    // Team 0 attacks the -x hoop in the second half, so +x is its backcourt.
    placePlayer(state, 0, 5, 2);
    run(state, 1, { ...NO_INPUT, timeout: true });
    run(state, 1);
    run(state, 1, { ...NO_INPUT, timeout: true });
    expect(state.inbound?.spot.x).toBeCloseTo(-(COURT.halfLength - 8.53), 2);
  });
});
