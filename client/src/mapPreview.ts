import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { MapDef, TeamInfo } from '@webnba/shared';
import type { Arena } from './arena';
import { buildMap } from './mapScene';

/**
 * The map preview (the content editor's, and the quick screen's picker): the
 * game's own scene code, rendered small with a camera swaying along the near
 * sideline. One renderer, moved to whichever element asks; the scene is
 * rebuilt only when the map changes. It stops drawing once its element is
 * hidden or gone; showing it again starts it again.
 */

let renderer: THREE.WebGLRenderer | null = null;
let env: THREE.Texture | null = null;
let scene: THREE.Scene | null = null;
let arena: Arena | null = null;
let shown = '';
/** The element sets the size (its CSS box), not a 16:9 strip of its width. */
let fill = false;
let last = 0;
let half = false;
let raf = 0;
const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);

export function showMapPreview(el: HTMLElement, map: MapDef, home: TeamInfo, halfCourt: boolean, fillBox = false): void {
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
  fill = fillBox;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  fit();
  const next = JSON.stringify([map, home.abbr, home.primary, home.secondary, halfCourt]);
  if (next !== shown) {
    shown = next;
    if (scene) dispose(scene);
    scene = new THREE.Scene();
    arena = buildMap(scene, map, home, halfCourt);
    arena.setQuality('high', renderer);
    scene.environment = env;
    scene.environmentIntensity = 0.35;
    half = halfCourt;
  }
  if (!raf) {
    last = 0;
    raf = requestAnimationFrame(frame);
  }
}

/** The canvas follows its element's size. */
function fit(): void {
  const el = renderer!.domElement.parentElement!;
  const w = el.clientWidth || 480;
  const h = fill ? el.clientHeight || Math.round((w * 9) / 16) : Math.round((w * 9) / 16);
  const size = renderer!.getSize(new THREE.Vector2());
  if (size.x === w && size.y === h) return;
  renderer!.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function frame(now: number): void {
  // Gone, or hidden (display: none somewhere above it).
  if (!renderer || !scene || !renderer.domElement.isConnected || !renderer.domElement.offsetParent) {
    raf = 0;
    return;
  }
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  fit();
  arena?.update(dt);
  const cx = half ? 7 : 0;
  const r = half ? 17 : 25;
  const a = Math.sin(now / 5000) * 0.7;
  // Low enough to see past the court to the horizon.
  camera.position.set(cx + Math.sin(a) * r, half ? 7 : 9.5, Math.cos(a) * r);
  camera.lookAt(cx, 1, -3);
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
