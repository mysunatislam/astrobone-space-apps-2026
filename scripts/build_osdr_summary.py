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
import random
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

# Direction in which each microCT measure indicates bone loss or weaker structure (Bouxsein et al.,
# J Bone Miner Res 2010, guidelines for rodent microCT). None: no agreed adverse direction.
ADVERSE = {
    "bone_volume_total_volume_millimeter_cubed": "down",
    "connectivity_density_per_millimeter_cubed": "down",
    "trabecular_number_per_millimeter": "down",
    "trabecular_thickness_millimeter": "down",
    "trabecular_separation_millimeter": "up",
    "trabecular_bone_pattern_factor": "up",
    "cortical_thickness_millimeter": "down",
    "bone_area_total_area_millimeter_squared": "down",
    "endosteal _perimeter_millimeter": "up",
    "periosteal_perimeter_millimeter": None,
    "degree_of_anistropy": None,
}
FDR_ALPHA = 0.05
BOOTSTRAP_RESAMPLES = 10000
BOOTSTRAP_SEED = 804
SITE_PERMUTATIONS = 20000


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

    samples: dict[str, list[tuple[str, dict[str, float]]]] = defaultdict(list)
    for row in rows:
        sample_name = row["Sample Name"]
        parts = sample_name.split("_")
        if len(parts) < 4 or parts[1] not in GROUP_LABELS:
            raise ValueError(f"Unexpected sample name: {sample_name}")
        group = parts[1]
        site = parts[-1]
        group_counts[group] += 1
        site_counts[site] += 1
        values = {}
        for measure, raw_value in row.items():
            if measure == "Sample Name" or not raw_value.strip():
                continue
            value = float(raw_value)
            if math.isfinite(value):
                grouped[(site, group, measure)].append(value)
                values[measure] = value
        if group in ("FLT", "GC"):
            samples[site].append((group, values))

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
                    **compare(flight, ground, ADVERSE.get(measure), random.Random(f"{BOOTSTRAP_SEED}:{site}:{measure}")),
                }
            )
    add_q_values(comparisons)
    site_tests = [site_permutation_test(site, samples[site], random.Random(f"{BOOTSTRAP_SEED}:{site}")) for site in sorted(samples)]
    holm(site_tests)

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
        "statistics": {
            "test": "Welch two-sample t-test, two-sided",
            "multipleComparisons": f"Benjamini-Hochberg false discovery rate across all {len(comparisons)} flight vs ground-control comparisons",
            "fdrAlpha": FDR_ALPHA,
            "effectSize": "Hedges g (flight minus ground control, pooled SD, small-sample corrected) with a 95% normal-approximation interval",
            "percentInterval": f"95% percentile bootstrap, {BOOTSTRAP_RESAMPLES} resamples within each group, seeded",
            "adverseDirection": "Direction that indicates bone loss or weaker structure, per Bouxsein et al., J Bone Miner Res 2010",
            "percentReliable": "False when control values straddle zero, so a percent change is not interpretable; use Hedges g",
            "siteTest": f"Per site: mean of loss-signed Hedges g over measures with a known adverse direction; p from {SITE_PERMUTATIONS} seeded permutations of flight and ground-control labels across animals, which keeps the correlation between measures from the same bone; Holm correction across sites",
        },
        "flightVsGroundControl": comparisons,
        "siteTests": site_tests,
        "useBoundary": (
            "Animal microCT evidence supports biological plausibility and site-specific trends. "
            "It is not a human fracture-risk calibration and does not set the crew bone-strength slider."
        ),
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT} with {len(comparisons)} flight-control comparisons")


def sha256(path: Path) -> str:
    # NASA serves the CSV with CRLF line endings; git checkouts may store LF. Hash the NASA form so
    # the fingerprint matches the file downloaded from OSDR whichever way it was checked out.
    data = path.read_bytes()
    if path.suffix == ".csv":
        data = data.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    return hashlib.sha256(data).hexdigest()


def compare(flight: list[float], ground: list[float], adverse: str | None, rng: random.Random) -> dict:
    """Welch t-test, Hedges g with a 95% interval and a bootstrap interval for the percent change."""
    n1, n2 = len(flight), len(ground)
    m1, m2 = statistics.fmean(flight), statistics.fmean(ground)
    v1, v2 = statistics.variance(flight), statistics.variance(ground)
    se = math.sqrt(v1 / n1 + v2 / n2)
    t = (m1 - m2) / se
    df = (v1 / n1 + v2 / n2) ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1))
    p = student_t_two_sided(t, df)
    pooled = math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2))
    g = (m1 - m2) / pooled * (1 - 3 / (4 * (n1 + n2) - 9))
    g_se = math.sqrt((n1 + n2) / (n1 * n2) + g * g / (2 * (n1 + n2)))
    reliable = min(ground) > 0 or max(ground) < 0
    percents = []
    for _ in range(BOOTSTRAP_RESAMPLES):
        a = statistics.fmean(rng.choices(flight, k=n1))
        b = statistics.fmean(rng.choices(ground, k=n2))
        if b != 0:
            percents.append((a - b) / b * 100)
    percents.sort()
    lo, hi = percents[int(0.025 * len(percents))], percents[int(0.975 * len(percents)) - 1]
    worse = (adverse == "down" and m1 < m2) or (adverse == "up" and m1 > m2)
    return {
        "flightSd": round(math.sqrt(v1), 6),
        "groundSd": round(math.sqrt(v2), 6),
        "percentCi95": [round(lo, 2), round(hi, 2)] if reliable else None,
        "percentReliable": reliable,
        "hedgesG": round(g, 3),
        "hedgesGCi95": [round(g - 1.96 * g_se, 3), round(g + 1.96 * g_se, 3)],
        "welchT": round(t, 3),
        "welchDf": round(df, 2),
        "pValue": float(f"{p:.3g}"),
        "adverseDirection": adverse,
        "worse": bool(worse) if adverse else None,
    }


