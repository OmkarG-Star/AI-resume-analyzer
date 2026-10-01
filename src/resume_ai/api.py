"""HTTP API and the served web app.

Resumes are read in memory, analysed and discarded: nothing about a candidate
is written to disk or logged. The only thing stored is the company's job
library (job descriptions plus screening counts), see store.py.

  GET  /api/health
  GET  /api/samples                  sample jobs and resumes for the demo
  POST /api/parse-file               extract text from an uploaded PDF/DOCX/TXT
  POST /api/analyze                  one resume vs one job (candidate mode)
  POST /api/screen                   many resumes vs one job (recruiter mode)
  POST /api/screen/export            the ranked shortlist as CSV
  GET  /api/jobs                     the job library, each with its parsed requirements
  POST /api/jobs                     add a job description
  GET  /api/jobs/{id}                one job
  PUT  /api/jobs/{id}                edit a job (any subset of fields)
  DELETE /api/jobs/{id}              remove a job
  POST /api/jobs/{id}/duplicate      copy a job as a draft (On hold)
  POST /api/jobs/preview             parse a description without saving it
"""
from __future__ import annotations

import csv
import io
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__, engine, store
from . import jd as jdmod
from .parsing import extract_text

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
SAMPLES = ROOT / "samples"
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_RESUMES = 50
ALLOWED = (".pdf", ".docx", ".txt", ".md")



def seed_jobs() -> list[dict]:
    meta = SAMPLES / "library" / "library.json"
    if not meta.exists():
        return []
    out = []
    for m in json.loads(meta.read_text(encoding="utf-8")):
        m = dict(m)
        m["description"] = (SAMPLES / "library" / m.pop("file")).read_text(encoding="utf-8")
        out.append(m)
    return out


@asynccontextmanager
async def lifespan(_app):
    store.init(seed_jobs())
    yield


app = FastAPI(title="Resume Intelligence", version=__version__, lifespan=lifespan,
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
    job_id: int | None = None


class JobIn(BaseModel):
    title: str | None = Field(None, max_length=120)
    department: str | None = Field(None, max_length=80)
    location: str | None = Field(None, max_length=80)
    employment_type: str | None = None
    status: str | None = None
    hiring_manager: str | None = Field(None, max_length=80)
    openings: int | None = Field(None, ge=1, le=999)
    description: str | None = Field(None, max_length=30_000)


class PreviewIn(BaseModel):
    description: str = Field("", max_length=30_000)


def with_summary(job: dict) -> dict:
    s = engine.job_summary(jdmod.parse(job["description"]))
    job["summary"] = {"must": s["must_units"], "nice": s["nice_units"], "min_years": s["min_years"],
                      "education": s["education"], "seniority": s["seniority"]}
    return job


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
    out = engine.screen(body.job, [(r.name, r.text) for r in body.resumes])
    if body.job_id is not None and store.get(body.job_id):
        store.record_screening(body.job_id, len(out["candidates"]), out["counts"]["strong"] + out["counts"]["shortlist"])
        out["job_id"] = body.job_id
    return out


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


# ------------------------------------------------------------------ job library
def _or_404(job):
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@app.get("/api/jobs")
def jobs_list():
    return {"jobs": [with_summary(j) for j in store.list_jobs()],
            "statuses": store.STATUSES, "employment_types": store.EMPLOYMENT}


@app.post("/api/jobs/preview")
def jobs_preview(body: PreviewIn):
    if len(body.description.strip()) < 20:
        return {"must": [], "nice": [], "min_years": None, "education": None, "seniority": None, "title": None}
    s = engine.job_summary(jdmod.parse(body.description))
    return {"must": s["must_units"], "nice": s["nice_units"], "min_years": s["min_years"],
            "education": s["education"], "seniority": s["seniority"], "title": s["title"]}


@app.post("/api/jobs", status_code=201)
def jobs_create(body: JobIn):
    try:
        return with_summary(store.create(body.model_dump(exclude_none=True)))
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.get("/api/jobs/{job_id}")
def jobs_get(job_id: int):
    return with_summary(_or_404(store.get(job_id)))


@app.put("/api/jobs/{job_id}")
def jobs_update(job_id: int, body: JobIn):
    try:
        return with_summary(_or_404(store.update(job_id, body.model_dump(exclude_none=True))))
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.delete("/api/jobs/{job_id}")
def jobs_delete(job_id: int):
    if not store.delete(job_id):
        raise HTTPException(404, "Job not found")
    return {"deleted": job_id}


@app.post("/api/jobs/{job_id}/duplicate", status_code=201)
def jobs_duplicate(job_id: int):
    return with_summary(_or_404(store.duplicate(job_id)))


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
