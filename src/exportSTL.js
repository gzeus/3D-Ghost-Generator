import { Mesh } from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';

export function exportSTL(geometry, filename) {
  const data = new STLExporter().parse(new Mesh(geometry), { binary: true });
  const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `${filename.replace(/\.(stl|obj|3mf)$/i, '')}_ghost.stl`;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
