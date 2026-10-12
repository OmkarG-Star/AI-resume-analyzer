"""Learn the score weights from the labelled set.

The engine's score is a weighted average of its parts. Here the weights are
fitted so each labelled pair's score falls in its label's band: below 46 for
"reject", 50-60 for "maybe" (Interview to verify) and above 64 for
"shortlist", just inside the verdict thresholds 48 / 62 / 74. Scores already
inside their band cost nothing (a squared hinge), so the fit only moves weights
to fix wrong verdicts.

With few labels the fit is pulled toward the hand-set weights (ridge penalty)
and every weight stays between 2 and 45. Quality is measured with
leave-one-resume-out cross-validation: each resume's pairs are scored by
weights learned without that resume, which is the honest number.

The learned weights are only adopted when their cross-validated kappa beats
the hand-set weights; otherwise weights.json records the result and the
engine keeps the hand-set weights. More (and real) labels are what make
learning pay off.

    python eval/train.py            # print results
    python eval/train.py --write    # save src/resume_ai/weights.json
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
from scipy.optimize import minimize

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from resume_ai import engine, evaluation  # noqa: E402

BAND = {"reject": (None, 46.0), "maybe": (50.0, 60.0), "shortlist": (64.0, None)}
KEYS = list(engine.HAND_WEIGHTS)
LAMBDA = 0.2          # strength of the pull toward the hand-set weights
LO, HI = 2.0, 45.0


def fit(pp: list[dict]) -> dict[str, float]:
    hand = np.array([engine.HAND_WEIGHTS[k] for k in KEYS], dtype=float)
    vals = np.array([[np.nan if x["parts"][k] is None else x["parts"][k] for k in KEYS] for x in pp])
    pen = np.array([x["integ"].penalty for x in pp])
    lo = np.array([BAND[x["label"]][0] or -1e9 for x in pp])
    hi = np.array([BAND[x["label"]][1] or 1e9 for x in pp])
    mask = ~np.isnan(vals)
    v0 = np.nan_to_num(vals)

    def loss(w):
        score = np.clip((v0 * w * mask).sum(1) / (w * mask).sum(1) * 100 - pen, 0, 100)
        miss = np.maximum(0, lo - score) ** 2 + np.maximum(0, score - hi) ** 2
        return np.mean(miss) + LAMBDA * np.sum((w - hand) ** 2) / len(KEYS)

    res = minimize(loss, hand, method="SLSQP", bounds=[(LO, HI)] * len(KEYS),
                   constraints=[{"type": "eq", "fun": lambda w: w.sum() - 100}])
    return {k: round(float(v), 1) for k, v in zip(KEYS, res.x)}


def cross_validated(pp: list[dict]) -> dict:
    results = []
    for resume in sorted({x["resume"] for x in pp}):
        train = [x for x in pp if x["resume"] != resume]
        test = [x for x in pp if x["resume"] == resume]
        results += evaluation.score_with(test, fit(train))
    return evaluation.metrics(results)


def summary(m: dict) -> dict:
    return {k: round(m[k], 4) if isinstance(m[k], float) else m[k]
            for k in ("n", "accuracy", "kappa", "spearman", "p_at_1", "p_at_3",
                      "false_rejections", "good", "stuffers_caught", "stuffers")}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--write", action="store_true", help="save src/resume_ai/weights.json")
    args = ap.parse_args()
    pp = evaluation.prepared()
    hand = summary(evaluation.metrics(evaluation.score_with(pp, engine.HAND_WEIGHTS)))
    learned = fit(pp)
    insample = summary(evaluation.metrics(evaluation.score_with(pp, learned)))
    cv = summary(cross_validated(pp))
    print("weights (hand -> learned):")
    for k in KEYS:
        print(f"  {engine.PART_LABELS[k]:22s} {engine.HAND_WEIGHTS[k]:5.1f} -> {learned[k]:5.1f}")
    for name, m in (("hand weights", hand), ("learned, in-sample", insample), ("learned, cross-validated", cv)):
        print(f"{name:26s} acc {m['accuracy']:.3f}  kappa {m['kappa']:.3f}  spearman {m['spearman']:.3f}  "
              f"P@3 {m['p_at_3']:.2f}  false rejections {m['false_rejections']}/{m['good']}  stuffers {m['stuffers_caught']}/{m['stuffers']}")
    adopt = cv["kappa"] > hand["kappa"] and cv["false_rejections"] <= hand["false_rejections"]
    print("adopt learned weights:", "yes" if adopt else
          "no - they do not beat the hand-set weights in cross-validation, so the engine keeps the hand-set weights")
    if args.write:
        out = {"adopted": adopt, "weights": learned, "hand_weights": engine.HAND_WEIGHTS, "trained_on": len(pp),
               "date": date.today().isoformat(), "semantic": engine.semantic.available(),
               "method": "squared hinge to label bands (<46, 50-60, >64), ridge pull to hand weights, weights 2-45, sum 100",
               "hand_metrics": hand, "in_sample": insample, "cross_validated": cv}
        engine.WEIGHTS_FILE.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
        print(f"saved {engine.WEIGHTS_FILE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
