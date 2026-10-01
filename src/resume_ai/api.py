"""HTTP API and the served web app.

Stateless by design: uploads are read in memory, analysed and discarded.
Nothing about a candidate is written to disk or logged.

  GET  /api/health
  GET  /api/samples                  sample jobs and resumes for the demo
  POST /api/parse-file               extract text from an uploaded PDF/DOCX/TXT
  POST /api/analyze                  one resume vs one job (candidate mode)
  POST /api/screen                   many resumes vs one job (recruiter mode)
  POST /api/screen/export            the ranked shortlist as CSV
"""
from __future__ import annotations

import csv
import io
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__, engine
from . import jd as jdmod
from .parsing import extract_text

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
SAMPLES = ROOT / "samples"
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_RESUMES = 50
ALLOWED = (".pdf", ".docx", ".txt", ".md")

app = FastAPI(title="Resume Intelligence", version=__version__,
              docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(GZipMiddleware, minimum_size=800)


class ResumeIn(BaseModel):
    name: str = Field("resume.txt", max_length=200)
    text: str = Field(..., min_length=20, max_length=60_000)


class AnalyzeIn(BaseModel):
    resume: str = Field(..., min_length=20, max_length=60_000)
    job: str = Field(..., min_length=20, max_length=30_000)
    assume_skills: list[str] = Field(default_factory=list, max_length=40)


class ScreenIn(BaseModel):
    job: str = Field(..., min_length=20, max_length=30_000)
    resumes: list[ResumeIn] = Field(..., min_length=1, max_length=MAX_RESUMES)


@app.get("/api/health")
def health():
    return {"status": "ok", "version": __version__}


@app.get("/api/samples")
def samples():
    jobs = [{"id": p.stem, "title": p.stem.replace("_", " ").title(), "text": p.read_text(encoding="utf-8")}
            for p in sorted((SAMPLES / "jobs").glob("*.txt"))]
    resumes = [{"name": p.name, "text": p.read_text(encoding="utf-8")}
               for p in sorted((SAMPLES / "resumes").glob("*.txt"))]
    return {"jobs": jobs, "resumes": resumes}


@app.post("/api/parse-file")
async def parse_file(file: UploadFile = File(...)):
    name = file.filename or "upload"
    if not name.lower().endswith(ALLOWED):
        raise HTTPException(415, "Upload a PDF, DOCX or TXT file")
    data = await file.read()
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(413, "File is larger than 5 MB")
    try:
        text = extract_text(name, data)
    except Exception:
        raise HTTPException(422, f"Could not read {name}. If it is a scanned PDF, export it with selectable text.")
    if len(text.strip()) < 20:
        raise HTTPException(422, f"{name} has almost no readable text. Scanned PDFs need OCR first.")
    return {"name": name, "text": text, "words": len(text.split())}


@app.post("/api/analyze")
def analyze(body: AnalyzeIn):
    result = engine.analyze(body.resume, body.job, assume_skills=body.assume_skills)
    result["job"] = engine.job_summary(jdmod.parse(body.job))
    return result


@app.post("/api/screen")
def screen(body: ScreenIn):
    return engine.screen(body.job, [(r.name, r.text) for r in body.resumes])


@app.post("/api/screen/export")
def export(body: ScreenIn):
    out = engine.screen(body.job, [(r.name, r.text) for r in body.resumes])
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["rank", "candidate", "file", "score", "verdict", "must_have_matched", "years",
                "missing_must_haves", "strengths", "risks", "next_step"])
    for c in out["candidates"]:
        w.writerow([c["rank"], c["label"], c["file"], c["score"], c["verdict"]["label"],
                    f'{c["summary"]["must_matched"]}/{len(out["job"]["must_units"])}', c["summary"]["years"],
                    "; ".join(r["skill"] for r in c["skills"] if r["importance"] == "must" and r["status"] == "missing"),
                    " | ".join(c["strengths"]), " | ".join(c["risks"]), c["verdict"]["next"]])
    return PlainTextResponse(buf.getvalue(), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=shortlist.csv"})


# ------------------------------------------------------------------ web app
if (FRONTEND / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND / "assets"), name="assets")


@app.get("/")
def index():
    return FileResponse(FRONTEND / "index.html")


@app.get("/{path:path}")
def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404, "Unknown API route")
    return FileResponse(FRONTEND / "index.html")
