import os
from xml.etree import ElementTree as ET

WORKSPACE = os.path.dirname(os.path.abspath(__file__))
XML_PATH = os.path.join(WORKSPACE, "EOPMetadata.xml")
OUTPUT_PATH = os.path.join(WORKSPACE, "ascat_map.svg")

NS = {"gml": "http://www.opengis.net/gml/3.2"}


def load_polygons(xml_path):
    tree = ET.parse(xml_path)
    root = tree.getroot()
    polygons = []
    for poly in root.findall(".//gml:Polygon", NS):
        pos_list = poly.find("./gml:exterior/gml:LinearRing/gml:posList", NS)
        if pos_list is None or pos_list.text is None:
            continue
        values = pos_list.text.strip().split()
        coords = []
        for i in range(0, len(values), 2):
            if i + 1 >= len(values):
                break
            lat = float(values[i])
            lon = float(values[i + 1])
            coords.append((lon, lat))
        if len(coords) >= 3:
            polygons.append(coords)
    return polygons


def project(lon, lat, width, height, pad):
    x = pad + (lon + 180.0) / 360.0 * (width - 2 * pad)
    y = height - pad - (lat + 90.0) / 180.0 * (height - 2 * pad)
    return x, y


def create_svg(polygons, out_path):
    width, height = 1200, 700
    pad = 60

    polygons_svg = []
    for poly in polygons:
        points = []
        for lon, lat in poly:
            x, y = project(lon, lat, width, height, pad)
            points.append(f"{x:.2f},{y:.2f}")
        polygons_svg.append(f'<polygon points="{" ".join(points)}" fill="#4f6fff" fill-opacity="0.35" stroke="#1d4ed8" stroke-width="1.5" />')

    grid = []
    for lon in range(-180, 181, 30):
        x = project(lon, -90, width, height, pad)[0]
        grid.append(f'<line x1="{x:.2f}" y1="{pad}" x2="{x:.2f}" y2="{height-pad}" stroke="#dbeafe" stroke-width="1" />')
        grid.append(f'<text x="{x:.2f}" y="{height-pad+20}" text-anchor="middle" font-size="11" fill="#374151">{lon}°</text>')
    for lat in range(-90, 91, 30):
        y = project(0, lat, width, height, pad)[1]
        grid.append(f'<line x1="{pad}" y1="{y:.2f}" x2="{width-pad}" y2="{y:.2f}" stroke="#dbeafe" stroke-width="1" />')
        grid.append(f'<text x="{pad-12}" y="{y + 4:.2f}" text-anchor="end" font-size="11" fill="#374151">{lat}°</text>')

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <rect width="100%" height="100%" fill="#f8fafc" />
  <rect x="{pad}" y="{pad}" width="{width-2*pad}" height="{height-2*pad}" fill="#eff6ff" stroke="#cbd5e1" stroke-width="1.5" />
  {''.join(grid)}
  {''.join(polygons_svg)}
  <text x="{width/2:.2f}" y="30" text-anchor="middle" font-size="22" font-family="Arial, sans-serif" fill="#0f172a">Metop-C ASCAT footprint</text>
  <text x="{width/2:.2f}" y="{height-12}" text-anchor="middle" font-size="12" font-family="Arial, sans-serif" fill="#475569">Longitude / Latitude (degrees)</text>
</svg>
'''
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(svg)


if __name__ == "__main__":
    polygons = load_polygons(XML_PATH)
    if not polygons:
        raise RuntimeError(f"No polygon coordinates found in {XML_PATH}")
    create_svg(polygons, OUTPUT_PATH)
    print(f"Generated ASCAT footprint map: {OUTPUT_PATH}")
    print(f"Polygon count: {len(polygons)}")
