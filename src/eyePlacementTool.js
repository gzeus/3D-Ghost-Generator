import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { makeEyePlacement, projectionFrame } from './eyeProjection.js';

export function createEyePlacementTool(canvas, camera, scene, onPlace) {
  let config = {}, actual, outside, gesture;
  const pointers = new Set(), raycaster = new THREE.Raycaster();
  const outlineGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(64 * 3), 3));
  const outline = new THREE.LineLoop(outlineGeometry, new THREE.LineBasicMaterial({ color: '#b9ebca', depthTest: false, transparent: true, opacity: 0.95 }));
  outline.renderOrder = 10; outline.visible = false; scene.add(outline);
  const enabled = () => config.enabled && config.ready && config.visible;
  function pick(event) {
    if (!enabled() || !actual || !outside) return null;
    const rect = canvas.getBoundingClientRect();
    camera.updateMatrixWorld();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), camera);
    const outerHit = outside.raycastFirst(raycaster.ray, THREE.DoubleSide);
    const actualHit = actual.raycastFirst(raycaster.ray, THREE.DoubleSide);
    // Empty space, existing openings, the underside, and inner back walls are not placement surfaces.
    if (!outerHit || !actualHit || outerHit.face.normal.dot(raycaster.ray.direction) >= -0.01 || Math.abs(actualHit.distance - outerHit.distance) > 0.01) return null;
    return makeEyePlacement(outerHit.point, raycaster.ray.direction, new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1), config);
  }
  function preview(event) {
    outline.visible = false;
    if (gesture?.dragged || pointers.size > 1) return;
    const eye = pick(event);
    if (!eye || ![eye.width, eye.height].every(v => Number.isFinite(v) && v > 0)) return;
    const frame = projectionFrame(eye.direction, eye.up), center = new THREE.Vector3(...eye.point);
    const p = outlineGeometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const angle = i / p.count * Math.PI * 2;
      const point = center.clone().addScaledVector(frame.right, eye.width / 2 * Math.cos(angle)).addScaledVector(frame.up, eye.height / 2 * Math.sin(angle));
      p.setXYZ(i, point.x, point.y, point.z);
    }
    p.needsUpdate = true; outlineGeometry.computeBoundingSphere(); outline.visible = true;
  }
  canvas.addEventListener('pointerdown', event => {
    pointers.add(event.pointerId);
    if (pointers.size > 1) { gesture = undefined; outline.visible = false; return; }
    if (event.button === 0 && enabled()) gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
  });
  canvas.addEventListener('pointermove', event => {
    if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) gesture.dragged = true;
    preview(event);
  });
  canvas.addEventListener('pointerup', event => {
    const click = gesture && gesture.id === event.pointerId && !gesture.dragged && pointers.size === 1 && event.button === 0;
    pointers.delete(event.pointerId); gesture = undefined; outline.visible = false;
    if (click) { const eye = pick(event); if (eye) onPlace(eye); }
  });
  canvas.addEventListener('pointercancel', event => { pointers.delete(event.pointerId); gesture = undefined; outline.visible = false; });
  canvas.addEventListener('pointerleave', () => { outline.visible = false; });
  canvas.addEventListener('wheel', () => { outline.visible = false; }, { passive: true });
  return {
    configure(value) { config = value; outline.visible = false; canvas.style.cursor = enabled() ? 'crosshair' : ''; },
    setGeometry(geometry) {
      actual?.geometry.dispose(); outside?.geometry.dispose();
      const actualGeometry = new THREE.BufferGeometry().setAttribute('position', geometry.attributes.position.clone()).setIndex(geometry.index.clone());
      actual = new MeshBVH(actualGeometry, { indirect: true });
      const { pickingPositions, pickingIndices } = geometry.userData;
      const outerGeometry = pickingPositions ? new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pickingPositions, 3)).setIndex(new THREE.BufferAttribute(pickingIndices, 1)) : actualGeometry.clone();
      outside = new MeshBVH(outerGeometry, { indirect: true });
      outline.visible = false;
    }
  };
}
