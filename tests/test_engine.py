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
