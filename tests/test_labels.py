import csv
import json
import subprocess
import sys

from conftest import SAMPLES
from resume_ai import evaluation

ROOT = SAMPLES.parent


def test_import_labels_round_trip(tmp_path, monkeypatch):
    job = (SAMPLES / "jobs" / "data_scientist.txt").read_text()
    resume = (SAMPLES / "resumes" / "01_ananya_kulkarni.txt").read_text()
    f = tmp_path / "recruiter_labels.jsonl"
    f.write_text(json.dumps({"job_text": job, "resume_text": resume, "label": "shortlist",
                             "engine_verdict": "Strong shortlist"}) + "\n" + json.dumps({"label": "nonsense"}) + "\n")
    out_csv = ROOT / "eval" / "recruiter_labels.csv"
    out_dir = ROOT / "eval" / "recruiter"
    assert not out_csv.exists(), "remove eval/recruiter_labels.csv before running the tests"
    try:
        res = subprocess.run([sys.executable, str(ROOT / "eval" / "import_labels.py"), str(f)],
                             capture_output=True, text=True, check=True)
        assert "1 new labels" in res.stdout and "1 skipped" in res.stdout
        rows = list(csv.DictReader(open(out_csv)))
        assert rows[0]["label"] == "shortlist"
        text = (ROOT / rows[0]["resume"]).read_text()
        assert "@example.com" not in text and "[email]" in text
        m = evaluation.run(labels="recruiter_labels.csv")
        assert m["n"] == 1 and m["accuracy"] == 1.0
    finally:
        out_csv.unlink(missing_ok=True)
        for p in out_dir.glob("*"):
            p.unlink()
        out_dir.rmdir() if out_dir.exists() else None
