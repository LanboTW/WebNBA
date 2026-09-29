import type { PlayerInfo } from './types';

export interface TeamInfo {
  abbr: string;
  name: string;
  primary: string;
  secondary: string;
  players: PlayerInfo[];
}

// Stage-1 placeholder roster; replaced by the swappable roster JSON in stage 2.
export const SAMPLE_TEAMS: TeamInfo[] = [
  {
    abbr: 'GSW',
    name: 'Golden State Warriors',
    primary: '#1D428A',
    secondary: '#FFC72C',
    players: [
      {
        name: 'Stephen Curry',
        number: 30,
        heightM: 1.88,
        position: 'PG',
        ratings: { speed: 85, jump: 60, close: 80, mid: 92, three: 97, handle: 95 },
      },
    ],
  },
  {
    abbr: 'LAL',
    name: 'Los Angeles Lakers',
    primary: '#552583',
    secondary: '#FDB927',
    players: [
      {
        name: 'LeBron James',
        number: 23,
        heightM: 2.06,
        position: 'SF',
        ratings: { speed: 80, jump: 78, close: 95, mid: 80, three: 76, handle: 88 },
      },
    ],
  },
];
