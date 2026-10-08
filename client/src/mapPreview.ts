import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { MapDef, TeamInfo } from '@webnba/shared';
import { buildMap } from './mapScene';

/**
 * The content editor's map preview: the game's own scene code, rendered small
 * with a camera swaying along the near sideline. One renderer, kept between
 * redraws of the editor; the scene is rebuilt only when the map changes.
 */

let renderer: THREE.WebGLRenderer | null = null;
let env: THREE.Texture | null = null;
let scene: THREE.Scene | null = null;
let shown = '';
let half = false;
let raf = 0;
const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);

export function showMapPreview(el: HTMLElement, map: MapDef, home: TeamInfo, halfCourt: boolean): void {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    const pmrem = new THREE.PMREMGenerator(renderer);
    env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }
  const canvas = renderer.domElement;
  if (canvas.parentElement !== el) el.appendChild(canvas);
  const w = el.clientWidth || 480;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setSize(w, Math.round((w * 9) / 16));
  const next = JSON.stringify([map, home.abbr, home.primary, home.secondary, halfCourt]);
  if (next !== shown) {
    shown = next;
    if (scene) dispose(scene);
    scene = new THREE.Scene();
    buildMap(scene, map, home, halfCourt).setQuality('high', renderer);
    scene.environment = env;
    scene.environmentIntensity = 0.35;
    half = halfCourt;
  }
  if (!raf) raf = requestAnimationFrame(frame);
}

function frame(now: number): void {
  if (!renderer || !scene || !renderer.domElement.isConnected) {
    raf = 0;
    return;
  }
  const cx = half ? 7 : 0;
  const r = half ? 17 : 25;
  const a = Math.sin(now / 5000) * 0.7;
  camera.position.set(cx + Math.sin(a) * r, half ? 8 : 11, Math.cos(a) * r);
  camera.lookAt(cx, 0, 0);
  renderer.render(scene, camera);
  raf = requestAnimationFrame(frame);
}

function dispose(s: THREE.Scene): void {
  s.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    for (const mat of ([] as THREE.Material[]).concat((m.material as THREE.Material | THREE.Material[] | undefined) ?? [])) {
      (mat as THREE.MeshStandardMaterial).map?.dispose();
      mat.dispose();
    }
  });
}
