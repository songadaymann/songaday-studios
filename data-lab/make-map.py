"""Write data-lab/lab-map.json, the land outline behind the map on songaday.studio/data.

The outline is Natural Earth's (naturalearthdata.com, public domain): the 1:50m land and lakes
for the whole world, and the 1:10m land for a box around New York City, where a dozen places
sit within a few miles of each other. Download the three GeoJSON files from
https://github.com/nvkelso/natural-earth-vector/tree/master/geojson and pass their folder:

    python3 data-lab/make-map.py path/to/folder

It needs ne_50m_land.geojson, ne_50m_lakes.geojson and ne_10m_land.geojson, and uses only the
standard library. The page (lab.html) places each song's town with the same projection, so
W, LAT_TOP and project() here must match the map code there.
"""

import json
import math
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent / "lab-map.json"
W = 1000.0            # the world is this many units wide
LAT_TOP = 74.0        # the top edge of the map; Mercator, so shapes stay true when zoomed in
LAT_BOTTOM = -56.0
LAT_LIMIT = 84.0      # Mercator runs away near the poles
MIN_AREA = 0.25       # islands smaller than this (in square units) are left out of the world
WORLD_TOLERANCE = 0.09
# Small islands with songs written on them stay in: Phuket, Maui, Puerto Rico (lon, lat).
ISLANDS = [(98.39, 7.89), (-156.47, 20.89), (-66.11, 18.47)]
GREAT_LAKES = {"Lake Superior", "Lake Michigan", "Lake Huron", "Lake Erie", "Lake Ontario"}
# The close-up: west, south, east, north. Wider than the page's New York view on every side.
DETAIL = (-75.6, 39.9, -72.4, 41.6)
DETAIL_TOLERANCE = 0.0006
WORLD_SCALE, DETAIL_SCALE = 100, 10000  # path numbers per unit


def mercator(lat):
    lat = max(-LAT_LIMIT, min(LAT_LIMIT, lat))
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def project(lon, lat):
    return ((lon + 180) / 360 * W, (mercator(LAT_TOP) - mercator(lat)) * W / (2 * math.pi))


def rings(path, keep=lambda properties: True):
    """Every polygon ring in a GeoJSON file, as lists of (lon, lat)."""
    for feature in json.loads(Path(path).read_text())["features"]:
        if not keep(feature["properties"]):
            continue
        geometry = feature["geometry"]
        polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        for polygon in polygons:
            for ring in polygon:
                yield [(p[0], p[1]) for p in ring]


def area(points):
    return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(points, points[1:] + points[:1]))) / 2


def simplify(points, tolerance):
    """Douglas-Peucker, without recursion."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        (ax, ay), (bx, by) = points[first], points[last]
        dx, dy = bx - ax, by - ay
        length = math.hypot(dx, dy)
        worst, index = 0.0, None
        for i in range(first + 1, last):
            px, py = points[i]
            distance = abs(dy * (px - ax) - dx * (py - ay)) / length if length else math.hypot(px - ax, py - ay)
            if distance > worst:
                worst, index = distance, i
        if index is not None and worst > tolerance:
            keep[index] = True
            stack += [(first, index), (index, last)]
    return [p for p, k in zip(points, keep) if k]


def clip(points, box):
    """Sutherland-Hodgman: the part of a ring inside a west, south, east, north box."""
    west, south, east, north = box
    edges = [
        (lambda p: p[0] >= west, lambda a, b: (west, a[1] + (b[1] - a[1]) * (west - a[0]) / (b[0] - a[0]))),
        (lambda p: p[0] <= east, lambda a, b: (east, a[1] + (b[1] - a[1]) * (east - a[0]) / (b[0] - a[0]))),
        (lambda p: p[1] >= south, lambda a, b: (a[0] + (b[0] - a[0]) * (south - a[1]) / (b[1] - a[1]), south)),
        (lambda p: p[1] <= north, lambda a, b: (a[0] + (b[0] - a[0]) * (north - a[1]) / (b[1] - a[1]), north)),
    ]
    for inside, cross in edges:
        out = []
        for a, b in zip(points, points[1:] + points[:1]):
            if inside(b):
                if not inside(a):
                    out.append(cross(a, b))
                out.append(b)
            elif inside(a):
                out.append(cross(a, b))
        points = out
        if not points:
            break
    return points


def path(shapes, scale):
    """SVG path data in whole numbers, `scale` to a unit: each shape is a relative move, then
    relative lines. The page draws it with transform="scale(1/scale)"."""
    out, last = [], (0, 0)
    for shape in shapes:
        whole = [(round(x * scale), round(y * scale)) for x, y in shape]
        steps = []
        for point in whole:
            if point != last or not steps:
                steps.append(f"{point[0] - last[0]} {point[1] - last[1]}")
                last = point
        if len(steps) >= 3:
            out.append("m" + steps[0] + "l" + " ".join(steps[1:]) + "z")
        last = whole[0]  # z returns to the start of the shape
    return "".join(out)


def outline(source, tolerance, min_area, keep=lambda properties: True, box=None):
    shapes = []
    for ring in rings(source, keep):
        if ring[0] == ring[-1]:
            ring = ring[:-1]
        if max(lat for _, lat in ring) < LAT_BOTTOM - 4:
            continue  # Antarctica
        if box:
            west, south, east, north = box
            if max(p[0] for p in ring) < west or min(p[0] for p in ring) > east or max(p[1] for p in ring) < south or min(p[1] for p in ring) > north:
                continue
            ring = clip(ring, box)
            if len(ring) < 3:
                continue
        points = [project(lon, lat) for lon, lat in ring]
        if area(points) < min_area and not any(
                min(p[0] for p in ring) <= lon <= max(p[0] for p in ring) and min(p[1] for p in ring) <= lat <= max(p[1] for p in ring)
                for lon, lat in ISLANDS):
            continue
        points = simplify(points + points[:1], tolerance)[:-1]
        if len(points) >= 3:
            shapes.append(points)
    return shapes


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    folder = Path(sys.argv[1])
    land = outline(folder / "ne_50m_land.geojson", WORLD_TOLERANCE, MIN_AREA)
    lakes = outline(folder / "ne_50m_lakes.geojson", WORLD_TOLERANCE, MIN_AREA, keep=lambda p: p.get("name") in GREAT_LAKES)
    detail = outline(folder / "ne_10m_land.geojson", DETAIL_TOLERANCE, 0.0, box=DETAIL)
    west, north = project(DETAIL[0], DETAIL[3])
    east, south = project(DETAIL[2], DETAIL[1])
    data = {
        "source": "Natural Earth (naturalearthdata.com), public domain",
        "w": W, "h": round(project(0, LAT_BOTTOM)[1], 2), "lat_top": LAT_TOP,
        "scale": WORLD_SCALE, "land": path(land, WORLD_SCALE), "lakes": path(lakes, WORLD_SCALE),
        "detail": {"box": [round(west, 3), round(north, 3), round(east, 3), round(south, 3)], "scale": DETAIL_SCALE, "land": path(detail, DETAIL_SCALE)},
    }
    OUT.write_text(json.dumps(data, separators=(",", ":")))
    print(f"Wrote {OUT.name}: {OUT.stat().st_size / 1024:.0f} KB; "
          f"world {sum(map(len, land))} points in {len(land)} shapes, lakes {sum(map(len, lakes))}, "
          f"close-up {sum(map(len, detail))} points in {len(detail)} shapes")


if __name__ == "__main__":
    main()
