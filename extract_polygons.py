import json
import os
import xml.etree.ElementTree as ET

xml_path = os.path.join(os.path.dirname(__file__), 'EOPMetadata.xml')
out_path = os.path.join(os.path.dirname(__file__), 'ascat_polygons.js')
ns = {'gml': 'http://www.opengis.net/gml/3.2'}
root = ET.parse(xml_path).getroot()
polygons = []
for poly in root.findall('.//gml:Polygon', ns):
    pos = poly.find('./gml:exterior/gml:LinearRing/gml:posList', ns)
    if pos is None or pos.text is None:
        continue
    vals = pos.text.strip().split()
    coords = []
    for i in range(0, len(vals), 2):
        if i + 1 >= len(vals):
            break
        lat = float(vals[i])
        lon = float(vals[i + 1])
        coords.append([lon, lat])
    if len(coords) >= 3:
        polygons.append(coords)

js = 'const polygonData = ' + json.dumps(polygons) + ';\n'
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(js)
print(f'Wrote {len(polygons)} polygons to {out_path}')
