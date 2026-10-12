"""Agreement between the screener and human labels.

Each row of eval/labels.csv pairs a resume with a job and a human decision:
shortlist, maybe or reject. Every pair is scored, the verdict is mapped onto
the same three classes (Strong shortlist and Shortlist -> shortlist,
Interview to verify -> maybe, Not a fit -> reject) and agreement is measured
with accuracy, linear-weighted Cohen's kappa, Spearman rho between score and
label, precision@k per job, false rejections and stuffers caught.

Used by eval/evaluate.py (command line) and GET /api/model (web app).
"""
from __future__ import annotations

import csv
from collections import Counter, defaultdict
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
JOBS = {
    "ds": "samples/jobs/data_scientist.txt",
    "de": "samples/jobs/data_engineer.txt",
    "hr": "samples/library/hr_data_analyst.txt",
    "ml": "samples/library/ml_engineer.txt",
    "ae": "samples/library/analytics_engineer.txt",
}
JOB_NAMES = {"ds": "Data Scientist", "de": "Data Engineer", "hr": "HR Data Analyst",
             "ml": "ML Engineer", "ae": "Analytics Engineer"}
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


def _rows(labels: str = "labels.csv") -> list[dict]:
    return list(csv.DictReader(open(ROOT / "eval" / labels, encoding="utf-8")))


def metrics(results: list[dict]) -> dict:
    """Agreement metrics for [{label, pred, score, job, note, ...}]."""
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


def job_text(key: str) -> str:
    """A label row's job: a short key for the sample jobs (ds, de, …) or a file path under eval/."""
    return (ROOT / JOBS.get(key, key)).read_text(encoding="utf-8")


def run(engine=None, labels: str = "labels.csv") -> dict:
    """Score every labelled pair with the engine as configured. `engine` defaults to this package's.
    `labels` picks the file in eval/: labels.csv (development set), holdout_labels.csv,
    holdout2_labels.csv or recruiter_labels.csv (imported from the app)."""
    if engine is None:
        from . import engine
    results = []
    for r in _rows(labels):
        out = engine.analyze((ROOT / r["resume"]).read_text(encoding="utf-8"), job_text(r["job"]))
        results.append({**r, "score": out["score"], "verdict": out["verdict"]["label"],
                        "pred": VERDICT_CLASS[out["verdict"]["key"]]})
    return metrics(results)


def prepared(labels: tuple[str, ...] = ("labels.csv",)) -> list[dict]:
    """Weight-independent state for every labelled pair, so weights can be re-tried quickly."""
    from . import engine
    from . import jd as jdmod
    specs: dict[str, object] = {}
    out = []
    for r in (row for name in labels for row in _rows(name)):
        if r["job"] not in specs:
            specs[r["job"]] = jdmod.parse(job_text(r["job"]))
        spec = specs[r["job"]]
        p, f, integ, _ = engine.prepare((ROOT / r["resume"]).read_text(encoding="utf-8"), spec)
        parts = engine.score_parts(f, spec)
        out.append({**r, "parts": parts, "table": engine._skill_table(spec, f), "integ": integ})
    return out


def score_with(pp: list[dict], weights: dict[str, float]) -> list[dict]:
    """Scores and verdicts for prepared pairs under the given weights."""
    from . import engine
    res = []
    for x in pp:
        score = round(max(0.0, engine.overall(x["parts"], weights) - x["integ"].penalty), 1)
        key, _ = engine._verdict(score, x["parts"], x["table"], x["integ"])
        res.append({k: x[k] for k in ("resume", "job", "label", "note")}
                   | {"score": score, "verdict": engine.VERDICTS[key]["label"], "pred": VERDICT_CLASS[key]})
    return res


CARD_FILE = ROOT / "eval" / "model_card.json"


def build_card() -> dict | None:
    """Agreement with the labelled set for the current engine. None when eval/ is absent."""
    if not (ROOT / "eval" / "labels.csv").exists():
        return None
    from . import __version__, semantic
    m = run()
    keep = ("n", "accuracy", "kappa", "spearman", "p_at_1", "p_at_3", "false_rejections", "good",
            "stuffers_caught", "stuffers")
    return {
        **{k: m[k] for k in keep},
        "version": __version__,
        "semantic": semantic.available(),
        "labels": CLASSES,
        "confusion": [[m["confusion"].get((t, p), 0) for p in CLASSES] for t in CLASSES],
        "disagreements": [{"resume": Path(r["resume"]).stem, "job": r["job"], "label": r["label"],
                           "verdict": r["verdict"], "score": r["score"], "note": r["note"]}
                          for r in m["results"] if r["label"] != r["pred"]],
        "jobs": JOB_NAMES,
        "holdouts": _holdouts(),
    }


HOLDOUTS = [
    ("holdout_labels.csv", "Held-out set 1",
     "Labelled before scoring; later used to study errors, so slightly optimistic."),
    ("holdout2_labels.csv", "Held-out set 2",
     "Labelled before scoring. First unseen score was 57.9% (kappa 0.51); one bug found in its errors "
     "(real bullets flagged as stuffing) was then fixed."),
]


def _holdouts() -> list[dict]:
    """Agreement on the held-out sets: resume-job pairs labelled before the engine scored them."""
    out = []
    for fname, name, note in HOLDOUTS:
        if not (ROOT / "eval" / fname).exists():
            continue
        h = run(labels=fname)
        out.append({"name": name, "note": note, **{k: h[k] for k in (
            "n", "accuracy", "kappa", "spearman", "p_at_3", "false_rejections", "good", "stuffers_caught", "stuffers")}})
    return out


def write_card() -> None:
    """Pre-compute the card (the Docker build runs this) so the server does no work at startup."""
    import json
    card = build_card()
    if card:
        CARD_FILE.write_text(json.dumps(card, indent=1) + "\n", encoding="utf-8")


@lru_cache(maxsize=1)
def model_card() -> dict | None:
    """The card for the web app: the pre-computed file when it matches this version, else computed once."""
    import json
    from . import __version__, semantic
    if CARD_FILE.exists():
        try:
            card = json.loads(CARD_FILE.read_text(encoding="utf-8"))
            if card.get("version") == __version__ and card.get("semantic") == semantic.available():
                return card
        except ValueError:
            pass
    return build_card()
