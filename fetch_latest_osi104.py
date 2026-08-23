from __future__ import annotations

import os
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from eumdac import AccessToken, DataStore

COLLECTION_ID = "EO:EUM:DAT:METOP:OSI-104"
MAX_AGE_HOURS = 24


def load_credentials() -> tuple[str, str]:
    key = os.getenv("EUMDAC_CONSUMER_KEY")
    secret = os.getenv("EUMDAC_CONSUMER_SECRET")
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
        "No EUMDAC credentials found. Add ~/.eumdac/credentials as 'consumer_key,consumer_secret' "
        "or set EUMDAC_CONSUMER_KEY and EUMDAC_CONSUMER_SECRET."
    )


def find_latest_recent_product(max_age_hours: int = MAX_AGE_HOURS):
    key, secret = load_credentials()
    token = AccessToken((key, secret))
    datastore = DataStore(token)
    collection = datastore.get_collection(COLLECTION_ID)

    now_utc = datetime.now(timezone.utc)
    start_utc = now_utc - timedelta(hours=max_age_hours)

    print(f"Searching {COLLECTION_ID} for products from {start_utc.isoformat()} to {now_utc.isoformat()}")

    results = collection.search(dtstart=start_utc, dtend=now_utc, sort="start,time,1")

    newest_product = None
    newest_time = None
    for product in results:
        try:
            sensing_start = product.sensing_start
        except Exception:
            continue

        if sensing_start.tzinfo is None:
            sensing_start = sensing_start.replace(tzinfo=timezone.utc)

        if newest_time is None or sensing_start > newest_time:
            newest_product = product
            newest_time = sensing_start

    if newest_product is None:
        raise RuntimeError(f"No {COLLECTION_ID} products found in the last {max_age_hours} hours.")

    return newest_product


def download_product(product, output_dir: str | os.PathLike[str] = "downloads") -> Path:
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    product_id = str(product)
    filename = f"{product_id}.zip"
    archive_path = output_path / filename

    print(f"Downloading {product_id} to {archive_path}")
    with product.open() as stream:
        with archive_path.open("wb") as file_handle:
            while True:
                chunk = stream.read(1024 * 1024)
                if not chunk:
                    break
                file_handle.write(chunk)

    print(f"Downloaded archive: {archive_path}")
    return archive_path


def inspect_archive(archive_path: Path):
    with zipfile.ZipFile(archive_path) as zf:
        names = zf.namelist()
        print(f"Archive contents ({len(names)} entries):")
        for name in names[:20]:
            print(f"  - {name}")
        if len(names) > 20:
            print("  - ...")


def main() -> None:
    product = find_latest_recent_product(MAX_AGE_HOURS)
    print(f"Selected latest product: {product}")
    print(f"Sensing start: {product.sensing_start.isoformat()}")
    print(f"Sensing end:   {product.sensing_end.isoformat()}")

    archive_path = download_product(product, output_dir="downloads")
    inspect_archive(archive_path)


if __name__ == "__main__":
    main()