def loss_score(records: list[tuple[str, dict[str, float]]], labels: list[str]) -> tuple[float, int]:
    """Mean loss-signed Hedges g across a site's directional measures for one labelling of animals."""
    scores = []
    for measure, direction in ADVERSE.items():
        if direction is None:
            continue
        flight = [values[measure] for (_, values), label in zip(records, labels) if label == "FLT" and measure in values]
        ground = [values[measure] for (_, values), label in zip(records, labels) if label == "GC" and measure in values]
        if len(flight) < 2 or len(ground) < 2:
            continue
        n1, n2 = len(flight), len(ground)
        pooled = math.sqrt(((n1 - 1) * statistics.variance(flight) + (n2 - 1) * statistics.variance(ground)) / (n1 + n2 - 2))
        if pooled == 0:
            continue
        g = (statistics.fmean(flight) - statistics.fmean(ground)) / pooled * (1 - 3 / (4 * (n1 + n2) - 9))
        scores.append(-g if direction == "down" else g)
    return (statistics.fmean(scores) if scores else 0.0), len(scores)


def site_permutation_test(site: str, records: list[tuple[str, dict[str, float]]], rng: random.Random) -> dict:
    """One-sided test that spaceflight moved a site's structure toward loss, permuting whole animals."""
    labels = [group for group, _ in records]
    observed, measures = loss_score(records, labels)
    at_least = 0
    for _ in range(SITE_PERMUTATIONS):
        shuffled = labels[:]
        rng.shuffle(shuffled)
        if loss_score(records, shuffled)[0] >= observed:
            at_least += 1
    return {
        "site": site,
        "measures": measures,
        "flightAnimals": labels.count("FLT"),
        "groundAnimals": labels.count("GC"),
        "lossScore": round(observed, 3),
        "pValue": float(f"{(at_least + 1) / (SITE_PERMUTATIONS + 1):.3g}"),
    }


def holm(tests: list[dict]) -> None:
    """Holm step-down adjusted p-values across sites."""
    order = sorted(range(len(tests)), key=lambda i: tests[i]["pValue"])
    running = 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, tests[i]["pValue"] * (len(tests) - rank)))
        tests[i]["pHolm"] = float(f"{running:.3g}")
        tests[i]["significant"] = tests[i]["pHolm"] < FDR_ALPHA


def add_q_values(rows: list[dict]) -> None:
    """Benjamini-Hochberg adjusted p-values; a row is adverse when it is worse and q < FDR_ALPHA."""
    order = sorted(range(len(rows)), key=lambda i: rows[i]["pValue"])
    m, running = len(rows), 1.0
    for rank in range(m, 0, -1):
        i = order[rank - 1]
        running = min(running, rows[i]["pValue"] * m / rank)
        rows[i]["qValue"] = float(f"{running:.3g}")
    for row in rows:
        row["adverse"] = bool(row["worse"]) and row["qValue"] < FDR_ALPHA


def student_t_two_sided(t: float, df: float) -> float:
    """Two-sided p-value of Student's t: I_x(df/2, 1/2) with x = df / (df + t^2)."""
    return regularized_beta(df / (df + t * t), df / 2, 0.5)


def regularized_beta(x: float, a: float, b: float) -> float:
    """Regularized incomplete beta I_x(a, b) by Lentz's continued fraction (Numerical Recipes 6.4)."""
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    front = math.exp(math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1 - x))
    if x > (a + 1) / (a + b + 2):
        return 1.0 - regularized_beta(1 - x, b, a)
    tiny, f, c, d = 1e-300, 1.0, 1.0, 0.0
    for i in range(400):
        m = i // 2
        if i == 0:
            numerator = 1.0
        elif i % 2 == 0:
            numerator = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m))
        else:
            numerator = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1))
        d = 1.0 + numerator * d
        d = tiny if abs(d) < tiny else d
        d = 1.0 / d
        c = 1.0 + numerator / c
        c = tiny if abs(c) < tiny else c
        f *= c * d
        if abs(1.0 - c * d) < 1e-12:
            break
    return front * (f - 1.0) / a


if __name__ == "__main__":
    main()
