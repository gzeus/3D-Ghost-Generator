import * as THREE from 'three';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const list = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
const units = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseAttributeValue: false, processEntities: false });
const maxTriangles = 2000000;

function xml(bytes) {
  const text = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw new Error('The 3MF contains invalid or unsupported XML.');
  return parser.parse(text);
}
function packagePath(value) {
  const parts = [];
  for (const part of decodeURIComponent(value).replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) throw new Error('Invalid 3MF part path.'); parts.pop(); }
    else parts.push(part);
  }
  return parts.join('/');
}
function matrix(value, unit) {
  if (value === undefined) return new THREE.Matrix4();
  const n = String(value).trim().split(/\s+/).map(Number);
  if (n.length !== 12 || !n.every(Number.isFinite)) throw new Error('Invalid 3MF transform.');
  return new THREE.Matrix4().set(n[0], n[3], n[6], n[9] * unit, n[1], n[4], n[7], n[10] * unit, n[2], n[5], n[8], n[11] * unit, 0, 0, 0, 1);
}

// Geometry-only, worker-safe 3MF reader: no DOM, texture loading, or remote parts.
export function import3MF(buffer) {
  let expanded = 0;
  const raw = unzipSync(new Uint8Array(buffer), { filter: file => {
    if (!/\.model$|\.rels$/i.test(file.name)) return false;
    expanded += file.originalSize;
    if (expanded > 256 * 1024 * 1024) throw new Error('The 3MF expands beyond 256 MB. Simplify the model first.');
    return true;
  } });
  const files = new Map(Object.entries(raw).map(([name, bytes]) => [packagePath(name), bytes]));
  let rootPath;
  if (files.has('_rels/.rels')) {
    const relationships = list(xml(files.get('_rels/.rels')).Relationships?.Relationship);
    const model = relationships.find(r => /\/3dmodel$/.test(r['@_Type'] || ''));
    if (model) {
      if (model['@_TargetMode'] === 'External') throw new Error('The 3MF model must be embedded in the file.');
      rootPath = packagePath(model['@_Target']);
    }
  }
  if (!rootPath) {
    const models = [...files.keys()].filter(name => /\.model$/i.test(name));
    rootPath = models.find(name => /^3d\/3dmodel.model$/i.test(name)) || (models.length === 1 ? models[0] : undefined);
  }
  if (!rootPath) throw new Error('No root mesh model was found in this 3MF.');
  const models = new Map(), parts = [];
  let triangleCount = 0, visits = 0;
  function readModel(path) {
    if (models.has(path)) return models.get(path);
    if (!files.has(path)) throw new Error(`Missing embedded 3MF model: ${path}`);
    const model = xml(files.get(path)).model;
    if (!model) throw new Error('Invalid 3MF model document.');
    const unit = units[model['@_unit'] || 'millimeter'];
    if (!unit) throw new Error('Unsupported 3MF measurement unit.');
    const objects = new Map();
    for (const object of list(model.resources?.object)) {
      const id = String(object['@_id']);
      if (objects.has(id)) throw new Error('Duplicate 3MF object ID.');
      objects.set(id, object);
    }
    const data = { model, unit, objects, meshes: new Map() }; models.set(path, data); return data;
  }
  function visit(path, id, transform, ancestors) {
    if (++visits > 100000 || ancestors.size > 128) throw new Error('The 3MF assembly is too complex.');
    const key = `${path}#${id}`;
    if (ancestors.has(key)) throw new Error('The 3MF contains circular component references.');
    const data = readModel(path), object = data.objects.get(String(id));
    if (!object) throw new Error(`Missing 3MF object ${id}.`);
    if (object.mesh) {
      if (!data.meshes.has(id)) {
        const vertices = list(object.mesh.vertices?.vertex).map(v => ['x', 'y', 'z'].map(axis => Number(v[`@_${axis}`]) * data.unit));
        if (!vertices.every(v => v.every(Number.isFinite))) throw new Error('Invalid 3MF vertex coordinates.');
        const triangles = list(object.mesh.triangles?.triangle).map(t => ['v1', 'v2', 'v3'].map(k => Number(t[`@_${k}`])));
        if (!triangles.length || !triangles.every(t => t.every(i => Number.isInteger(i) && i >= 0 && i < vertices.length))) throw new Error('The 3MF has missing triangles or invalid vertex indices.');
        data.meshes.set(id, { vertices, triangles });
      }
      const mesh = data.meshes.get(id); triangleCount += mesh.triangles.length;
      if (triangleCount > maxTriangles) throw new Error('Please simplify the model to fewer than 2 million triangles.');
      parts.push({ mesh, transform });
    } else {
      const components = list(object.components?.component);
      if (!components.length) throw new Error('This 3MF object has no supported triangle mesh.');
      const next = new Set(ancestors).add(key);
      for (const component of components) {
        const childPath = component['@_path'] ? packagePath(component['@_path']) : path;
        visit(childPath, component['@_objectid'], transform.clone().multiply(matrix(component['@_transform'], data.unit)), next);
      }
    }
  }
  const root = readModel(rootPath);
  for (const item of list(root.model.build?.item)) {
    if (['0', 'false'].includes(String(item['@_printable']))) continue;
    visit(item['@_path'] ? packagePath(item['@_path']) : rootPath, item['@_objectid'], matrix(item['@_transform'], root.unit), new Set());
  }
  if (!triangleCount) throw new Error('The 3MF build contains no printable triangle meshes.');
  const positions = new Float32Array(triangleCount * 9), point = new THREE.Vector3(); let offset = 0;
  for (const { mesh, transform } of parts) for (const triangle of mesh.triangles) {
    const order = transform.determinant() < 0 ? [triangle[0], triangle[2], triangle[1]] : triangle;
    for (const index of order) { point.fromArray(mesh.vertices[index]).applyMatrix4(transform); point.toArray(positions, offset); offset += 3; }
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3));
}
