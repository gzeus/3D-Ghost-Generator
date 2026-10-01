import { zipSync, strToU8 } from 'fflate';

export const tetraMesh = `<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="2" z="0"/><vertex x="0" y="0" z="3"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/></triangles></mesh>`;
export const modelXML = (resources, build, unit = 'millimeter') => `<?xml version="1.0"?><model unit="${unit}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><resources>${resources}</resources><build>${build}</build></model>`;
export function archive3MF(model, extra = {}) {
  const bytes = zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Id="root"/></Relationships>'),
    '3D/3dmodel.model': strToU8(model),
    ...Object.fromEntries(Object.entries(extra).map(([name, xml]) => [name, strToU8(xml)]))
  });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
export const wideOBJ = `mtllib ignored.mtl
o WideBox
v 0 0 0
v 100 0 0
v 100 20 0
v 0 20 0
v 0 0 10
v 100 0 10
v 100 20 10
v 0 20 10
f 1 4 3 2
f 5 6 7 8
f 1 2 6 5
f 2 3 7 6
f 3 4 8 7
f -5 -8 -4 -1
`;
