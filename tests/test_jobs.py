from fastapi.testclient import TestClient

from resume_ai import store
from resume_ai.api import app

DESC = """Data Analyst

Requirements
- 2+ years of experience
- Strong SQL and Excel
- Power BI or Tableau

Nice to have
- Python
"""


def test_library_is_seeded_with_parsed_requirements():
    with TestClient(app) as c:
        r = c.get("/api/jobs").json()
    titles = [j["title"] for j in r["jobs"]]
    assert "Data Engineer" in titles and len(titles) >= 5
    assert [j["status"] for j in r["jobs"]] == sorted((j["status"] for j in r["jobs"]),
                                                      key=store.STATUSES.index)
    de = next(j for j in r["jobs"] if j["title"] == "Data Engineer")
    assert "SQL" in de["summary"]["must"] and de["summary"]["min_years"] == 2


def test_crud_duplicate_and_validation():
    with TestClient(app) as c:
        job = c.post("/api/jobs", json={"title": "Data Analyst", "department": "Finance", "description": DESC}).json()
        assert job["status"] == "Open" and "Power BI or Tableau" in job["summary"]["must"]
        jid = job["id"]

        upd = c.put(f"/api/jobs/{jid}", json={"status": "On hold", "openings": 3}).json()
        assert upd["status"] == "On hold" and upd["openings"] == 3 and upd["title"] == "Data Analyst"

        dup = c.post(f"/api/jobs/{jid}/duplicate").json()
        assert dup["title"] == "Data Analyst (copy)" and dup["id"] != jid

        assert c.post("/api/jobs", json={"title": "", "description": DESC}).status_code == 422
        assert c.post("/api/jobs", json={"title": "X", "description": "too short"}).status_code == 422
        assert c.put(f"/api/jobs/{jid}", json={"status": "Archived"}).status_code == 422

        assert c.delete(f"/api/jobs/{dup['id']}").status_code == 200
        assert c.get(f"/api/jobs/{dup['id']}").status_code == 404
        assert c.delete(f"/api/jobs/{dup['id']}").status_code == 404


def test_screening_a_saved_job_records_counts_only():
    with TestClient(app) as c:
        s = c.get("/api/samples").json()
        job = c.post("/api/jobs", json={"title": "DS", "description": s["jobs"][1]["text"]}).json()
        out = c.post("/api/screen", json={"job": job["description"], "job_id": job["id"], "resumes": s["resumes"]}).json()
        after = c.get(f"/api/jobs/{job['id']}").json()
    assert out["job_id"] == job["id"]
    assert after["screenings"] == 1 and after["candidates_screened"] == 6
    assert after["shortlisted"] == out["counts"]["strong"] + out["counts"]["shortlist"]
    assert after["last_screened_at"]


def test_preview_parses_without_saving():
    with TestClient(app) as c:
        n = len(c.get("/api/jobs").json()["jobs"])
        p = c.post("/api/jobs/preview", json={"description": DESC}).json()
        assert p["min_years"] == 2 and "SQL" in p["must"] and "Python" in p["nice"]
        assert len(c.get("/api/jobs").json()["jobs"]) == n
