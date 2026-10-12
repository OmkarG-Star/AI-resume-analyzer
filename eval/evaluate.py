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
import importlib
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

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
    for t in ("reject", "maybe", "shortlist"):
        lines.append(f"| **{t}** | " + " | ".join(str(m["confusion"].get((t, p), 0)) for p in ("reject", "maybe", "shortlist")) + " |")
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
    # The engine comes from --src (so older versions can be compared); the metrics
    # code always comes from this checkout.
    sys.path.insert(0, str(Path(args.src).resolve()))
    engine = importlib.import_module("resume_ai.engine")
    spec = importlib.util.spec_from_file_location("ri_evaluation", ROOT / "src" / "resume_ai" / "evaluation.py")
    evaluation = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(evaluation)
    text = report(evaluation.run(engine))
    print(text)
    if args.write:
        (ROOT / "eval" / "RESULTS.md").write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
