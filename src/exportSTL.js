import { Mesh } from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';

export function createSTLFile(geometry, filename) {
  const data = new STLExporter().parse(new Mesh(geometry), { binary: true });
  return new File([data], `${filename.replace(/\.(stl|obj|3mf)$/i, '')}_ghost.stl`, { type: 'model/stl' });
}

export function exportSTL(geometry, filename) {
  const file = createSTLFile(geometry, filename);
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = file.name;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
