import { describe, expect, it } from 'vitest';
import { COURT, NO_INPUT, createGame, placePlayer, type GameState } from '../src';
import { GSW, LAL, run } from './helpers';

/** Practice with you (player 0) and two feeders, nobody holding the ball. */
function withFeeders(): GameState {
  const state = createGame({
    teams: [GSW, LAL],
    settings: { mode: 'practice', seed: 3, humanTeams: [0], feeders: true },
    playersPerTeam: [3, 0],
  });
  placePlayer(state, 0, 8, 0);
  return state;
}

/** Drops the ball loose and still at (x, z). */
function looseAt(state: GameState, x: number, z: number): void {
  const b = state.ball;
  b.mode = 'loose';
  b.holderId = -1;
  b.pos = { x, y: 0.12, z };
  b.vel = { x: 0, y: 0, z: 0 };
}

describe('practice feeders', () => {
  it('fetches a ball that rolled into the crowd, out of your reach', () => {
    const state = withFeeders();
    looseAt(state, 6, COURT.halfWidth + 2.6);
    run(state, 30 * 8);
    const b = state.ball;
    expect(b.mode).toBe('held');
    expect(b.holderId).toBeGreaterThan(0);
  });

  it('waits on a wing with it, then passes when you call for it', () => {
    const state = withFeeders();
    looseAt(state, 10, 3);
    run(state, 30 * 8);
    const feeder = state.players[state.ball.holderId];
    expect(feeder.slot).toBeGreaterThan(0);
    expect(Math.abs(feeder.pos.z)).toBeGreaterThan(3.5);
    run(state, 1, { ...NO_INPUT, pass: true });
    run(state, 30 * 3);
    expect(state.ball.mode).toBe('held');
    expect(state.ball.holderId).toBe(0);
    // Not an assist, and the feeders never took your control.
    expect(state.controlled[0]).toBe(0);
    expect(state.ball.assist?.passerId ?? -1).toBe(-1);
  });

  it('does not bump into you', () => {
    const state = withFeeders();
    placePlayer(state, 1, 8.2, 0);
    run(state, 1);
    expect(Math.hypot(state.players[0].pos.x - 8, state.players[0].pos.z)).toBeLessThan(0.05);
  });
});
