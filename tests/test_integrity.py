import glob

from conftest import SAMPLES
from resume_ai import engine
from resume_ai.skills import find_related

ROOT = SAMPLES.parent
DE_JOB = (SAMPLES / "jobs" / "data_engineer.txt").read_text()
ARJUN = (SAMPLES / "resumes" / "06_arjun_nair.txt").read_text()


def test_pasting_the_job_description_does_not_reach_the_shortlist():
    stuffed = ("Rahul Kumar\nrahul@example.com +91 98765 43210\nSummary\nData engineer.\n"
               "Experience\nData Engineer — Freelance | Jan 2025 – Present\n" + DE_JOB)
    r = engine.analyze(stuffed, DE_JOB)
    assert r["integrity"]["copied_lines"] >= 3
    assert r["integrity"]["suspicious"] and r["integrity"]["penalty"] > 0
    assert r["verdict"]["key"] in {"verify", "reject"}
    assert r["risks"][0].startswith("Integrity:")


def test_crammed_bullet_counts_as_listed_not_shown():
    job = "Requirements\n- Python\n- SQL\n- Airflow\n- dbt\n- Snowflake\n- Docker"
    cram = ("Experience\nEngineer — Acme | Jan 2022 – Present\n"
            "- Built Python, SQL, Airflow, dbt, Snowflake and Docker pipelines\nSkills\nPython")
    r = engine.analyze(cram, job)
    assert r["integrity"]["crammed_bullets"] == 1
    assert all(row["status"] != "shown" for row in r["skills"])


def test_real_detailed_bullets_are_not_flagged():
    r = engine.analyze(ARJUN, DE_JOB)
    assert not r["integrity"]["flags"]
    assert r["verdict"]["key"] == "strong"


def test_inflated_years_claim_uses_dated_roles():
    resume = ("Summary\n12 years of experience in data engineering.\n"
              "Experience\nData Engineer — Acme | Jan 2025 – Jun 2026\n- Built Airflow pipelines into Snowflake")
    r = engine.analyze(resume, DE_JOB)
    assert r["summary"]["years"] < 3
    assert any("Claims 12 years" in f for f in r["integrity"]["flags"])


def test_work_described_without_tool_names_gets_partial_credit():
    hits = find_related("- Orchestrated DAG-based workflows for 40 pipelines\n- Designed star-schema fact tables")
    assert {"Airflow", "Data Modeling", "Data Warehousing"} <= set(hits)
    resume = ("Experience\nData Engineer — Acme | Jan 2021 – Present\n"
              "- Orchestrated DAG-based workflows in Python for 40 pipelines\n- Wrote SQL reports")
    r = engine.analyze(resume, DE_JOB)
    airflow = next(row for row in r["skills"] if row["skill"] == "Airflow")
    assert airflow["status"] == "related" and airflow["evidence"]
    assert any(q["why"] == "Related work, tool not named" for q in r["questions"])


def test_score_does_not_depend_on_the_rest_of_the_batch():
    resumes = [(p, open(p).read()) for p in sorted(glob.glob(str(SAMPLES / "resumes" / "*.txt")))]
    full = {c["file"]: c["score"] for c in engine.screen(DE_JOB, resumes)["candidates"]}
    pair = {c["file"]: c["score"] for c in engine.screen(DE_JOB, resumes[:2])["candidates"]}
    alone = engine.analyze(resumes[0][1], DE_JOB)["score"]
    assert all(full[f] == pair[f] for f in pair)
    assert full[resumes[0][0]] == alone


def test_evaluation_set_stays_above_baseline():
    """Guard against regressions on the labelled set in eval/."""
    from resume_ai import evaluation
    m = evaluation.run()
    assert m["kappa"] >= 0.70
    assert m["spearman"] >= 0.75
    assert m["stuffers_caught"] == m["stuffers"]
    assert m["false_rejections"] <= 2
