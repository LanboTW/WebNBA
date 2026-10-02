import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type Quality = 'low' | 'medium' | 'high';
export type QualitySetting = Quality | 'auto';

const ORDER: Quality[] = ['low', 'medium', 'high'];

/** Anything in a scene that changes with the quality level (floor reflection, crowd size...). */
export interface QualityAware {
  setQuality(q: Quality, renderer: THREE.WebGLRenderer): void;
}

/**
 * Owns the renderer and post-processing. "auto" starts at the best level the
 * device class allows and steps down while the frame rate stays low.
 */
export class Graphics {
  readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloom: UnrealBloomPass;
  private readonly envMap: THREE.Texture;
  private setting: QualitySetting = 'auto';
  private level: Quality = 'high';
  private readonly cap: Quality;
  private aware: QualityAware | null = null;
  private scene: THREE.Scene | null = null;
  // Auto: frame time samples, skipping the first moments after a change.
  private sampleT = 0;
  private sampleFrames = 0;
  private settleT = 0;

  constructor(parent: HTMLElement, mobile: boolean) {
    this.cap = mobile ? 'medium' : 'high';
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setSize(window.innerWidth, window.innerHeight);
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    parent.appendChild(r.domElement);
    this.renderer = r;

    const pmrem = new THREE.PMREMGenerator(r);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // Multisampled target so the post-processed path keeps its anti-aliasing.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, target);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.5, 0.9);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.apply();
  }

  get quality(): Quality {
    return this.level;
  }

  setSetting(s: QualitySetting): void {
    this.setting = s;
    // An explicit choice is honoured even above the cap; only "auto" is capped.
    this.level = s === 'auto' ? this.cap : s;
    this.apply();
  }

  /** Switches to a new scene (a match or the menu background). */
  attach(scene: THREE.Scene, aware: QualityAware | null): void {
    this.scene = scene;
    this.aware = aware;
    this.apply();
  }

  render(scene: THREE.Scene, camera: THREE.Camera, dt: number): void {
    if (this.scene !== scene) this.attach(scene, null);
    if (this.level === 'high') {
      this.renderPass.scene = scene;
      this.renderPass.camera = camera;
      this.composer.render(dt);
    } else {
      this.renderer.render(scene, camera);
    }
    this.watchFrameRate(dt);
  }

  clear(): void {
    this.renderer.clear();
  }

  resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  private apply(): void {
    const q = this.level;
    const r = this.renderer;
    r.setPixelRatio(q === 'low' ? 1 : Math.min(window.devicePixelRatio, q === 'high' ? 2 : 1.5));
    r.shadowMap.enabled = q !== 'low';
    r.toneMappingExposure = q === 'high' ? 1.05 : 1;
    this.resize();
    if (this.scene) {
      this.scene.environment = q === 'low' ? null : this.envMap;
      this.scene.environmentIntensity = 0.35;
      // Materials compile differently with and without shadows / env maps.
      this.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) for (const m of [o.material].flat()) m.needsUpdate = true;
      });
    }
    this.aware?.setQuality(q, r);
    this.sampleT = this.sampleFrames = 0;
    this.settleT = 3;
  }

  /** Auto only: two seconds under ~40 fps drops one level. Never steps back up mid-session. */
  private watchFrameRate(dt: number): void {
    if (this.setting !== 'auto' || this.level === 'low' || document.hidden) return;
    if (this.settleT > 0) {
      this.settleT -= dt;
      return;
    }
    this.sampleT += dt;
    this.sampleFrames++;
    if (this.sampleT < 2) return;
    const fps = this.sampleFrames / this.sampleT;
    this.sampleT = this.sampleFrames = 0;
    if (fps < 40) {
      this.level = ORDER[ORDER.indexOf(this.level) - 1];
      this.apply();
    }
  }
}
