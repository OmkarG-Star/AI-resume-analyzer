# Evaluation

How well do the verdicts agree with a person's judgement? This folder answers that with numbers.

- `labels.csv`: 60 resume-job pairs, each labelled **shortlist**, **maybe** or **reject**.
- `resumes/`: 14 extra fictional resumes chosen to be hard for a keyword screener. They include people who describe their work without naming tools, keyword stuffers who paste the job description, an inflated "10 years" claim, career changers and fresh graduates.
- `holdout/` and `holdout_labels.csv`: 12 more resumes (21 pairs) written and labelled *before* the engine scored them, and never used to tune it. Run `python eval/evaluate.py --labels holdout_labels.csv`.
- `holdout2/` and `holdout2_labels.csv`: a second held-out set (12 resumes, 19 pairs), committed before the engine scored it.
- `import_labels.py`: turns labels downloaded from the app (recruiters marking verdicts right or wrong) into `recruiter_labels.csv`.
- `evaluate.py`: scores every pair and reports the agreement.
- `train.py`: learns weights and keeps them only if they beat the hand-set ones under leave-one-resume-out cross-validation.

```bash
python eval/evaluate.py            # print the report
python eval/evaluate.py --write    # also update RESULTS.md
python eval/evaluate.py --src ../other-checkout/src   # compare another version of the engine
```

## Metrics

| Metric | What it tells you |
|---|---|
| Verdict accuracy | Share of pairs where the verdict class matches the label. Strong shortlist and Shortlist count as shortlist, and Interview to verify counts as maybe. |
| Cohen's kappa (linear-weighted) | Agreement after removing chance. A miss by one step (maybe vs reject) costs half as much as a miss by two. |
| Spearman rho | Whether the 0–100 score puts people in the right order. |
| Precision@1, @3 | For each job, the share of the top-ranked candidates a person would at least interview. |
| Good candidates wrongly rejected | The costliest error for a screener: someone worth talking to who gets "Not a fit". |
| Stuffers kept off the shortlist | Whether keyword-stuffed resumes are caught. |

## Read this before quoting the numbers

The resumes are fictional and the labels were written by the project author from each job's requirements, before the engine was run on them. That makes this a sound **regression test and a demonstration of the method**. It is not proof of real-world accuracy: 60 pairs is small, and one person's labels carry that person's view.

To get numbers you can rely on, replace the set with anonymised real resumes labelled by two or more recruiters. Report their agreement with each other next to the engine's agreement with them: the engine cannot be expected to agree with recruiters more than recruiters agree with each other.

Don't tune the weights against this set until it is bigger. Adjusting rules until the author's own labels match would only overfit them.

`tests/test_integrity.py` fails if kappa drops below 0.70, Spearman below 0.75, more than two good candidates are rejected, or any stuffer is missed.
