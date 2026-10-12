# Evaluation results

60 resume-job pairs labelled shortlist / maybe / reject (fictional resumes, author labels; see eval/README.md).

| Metric | Value |
|---|---|
| Verdict accuracy (3 classes) | 80.0% |
| Cohen's kappa (linear-weighted) | 0.77 |
| Spearman rho, score vs label | 0.84 |
| Precision@1 per job | 100.0% |
| Precision@3 per job | 100.0% |
| Good candidates wrongly rejected | 1 of 26 |
| Keyword stuffers kept off the shortlist | 3 of 3 |

Confusion matrix (rows: human label, columns: engine verdict)

| | reject | maybe | shortlist |
|---|---|---|---|
| **reject** | 32 | 2 | 0 |
| **maybe** | 1 | 5 | 7 |
| **shortlist** | 0 | 2 | 11 |

Disagreements

| Resume | Job | Label | Engine | Score |
|---|---|---|---|---|
| e01_vikas_rao | ae | maybe | Shortlist | 68.4 |
| e02_rahul_test | ae | reject | Interview to verify | 60.5 |
| e03_pooja_shinde | ae | maybe | Shortlist | 62.6 |
| e01_vikas_rao | de | maybe | Shortlist | 64.2 |
| e06_aditya_kulkarni | ds | maybe | Not a fit | 55.6 |
| e07_sagar_more | ds | reject | Interview to verify | 52.9 |
| 02_rohan_deshmukh | ds | maybe | Shortlist | 66.1 |
| e07_sagar_more | hr | maybe | Shortlist | 67.4 |
| e14_riya_sharma | hr | maybe | Shortlist | 64.6 |
| 01_ananya_kulkarni | hr | shortlist | Interview to verify | 67.1 |
| 02_rohan_deshmukh | hr | shortlist | Interview to verify | 64.1 |
| 03_meera_iyer | ml | maybe | Shortlist | 64 |
