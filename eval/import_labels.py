"""Turn recruiter decisions exported from the app into an evaluation set.

In the app, a recruiter marks verdicts as right or wrong (Decision tab, "Is this
verdict right?") and downloads them with "Download labels". That file holds the
job description, each resume's text and the recruiter's label.

    python eval/import_labels.py recruiter_labels.jsonl

writes the resumes and jobs to eval/recruiter/ and the labels to
eval/recruiter_labels.csv. Then:

    python eval/evaluate.py --labels recruiter_labels.csv     # how often the engine agrees
    python eval/train.py --labels labels.csv recruiter_labels.csv --write

Real resumes are personal data. eval/recruiter/ and eval/recruiter_labels.csv
are in .gitignore so they never reach a public repository; keep them that way
unless every candidate has agreed, and anonymise names before sharing.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "eval" / "recruiter"
OUT_CSV = ROOT / "eval" / "recruiter_labels.csv"
VALID = {"shortlist", "maybe", "reject"}
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE = re.compile(r"\+?\d[\d\s().-]{8,}\d")


def anonymise(text: str) -> str:
    return PHONE.sub("[phone]", EMAIL.sub("[email]", text))


def short(text: str) -> str:
    return hashlib.blake2b(text.encode("utf-8"), digest_size=6).hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("files", nargs="+", type=Path, help="recruiter_labels.jsonl files downloaded from the app")
    args = ap.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    existing = {}
    if OUT_CSV.exists():
        existing = {(r["resume"], r["job"]): r for r in csv.DictReader(open(OUT_CSV, encoding="utf-8"))}
    added = updated = skipped = 0
    for path in args.files:
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if not line.strip():
                continue
            try:
                d = json.loads(line)
            except ValueError:
                print(f"{path}:{n}: not JSON, skipped")
                skipped += 1
                continue
            label = str(d.get("label", "")).lower()
            if label not in VALID or not d.get("resume_text") or not d.get("job_text"):
                skipped += 1
                continue
            job_path = OUT_DIR / f"job_{short(d['job_text'])}.txt"
            job_path.write_text(d["job_text"], encoding="utf-8")
            res_path = OUT_DIR / f"resume_{short(d['resume_text'])}.txt"
            res_path.write_text(anonymise(d["resume_text"]), encoding="utf-8")
            key = (str(res_path.relative_to(ROOT)), str(job_path.relative_to(ROOT)))
            note = (d.get("note") or "").replace("\n", " ")[:200]
            row = {"resume": key[0], "job": key[1], "label": label,
                   "note": note or f"recruiter label; engine said {d.get('engine_verdict', '?')}"}
            if key in existing:
                updated += existing[key]["label"] != label
            else:
                added += 1
            existing[key] = row
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["resume", "job", "label", "note"])
        w.writeheader()
        w.writerows(existing.values())
    print(f"{added} new labels, {updated} changed, {skipped} skipped; "
          f"{len(existing)} in {OUT_CSV.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
