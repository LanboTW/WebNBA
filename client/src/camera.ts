import * as THREE from 'three';

/** TV-style sideline camera that tracks the ball from the +z side. */
export class BroadcastCamera {
  readonly camera: THREE.PerspectiveCamera;
  private readonly look = new THREE.Vector3();
  private initialised = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 200);
  }

  update(focus: THREE.Vector3, dt: number): void {
    const narrow = this.camera.aspect < 1;
    const dist = narrow ? 24 : 16.5;
    const desiredPos = new THREE.Vector3(focus.x * 0.82, narrow ? 13 : 9.5, dist + focus.z * 0.25);
    const desiredLook = new THREE.Vector3(focus.x * 0.9, 1.4, focus.z * 0.35);
    if (!this.initialised) {
      this.camera.position.copy(desiredPos);
      this.look.copy(desiredLook);
      this.initialised = true;
    }
    const k = 1 - Math.exp(-dt * 3.5);
    this.camera.position.lerp(desiredPos, k);
    this.look.lerp(desiredLook, k);
    this.camera.lookAt(this.look);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
