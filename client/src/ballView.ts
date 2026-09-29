import * as THREE from 'three';
import { BALL_RADIUS } from '@webnba/shared';

export class BallView {
  readonly mesh: THREE.Mesh;
  private readonly shadow: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 24, 16),
      new THREE.MeshStandardMaterial({ map: makeBallTexture(), roughness: 0.75 }),
    );
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    // Soft blob shadow keeps the ball readable in the air even outside the shadow map.
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(BALL_RADIUS * 1.1, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    scene.add(this.shadow);
  }

  update(pos: THREE.Vector3, vel: { x: number; z: number }, dt: number): void {
    this.mesh.position.copy(pos);
    // Roll forward along the direction of travel.
    const speed = Math.hypot(vel.x, vel.z);
    if (speed > 0.05) {
      const axis = new THREE.Vector3(vel.z, 0, -vel.x).normalize();
      this.mesh.rotateOnWorldAxis(axis, (speed / BALL_RADIUS) * dt * 0.5);
    }
    this.shadow.position.set(pos.x, 0.006, pos.z);
    const h = Math.max(0, pos.y - BALL_RADIUS);
    this.shadow.scale.setScalar(1 + h * 0.25);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.08, 0.35 - h * 0.06);
  }
}

function makeBallTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#d8661f';
  ctx.fillRect(0, 0, 256, 128);
  // Pebble grain.
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 128, 1.5, 1.5);
  }
  ctx.strokeStyle = '#1a0d05';
  ctx.lineWidth = 3;
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  line(0, 64, 256, 64);
  line(64, 0, 64, 128);
  line(192, 0, 192, 128);
  ctx.beginPath();
  ctx.ellipse(0, 64, 40, 64, 0, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(256, 64, 40, 64, 0, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(128, 64, 40, 64, 0, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
