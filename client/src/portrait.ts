import * as THREE from 'three';
import type { PlayerInfo, TeamInfo } from '@webnba/shared';
import { buildPlayerModel, modelTop } from './playerModel';
import { kitFor } from './playerView';

/**
 * Card portraits for players without a photo: his 3D model, head and
 * shoulders, in the team's away kit. One small renderer draws them one at a
 * time; each picture is kept as a data URL for the rest of the visit.
 */

const W = 280;
const H = 210;
let renderer: THREE.WebGLRenderer | null = null;
const cache = new Map<string, Promise<string | null>>();
let queue: Promise<unknown> = Promise.resolve();

function draw(info: PlayerInfo, team: TeamInfo): string | null {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(W, H, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#40384a', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2);
  sun.position.set(1.2, 2.6, 2.4);
  scene.add(sun);
  const model = buildPlayerModel(info, kitFor(team, false));
  model.root.rotation.y = -0.25;
  scene.add(model.root);
  // Framed on the head, sitting or standing (the model is drawn at 2 m).
  const drop = 2 - (2 * modelTop(info)) / info.heightM;
  const camera = new THREE.PerspectiveCamera(26, W / H, 0.1, 20);
  camera.position.set(0.22, 1.9 - drop, 1.5);
  camera.lookAt(0, 1.83 - drop, 0);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  model.root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const m = o.material as THREE.Material | THREE.Material[];
      for (const x of Array.isArray(m) ? m : [m]) x.dispose();
    }
  });
  return url;
}

export function portrait(info: PlayerInfo, team: TeamInfo): Promise<string | null> {
  const key = `${info.name}|${team.abbr}`;
  let p = cache.get(key);
  if (!p) {
    p = queue.then(
      () =>
        new Promise<string | null>((resolve) =>
          requestAnimationFrame(() => {
            try {
              resolve(draw(info, team));
            } catch {
              resolve(null);
            }
          }),
        ),
    );
    queue = p;
    cache.set(key, p);
  }
  return p;
}
