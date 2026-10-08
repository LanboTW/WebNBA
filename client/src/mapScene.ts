import type * as THREE from 'three';
import type { MapDef, TeamInfo } from '@webnba/shared';
import { buildIndoor, type Arena } from './arena';
import { buildOutdoor } from './streetCourt';

/**
 * The scene a map describes, for a full-court game or a street game (`half`:
 * one hoop, half-court lines). `home` gives the colours that follow the home team.
 */
export function buildMap(scene: THREE.Scene, map: MapDef, home: TeamInfo, half: boolean, showcase = false): Arena {
  return map.base === 'indoor' ? buildIndoor(scene, map, home, half, showcase) : buildOutdoor(scene, map, home, half);
}
