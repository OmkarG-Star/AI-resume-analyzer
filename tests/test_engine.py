import glob

from conftest import SAMPLES
from resume_ai import engine


def _sample(job):
    j = (SAMPLES / "jobs" / f"{job}.txt").read_text()
    rs = [(p, open(p).read()) for p in sorted(glob.glob(str(SAMPLES / "resumes" / "*.txt")))]
    return engine.screen(j, rs)


def test_ranking_puts_the_right_people_first():
    ds = _sample("data_scientist")
    assert ds["candidates"][0]["file"].endswith(("01_ananya_kulkarni.txt", "05_sneha_patil.txt"))
    de = _sample("data_engineer")
    assert de["candidates"][0]["file"].endswith("06_arjun_nair.txt")


def test_every_verdict_has_reasons():
    for c in _sample("data_scientist")["candidates"]:
        assert c["verdict"]["key"] in {"strong", "shortlist", "verify", "reject"}
        assert c["strengths"] or c["risks"]
        assert c["questions"]
        assert 0 <= c["score"] <= 100


def test_weak_resume_is_rejected_with_knockout():
    kabir = next(c for c in _sample("data_scientist")["candidates"] if "04_" in c["file"])
    assert kabir["verdict"]["key"] == "reject" and kabir["verdict"]["knockouts"]


def test_listed_skill_scores_below_demonstrated_skill():
    job = "Requirements\n- Python\n- SQL"
    shown = engine.analyze("Experience\n- Built Python and SQL reports for 20 teams\nSkills\nPython, SQL", job)
    listed = engine.analyze("Experience\n- Prepared reports for 20 teams\nSkills\nPython, SQL", job)
    assert shown["parts"][0]["value"] > listed["parts"][0]["value"]


def test_what_if_raises_score_and_gains_are_measured():
    job = (SAMPLES / "jobs" / "data_scientist.txt").read_text()
    resume = (SAMPLES / "resumes" / "04_kabir_shah.txt").read_text()
    base = engine.analyze(resume, job)
    boosted = engine.analyze(resume, job, assume_skills=["Pandas", "NumPy"])
    assert boosted["score"] > base["score"]
    assert all(s["gain"] >= 0 for s in base["suggestions"])
    assert base["suggestions"] == sorted(base["suggestions"], key=lambda s: -s["gain"])


def test_rewrites_are_grammatical_and_never_invent_numbers():
    assert engine.rewrite("Responsible for preparing daily MIS reports").startswith("Prepared daily MIS reports")
    assert engine.rewrite("Helped the HR team with attendance").startswith("Supported the HR team")
    out = engine.rewrite("Worked on dashboards for sales")
    assert out.startswith("Built dashboards") and "[add the result" in out


def test_soft_skills_never_decide_the_verdict():
    from resume_ai import jd
    spec = jd.parse("Requirements\n- SQL and Excel\n- Clear written and verbal communication")
    assert "Communication" not in spec.required and "Communication" in spec.preferred


def test_only_relevant_roles_count_as_experience():
    job = (SAMPLES / "library" / "hr_data_analyst.txt").read_text()
    resume = ("Experience\nProduction Engineer — Acme | Jan 2018 – Dec 2024\n- Ran three shifts and cut scrap by 8%\n"
              "Data Analyst — Beta | Jan 2025 – Present\n- Built Power BI dashboards and SQL reports for 20 managers\n"
              "Skills\nSQL, Power BI, Excel")
    r = engine.analyze(resume, job)
    assert r["summary"]["total_years"] > 7 and r["summary"]["years"] < 3
    assert any("roles that use this job's skills" in x for x in r["risks"])


def test_shortlist_needs_most_of_the_experience():
    job = "Requirements\n- 3+ years of experience\n- Python\n- SQL"
    junior = ("Experience\nAnalyst — Acme | Jan 2026 – Present\n- Built Python and SQL reports for 20 teams, saving 10 hours a week\n"
              "Skills\nPython, SQL")
    assert engine.analyze(junior, job)["verdict"]["key"] in {"verify", "reject"}


def test_relevant_projects_soften_missing_years():
    job = (SAMPLES / "library" / "hr_data_analyst.txt").read_text()
    resume = ("Experience\nTeacher — School | Jun 2017 – May 2025\n- Taught 200 students a year\n"
              "Projects\n- Power BI dashboard on HR attrition\n- SQL analysis of 30,000 orders\nSkills\nSQL, Power BI, Excel")
    r = engine.analyze(resume, job)
    assert r["verdict"]["key"] != "reject" or r["score"] < 45
    assert any("projects" in x for x in r["risks"])


def test_keyword_similarity_matches_scikit_learn_exactly():
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
    job = (SAMPLES / "jobs" / "data_engineer.txt").read_text()
    for path in sorted(glob.glob(str(SAMPLES / "resumes" / "*.txt")))[:3]:
        resume = open(path).read()
        docs = [job, resume] + [d for d in engine.reference_corpus() if d not in (job, resume)]
        m = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), sublinear_tf=True).fit_transform(docs)
        assert abs(engine.similarity(resume, job) - cosine_similarity(m[0:1], m[1:2])[0][0]) < 1e-9


def test_close_call_flags_strong_rejects_without_changing_the_verdict():
    job = (SAMPLES / "jobs" / "data_scientist.txt").read_text()
    for path in sorted(glob.glob(str(SAMPLES.parent / "eval" / "**" / "*.txt"), recursive=True)):
        r = engine.analyze(open(path).read(), job)
        assert r["close_call"] == (r["verdict"]["key"] == "reject" and r["score"] >= engine.CLOSE_CALL
                                   and not r["integrity"]["suspicious"])


def test_screening_in_one_batch_matches_one_at_a_time():
    job = (SAMPLES / "jobs" / "data_scientist.txt").read_text()
    rs = [(p, open(p).read()) for p in sorted(glob.glob(str(SAMPLES / "resumes" / "*.txt")))]
    batch = {c["file"]: c["score"] for c in engine.screen(job, rs)["candidates"]}
    assert all(batch[p] == engine.analyze(t, job)["score"] for p, t in rs)


def test_role_headers_are_not_used_as_evidence():
    from resume_ai import semantic
    lines = semantic.units("Data Scientist — Relecloud | Jun 2020 – Dec 2021\n- Built churn models in Python for 3 teams")
    assert lines == ["Built churn models in Python for 3 teams"]
