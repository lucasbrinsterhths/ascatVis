from __future__ import annotations

import json
import os
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from eumdac import AccessToken, DataStore
from netCDF4 import Dataset, num2date

COLLECTION_ID = "EO:EUM:DAT:METOP:OSI-104"
MAX_AGE_HOURS = 24
GRID_SIZE = 0.25
OUTPUT = Path("data/latest.json")


def credentials() -> tuple[str, str]:
    key = os.environ.get("EUMDAC_CONSUMER_KEY")
    secret = os.environ.get("EUMDAC_CONSUMER_SECRET")
    if key and secret:
        return key, secret

    credentials_path = Path.home() / ".eumdac" / "credentials"
    if credentials_path.exists():
        text = credentials_path.read_text(encoding="utf-8").strip()
        if "," in text:
            key, secret = [part.strip() for part in text.split(",", 1)]
            if key and secret:
                return key, secret

    raise RuntimeError(
        "No EUMDAC credentials found. Set EUMDAC_CONSUMER_KEY and "
        "EUMDAC_CONSUMER_SECRET or use ~/.eumdac/credentials."
    )


def products_from_last_day(datastore: DataStore):
    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=MAX_AGE_HOURS)
    collection = datastore.get_collection(COLLECTION_ID)
    results = collection.search(dtstart=start, dtend=now, sort="start,time,1")
    products = list(results)
    products.sort(key=lambda product: product.sensing_start)
    print(f"Found {len(products)} products in the last {MAX_AGE_HOURS} hours")
    return products


def add_product(product, latest: dict[tuple[int, int], dict], work_dir: Path) -> None:
    archive = work_dir / f"{product}.zip"
    with product.open() as stream, archive.open("wb") as handle:
        while chunk := stream.read(1024 * 1024):
            handle.write(chunk)

    with zipfile.ZipFile(archive) as package:
        nc_name = next(name for name in package.namelist() if name.endswith(".nc"))
        package.extract(nc_name, work_dir)
        nc_path = work_dir / nc_name

    with Dataset(nc_path) as dataset:
        lon = np.asarray(dataset.variables["lon"][:], dtype=float).ravel()
        lat = np.asarray(dataset.variables["lat"][:], dtype=float).ravel()
        speed = np.asarray(dataset.variables["wind_speed"][:], dtype=float).ravel()
        direction = np.asarray(dataset.variables["wind_dir"][:], dtype=float).ravel()
        timestamp = product.sensing_start.astimezone(timezone.utc).isoformat()

    valid = (
        np.isfinite(lon) & np.isfinite(lat) & np.isfinite(speed) & np.isfinite(direction)
        & (speed > 0) & (speed < 100) & (direction >= 0) & (direction <= 360)
        & (lat >= -90) & (lat <= 90)
    )
    lon = np.where(lon > 180, lon - 360, lon)[valid]
    lat, speed, direction = lat[valid], speed[valid], direction[valid]

    for point_lon, point_lat, point_speed, point_direction in zip(lon, lat, speed, direction):
        key = (int(np.floor((point_lon + 180) / GRID_SIZE)), int(np.floor((point_lat + 90) / GRID_SIZE)))
        latest[key] = {
            "lon": round(float(point_lon), 4),
            "lat": round(float(point_lat), 4),
            "speed": round(float(point_speed), 3),
            "direction": round(float(point_direction), 2),
            "time": timestamp,
            "product": str(product),
        }


def main() -> None:
    key, secret = credentials()
    datastore = DataStore(AccessToken((key, secret)))
    latest: dict[tuple[int, int], dict] = {}

    with tempfile.TemporaryDirectory() as temporary:
        work_dir = Path(temporary)
        for product in products_from_last_day(datastore):
            print(f"Processing {product}")
            add_product(product, latest, work_dir)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "collection": COLLECTION_ID,
        "generated": datetime.now(timezone.utc).isoformat(),
        "maxAgeHours": MAX_AGE_HOURS,
        "gridDegrees": GRID_SIZE,
        "points": list(latest.values()),
    }
    OUTPUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(latest)} latest grid cells to {OUTPUT}")


if __name__ == "__main__":
    main()
