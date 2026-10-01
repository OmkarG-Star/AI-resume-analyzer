import io

from fastapi.testclient import TestClient

from resume_ai.api import app

client = TestClient(app)


def test_health_and_samples():
    assert client.get("/api/health").json()["status"] == "ok"
    s = client.get("/api/samples").json()
    assert len(s["jobs"]) == 2 and len(s["resumes"]) == 6


def test_screen_and_export():
    s = client.get("/api/samples").json()
    body = {"job": s["jobs"][1]["text"], "resumes": s["resumes"]}
    r = client.post("/api/screen", json=body).json()
    assert [c["rank"] for c in r["candidates"]] == list(range(1, 7))
    csv = client.post("/api/screen/export", json=body).text
    assert csv.startswith("rank,candidate") and csv.count("\n") == 7


def test_analyze_with_what_if():
    s = client.get("/api/samples").json()
    body = {"resume": s["resumes"][3]["text"], "job": s["jobs"][1]["text"]}
    a = client.post("/api/analyze", json=body).json()
    b = client.post("/api/analyze", json={**body, "assume_skills": ["Pandas"]}).json()
    assert b["score"] > a["score"] and "job" in a


def test_upload_txt_docx_pdf():
    r = client.post("/api/parse-file", files={"file": ("cv.txt", b"Python developer with SQL skills and more text", "text/plain")})
    assert r.status_code == 200 and "Python" in r.json()["text"]

    import docx
    d = docx.Document(); d.add_paragraph("Data analyst skilled in Power BI and Excel dashboards")
    buf = io.BytesIO(); d.save(buf)
    r = client.post("/api/parse-file", files={"file": ("cv.docx", buf.getvalue(), "application/octet-stream")})
    assert r.status_code == 200 and "Power BI" in r.json()["text"]

    from reportlab.pdfgen import canvas
    buf = io.BytesIO(); c = canvas.Canvas(buf); c.drawString(72, 720, "Machine learning engineer using PyTorch and Docker"); c.save()
    r = client.post("/api/parse-file", files={"file": ("cv.pdf", buf.getvalue(), "application/pdf")})
    assert r.status_code == 200 and "PyTorch" in r.json()["text"]


def test_rejects_bad_uploads_and_input():
    assert client.post("/api/parse-file", files={"file": ("a.exe", b"x" * 50, "x")}).status_code == 415
    assert client.post("/api/analyze", json={"resume": "short", "job": "short"}).status_code == 422
    assert client.get("/api/nope").status_code == 404
