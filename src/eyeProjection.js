import * as THREE from 'three';

// Store world-space projection frames, so orbiting the camera never moves a cut.
export function projectionFrame(direction, up) {
  const axis = new THREE.Vector3(...direction);
  const vertical = new THREE.Vector3(...up);
  if (![...direction, ...up].every(Number.isFinite) || axis.lengthSq() < 1e-12) throw new Error('Invalid eye projection direction.');
  axis.normalize();
  const right = axis.clone().cross(vertical);
  if (right.lengthSq() < 1e-12) throw new Error('Invalid eye projection orientation.');
  right.normalize();
  return { direction: axis, right, up: right.clone().cross(axis).normalize() };
}

export function makeEyePlacement(point, direction, cameraUp, settings) {
  const frame = projectionFrame(direction.toArray(), cameraUp.toArray());
  return {
    point: point.toArray(), direction: frame.direction.toArray(), up: frame.up.toArray(),
    shape: settings.eyeShape, width: settings.eyeWidth,
    height: settings.eyeShape === 'round' ? settings.eyeWidth : settings.eyeHeight
  };
}
