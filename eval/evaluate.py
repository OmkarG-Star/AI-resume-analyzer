"""Measure how well the screener agrees with human labels.

Each row of labels.csv pairs a resume with a job and a human decision:
shortlist, maybe or reject. The script scores every pair, maps the engine's
verdict onto the same three classes (Strong shortlist and Shortlist ->
shortlist, Interview to verify -> maybe, Not a fit -> reject) and reports:

* accuracy              share of pairs where the verdict class matches the label
* Cohen's kappa         agreement corrected for chance (linear-weighted, since
                        reject -> maybe is a smaller miss than reject -> shortlist)
* Spearman rho          how well the 0-100 score orders the labels
* Precision@1, @3       per job, share of the top-ranked candidates a human
                        labelled shortlist or maybe
* false rejections      good candidates (shortlist or maybe) the engine rejects;
                        the costliest error for a screening tool
* stuffers caught       resumes marked "stuffer" that were not shortlisted

Usage:
    python eval/evaluate.py                 # print the report
    python eval/evaluate.py --write         # also save eval/RESULTS.md
    python eval/evaluate.py --src other/src # score with another copy of the engine

The labels in this repo are written by the author for fictional resumes, so
the numbers show the method and catch regressions; real recruiter labels on
real (anonymised) resumes are what make them meaningful.
"""
from __future__ import annotations

import argparse
import csv
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JOBS = {
    "ds": "samples/jobs/data_scientist.txt",
    "de": "samples/jobs/data_engineer.txt",
    "hr": "samples/library/hr_data_analyst.txt",
    "ml": "samples/library/ml_engineer.txt",
    "ae": "samples/library/analytics_engineer.txt",
}
CLASSES = ["reject", "maybe", "shortlist"]
ORD = {c: i for i, c in enumerate(CLASSES)}
VERDICT_CLASS = {"strong": "shortlist", "shortlist": "shortlist", "verify": "maybe", "reject": "reject"}


def ranks(xs: list[float]) -> list[float]:
    """Average ranks, ties shared."""
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    out = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        for k in range(i, j + 1):
            out[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return out


def spearman(x: list[float], y: list[float]) -> float:
    rx, ry = ranks(x), ranks(y)
    n = len(x)
    mx, my = sum(rx) / n, sum(ry) / n
    cov = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    vx = sum((a - mx) ** 2 for a in rx) ** 0.5
    vy = sum((b - my) ** 2 for b in ry) ** 0.5
    return cov / (vx * vy) if vx and vy else 0.0


def weighted_kappa(truth: list[str], pred: list[str]) -> float:
    k = len(CLASSES)
    n = len(truth)
    obs = [[0] * k for _ in range(k)]
    for t, p in zip(truth, pred):
        obs[ORD[t]][ORD[p]] += 1
    rt = [sum(row) for row in obs]
    cp = [sum(obs[i][j] for i in range(k)) for j in range(k)]
    w = [[abs(i - j) / (k - 1) for j in range(k)] for i in range(k)]
    o = sum(w[i][j] * obs[i][j] for i in range(k) for j in range(k)) / n
    e = sum(w[i][j] * rt[i] * cp[j] for i in range(k) for j in range(k)) / (n * n)
    return 1 - o / e if e else 0.0


def run(src: Path) -> dict:
    sys.path.insert(0, str(src))
    from resume_ai import engine  # noqa: E402  (path set above)

    rows = list(csv.DictReader(open(ROOT / "eval" / "labels.csv", encoding="utf-8")))
    jobs = {k: (ROOT / v).read_text(encoding="utf-8") for k, v in JOBS.items()}
    results = []
    for r in rows:
        out = engine.analyze((ROOT / r["resume"]).read_text(encoding="utf-8"), jobs[r["job"]])
        results.append({**r, "score": out["score"], "verdict": out["verdict"]["label"],
                        "pred": VERDICT_CLASS[out["verdict"]["key"]]})

    truth = [r["label"] for r in results]
    pred = [r["pred"] for r in results]
    by_job = defaultdict(list)
    for r in results:
        by_job[r["job"]].append(r)
    p_at = {1: [], 3: []}
    for items in by_job.values():
        top = sorted(items, key=lambda r: -r["score"])
        for k in p_at:
            p_at[k].append(sum(r["label"] != "reject" for r in top[:k]) / min(k, len(top)))
    good = [r for r in results if r["label"] != "reject"]
    stuffers = [r for r in results if "stuffer" in r["note"]]
    return {
        "n": len(results),
        "accuracy": sum(t == p for t, p in zip(truth, pred)) / len(results),
        "kappa": weighted_kappa(truth, pred),
        "spearman": spearman([r["score"] for r in results], [ORD[t] for t in truth]),
        "p_at_1": sum(p_at[1]) / len(p_at[1]),
        "p_at_3": sum(p_at[3]) / len(p_at[3]),
        "false_rejections": sum(r["pred"] == "reject" for r in good),
        "good": len(good),
        "stuffers_caught": sum(r["pred"] != "shortlist" for r in stuffers),
        "stuffers": len(stuffers),
        "confusion": Counter((t, p) for t, p in zip(truth, pred)),
        "results": results,
    }


def report(m: dict) -> str:
    lines = [
        "# Evaluation results",
        "",
        f"{m['n']} resume-job pairs labelled shortlist / maybe / reject "
        "(fictional resumes, author labels; see eval/README.md).",
        "",
        "| Metric | Value |",
        "|---|---|",
        f"| Verdict accuracy (3 classes) | {m['accuracy']:.1%} |",
        f"| Cohen's kappa (linear-weighted) | {m['kappa']:.2f} |",
        f"| Spearman rho, score vs label | {m['spearman']:.2f} |",
        f"| Precision@1 per job | {m['p_at_1']:.1%} |",
        f"| Precision@3 per job | {m['p_at_3']:.1%} |",
        f"| Good candidates wrongly rejected | {m['false_rejections']} of {m['good']} |",
        f"| Keyword stuffers kept off the shortlist | {m['stuffers_caught']} of {m['stuffers']} |",
        "",
        "Confusion matrix (rows: human label, columns: engine verdict)",
        "",
        "| | reject | maybe | shortlist |",
        "|---|---|---|---|",
    ]
    for t in CLASSES:
        lines.append(f"| **{t}** | " + " | ".join(str(m["confusion"].get((t, p), 0)) for p in CLASSES) + " |")
    misses = [r for r in m["results"] if r["label"] != r["pred"]]
    if misses:
        lines += ["", "Disagreements", "", "| Resume | Job | Label | Engine | Score |", "|---|---|---|---|---|"]
        for r in sorted(misses, key=lambda r: (r["job"], r["resume"])):
            lines.append(f"| {Path(r['resume']).stem} | {r['job']} | {r['label']} | {r['verdict']} | {r['score']:g} |")
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--src", default=str(ROOT / "src"), help="folder containing the resume_ai package")
    ap.add_argument("--write", action="store_true", help="save the report to eval/RESULTS.md")
    args = ap.parse_args()
    text = report(run(Path(args.src).resolve()))
    print(text)
    if args.write:
        (ROOT / "eval" / "RESULTS.md").write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
