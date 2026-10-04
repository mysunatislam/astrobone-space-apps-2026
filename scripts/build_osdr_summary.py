"""Rebuild public/data/osdr-804-summary.json from NASA OSDR study OSD-804 (ALSDA LSDS-130).

The two source files are downloaded from NASA's public OSDR API into data/ on first run (unrestricted
files only), then summarised; the output records each file's SHA-256 so the app can show it.
Usage: npm run data:osdr
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import statistics
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "LSDS-130_microCT_Cahill_microCT_TRANSFORMED.csv"
DICTIONARY = ROOT / "data" / "LSDS-130_microCT_Data_Dictionary.csv"
OUTPUT = ROOT / "public" / "data" / "osdr-804-summary.json"
GROUP_LABELS = {
    "BSL": "Basal control",
    "VIV": "Vivarium control",
    "GC": "Ground control",
    "FLT": "Spaceflight",
}


API = "https://visualization.osdr.nasa.gov/biodata/api/v2/dataset"


def fetch(study: str, path: Path) -> None:
    """Download one unrestricted OSDR file into data/ if it is not there yet."""
    if path.exists():
        return
    from urllib.request import urlopen
    with urlopen(f"{API}/{study}/file/{path.name}/", timeout=90) as response:
        record = json.load(response)[study]["files"][path.name]
    if record["metadata"]["restricted"] or not record["metadata"]["visible"]:
        raise ValueError("Only unrestricted public NASA data may be used")
    if not record["URL"].startswith("https://osdr.nasa.gov/"):
        raise ValueError("Unexpected NASA download host")
    path.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(record["URL"], timeout=120) as response:
        path.write_bytes(response.read())


def main() -> None:
    fetch("OSD-804", SOURCE)
    # The data dictionary is documentation only (no numbers come from it). NASA's API no longer lists
    # it, so when it cannot be fetched the fingerprint recorded in the previous output is kept.
    try:
        fetch("OSD-804", DICTIONARY)
    except (KeyError, OSError, ValueError):
        pass
    previous = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {}
    dictionary_hash = sha256(DICTIONARY) if DICTIONARY.exists() else previous.get("source", {}).get("dictionarySha256")
    with SOURCE.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    if len(rows) != 170:
        raise ValueError(f"Expected 170 OSDR-804 records, found {len(rows)}")

    grouped: dict[tuple[str, str, str], list[float]] = defaultdict(list)
    group_counts: dict[str, int] = defaultdict(int)
    site_counts: dict[str, int] = defaultdict(int)

    for row in rows:
        sample_name = row["Sample Name"]
        parts = sample_name.split("_")
        if len(parts) < 4 or parts[1] not in GROUP_LABELS:
            raise ValueError(f"Unexpected sample name: {sample_name}")
        group = parts[1]
        site = parts[-1]
        group_counts[group] += 1
        site_counts[site] += 1
        for measure, raw_value in row.items():
            if measure == "Sample Name" or not raw_value.strip():
                continue
            value = float(raw_value)
            if math.isfinite(value):
                grouped[(site, group, measure)].append(value)

    comparisons = []
    for site in sorted(site_counts):
        measures = sorted(
            measure
            for grouped_site, group, measure in grouped
            if grouped_site == site and group == "FLT" and (site, "GC", measure) in grouped
        )
        for measure in measures:
            flight = grouped[(site, "FLT", measure)]
            ground = grouped[(site, "GC", measure)]
            flight_mean = statistics.fmean(flight)
            ground_mean = statistics.fmean(ground)
            comparisons.append(
                {
                    "site": site,
                    "measure": measure,
                    "flightN": len(flight),
                    "groundN": len(ground),
                    "flightMean": round(flight_mean, 6),
                    "groundMean": round(ground_mean, 6),
                    "percentDifference": round((flight_mean - ground_mean) / ground_mean * 100, 2),
                }
            )

    payload = {
        "schemaVersion": "astrobone-osdr-summary-v1",
        "source": {
            "accession": "OSD-804",
            "alsdaId": "LSDS-130",
            "doi": "10.26030/yh5h-h706",
            "license": "CC0-1.0",
            "releaseDate": "2025-01-29",
            "studyUrl": "https://osdr.nasa.gov/bio/repo/data/studies/OSD-804",
            "apiManifestUrl": "https://visualization.osdr.nasa.gov/biodata/api/v2/dataset/OSD-804/files/",
            "dataFile": SOURCE.name,
            "dataSha256": sha256(SOURCE),
            "dictionaryFile": DICTIONARY.name,
            "dictionarySha256": dictionary_hash,
        },
        "study": {
            "organism": "Mus musculus",
            "sex": "female",
            "spaceflightDurationDays": 37,
            "assay": "Micro-computed tomography",
            "sampleRecords": len(rows),
            "groups": [
                {"code": group, "label": GROUP_LABELS[group], "records": group_counts[group]}
                for group in GROUP_LABELS
            ],
            "sites": [
                {"name": site, "records": site_counts[site]}
                for site in sorted(site_counts)
            ],
        },
        "flightVsGroundControl": comparisons,
        "useBoundary": (
            "Animal microCT evidence supports biological plausibility and site-specific trends. "
            "It is not a human fracture-risk calibration and does not set the crew bone-strength slider."
        ),
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT} with {len(comparisons)} flight-control comparisons")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


if __name__ == "__main__":
    main()
