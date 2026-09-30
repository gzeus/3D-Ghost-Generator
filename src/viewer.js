import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { orientGeometry } from './meshUtils.js';

export function createViewer(container) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#202a29');
  const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 10000); camera.up.set(0, 0, 1);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.localClippingEnabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25; container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight('#edfff9', '#677675', 2.5));
  const key = new THREE.DirectionalLight('#fff5dd', 4); key.position.set(-80, -110, 180); scene.add(key);
  const rim = new THREE.DirectionalLight('#b3deed', 2); rim.position.set(70, 80, 100); scene.add(rim);
  let grid;
  function setGrid(size) {
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
    grid = new THREE.GridHelper(size, 24, '#4a6460', '#334440'); grid.rotation.x = Math.PI / 2; grid.position.z = -0.05; scene.add(grid);
  }
  setGrid(200);
  const belowPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  const abovePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const sourceMaterial = new THREE.MeshStandardMaterial({ color: '#a3bbc5', roughness: 0.65, transparent: true, opacity: 0.65, clippingPlanes: [abovePlane], side: THREE.DoubleSide });
  const dimMaterial = new THREE.MeshStandardMaterial({ color: '#80908f', transparent: true, opacity: 0.14, depthWrite: false, clippingPlanes: [belowPlane], side: THREE.DoubleSide });
  const ghostMaterial = new THREE.MeshStandardMaterial({ color: '#f3eedc', roughness: 0.79, metalness: 0.02 });
  const sourceMesh = new THREE.Mesh(new THREE.BufferGeometry(), sourceMaterial);
  const dimMesh = new THREE.Mesh(sourceMesh.geometry, dimMaterial);
  const ghostMesh = new THREE.Mesh(new THREE.BufferGeometry(), ghostMaterial);
  scene.add(sourceMesh, dimMesh, ghostMesh);
  const cutoff = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#9ef0c4', opacity: 0.12, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(cutoff.geometry), new THREE.LineBasicMaterial({ color: '#95c9aa', transparent: true, opacity: 0.55 })); cutoff.add(outline); scene.add(cutoff);
  let original, boxHelper, contourLines, samplePoints, lastRotation;
  let mode = 'ghost', showSource = false;
  const debug = { plane: true, box: false, rings: false, points: false, wireframe: false };
  const updateVisibility = () => {
    sourceMesh.visible = dimMesh.visible = mode === 'source' || mode === 'overlay' || showSource;
    ghostMesh.visible = mode !== 'source';
    ghostMaterial.transparent = mode === 'overlay'; ghostMaterial.opacity = mode === 'overlay' ? 0.55 : 1; ghostMaterial.depthWrite = mode !== 'overlay';
    ghostMaterial.wireframe = debug.wireframe;
    cutoff.visible = debug.plane;
    if (boxHelper) boxHelper.visible = debug.box;
    if (contourLines) contourLines.visible = debug.rings && mode !== 'source';
    if (samplePoints) samplePoints.visible = debug.points;
  };
  function orient(rotation, fraction) {
    if (!original) return;
    const rotationKey = rotation.join(',');
    if (rotationKey !== lastRotation) {
      const matrix = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation.map(THREE.MathUtils.degToRad), 'XYZ'));
      sourceMesh.geometry.dispose(); sourceMesh.geometry = orientGeometry(original, matrix); dimMesh.geometry = sourceMesh.geometry;
      lastRotation = rotationKey;
      if (boxHelper) { scene.remove(boxHelper); boxHelper.geometry.dispose(); boxHelper.material.dispose(); }
      boxHelper = new THREE.Box3Helper(sourceMesh.geometry.boundingBox, '#c2a574'); scene.add(boxHelper);
    }
    const box = sourceMesh.geometry.boundingBox, size = box.getSize(new THREE.Vector3());
    const z = size.z * fraction;
    abovePlane.constant = -z; belowPlane.constant = z;
    cutoff.position.z = z; cutoff.scale.set(Math.max(size.x, size.y) * 1.65, Math.max(size.x, size.y) * 1.65, 1);
    updateVisibility(); return size;
  }
  function removeDebug(object) { if (object) { scene.remove(object); object.geometry.dispose(); object.material.dispose(); } }
  return {
    setSource(geometry) { original?.dispose(); original = geometry; lastRotation = undefined; },
    orient,
    setGhost(geometry) {
      ghostMesh.geometry.dispose(); ghostMesh.geometry = geometry;
      removeDebug(contourLines); removeDebug(samplePoints);
      const points = geometry.attributes.position, { ringCount, angularSamples: n, sampled } = geometry.userData;
      const lines = [];
      for (let l = 0; l < ringCount; l += 3) for (let i = 0; i < n; i++) for (const j of [l * n + i, l * n + (i + 1) % n]) lines.push(points.getX(j), points.getY(j), points.getZ(j));
      contourLines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lines, 3)), new THREE.LineBasicMaterial({ color: '#67d9a4', transparent: true, opacity: 0.7 })); scene.add(contourLines);
      const samples = [];
      for (const ring of sampled) ring.radii.forEach((r, i) => { const a = i / n * Math.PI * 2; samples.push(ring.cx + r * Math.cos(a), ring.cy + r * Math.sin(a), ring.z); });
      samplePoints = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(samples, 3)), new THREE.PointsMaterial({ color: '#ffbd72', size: 2, sizeAttenuation: false, depthTest: false })); scene.add(samplePoints);
      updateVisibility();
    },
    setMode(value) { mode = value; updateVisibility(); },
    setSourceVisible(value) { showSource = value; updateVisibility(); },
    setDebug(key, value) { debug[key] = value; updateVisibility(); },
    fit() {
      const box = new THREE.Box3();
      if (original) box.union(new THREE.Box3().setFromObject(sourceMesh));
      if (ghostMesh.geometry.attributes.position) box.union(new THREE.Box3().setFromObject(ghostMesh));
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      const radius = size.length() / 2;
      const fov = Math.min(camera.fov * Math.PI / 180, 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect));
      const distance = radius / Math.sin(fov / 2) * 1.15;
      camera.position.copy(center).add(new THREE.Vector3(1.15, -1.8, 0.85).normalize().multiplyScalar(distance));
      camera.near = Math.max(radius / 1000, 0.001); camera.far = distance * 30; camera.updateProjectionMatrix();
      controls.target.copy(center); controls.maxDistance = distance * 8; controls.update(); setGrid(Math.max(size.x, size.y, size.z) * 3);
    },
    start() {
      const resize = new ResizeObserver(() => { const w = container.clientWidth, h = container.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }); resize.observe(container);
      renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
    }
  };
}
