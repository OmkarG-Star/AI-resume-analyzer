"""Job library: the company's saved job descriptions.

A small SQLite database. Only job descriptions and screening *counts* are
stored; resumes and candidate details never touch the disk.

The database path comes from JOBS_DB (default data/jobs.db). On hosts with an
ephemeral filesystem (e.g. Render's free plan) point JOBS_DB at a persistent
disk, or the library resets to the sample jobs on every restart.
"""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STATUSES = ("Open", "On hold", "Closed")
EMPLOYMENT = ("Full-time", "Part-time", "Contract", "Internship")

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL,
    department      TEXT NOT NULL DEFAULT '',
    location        TEXT NOT NULL DEFAULT '',
    employment_type TEXT NOT NULL DEFAULT 'Full-time',
    status          TEXT NOT NULL DEFAULT 'Open',
    hiring_manager  TEXT NOT NULL DEFAULT '',
    openings        INTEGER NOT NULL DEFAULT 1,
    description     TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    screenings      INTEGER NOT NULL DEFAULT 0,
    candidates_screened INTEGER NOT NULL DEFAULT 0,
    shortlisted     INTEGER NOT NULL DEFAULT 0,
    last_screened_at TEXT
);
"""

FIELDS = ("title", "department", "location", "employment_type", "status", "hiring_manager", "openings", "description")


def db_path() -> Path:
    p = Path(os.environ.get("JOBS_DB", ROOT / "data" / "jobs.db"))
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


@contextmanager
def connect():
    con = sqlite3.connect(db_path())
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    try:
        yield con
        con.commit()
    finally:
        con.close()


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def init(seed: list[dict] | None = None) -> None:
    with connect() as con:
        empty = con.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 0
    if empty and seed:
        for job in seed:
            create(job)


def _clean(data: dict, partial: bool = False) -> dict:
    out = {}
    for k in FIELDS:
        if k not in data:
            continue
        v = data[k]
        if k == "openings":
            v = max(1, min(999, int(v or 1)))
        elif isinstance(v, str):
            v = v.strip()
        out[k] = v
    if "status" in out and out["status"] not in STATUSES:
        raise ValueError(f"status must be one of {', '.join(STATUSES)}")
    if "employment_type" in out and out["employment_type"] not in EMPLOYMENT:
        raise ValueError(f"employment type must be one of {', '.join(EMPLOYMENT)}")
    if not partial:
        if not out.get("title"):
            raise ValueError("A job title is required")
        if len(out.get("description", "")) < 40:
            raise ValueError("The job description is too short to analyse (40+ characters)")
    if "title" in out and not out["title"]:
        raise ValueError("A job title is required")
    if "description" in out and len(out["description"]) < 40:
        raise ValueError("The job description is too short to analyse (40+ characters)")
    return out


def list_jobs() -> list[dict]:
    with connect() as con:
        rows = con.execute("SELECT * FROM jobs ORDER BY CASE status WHEN 'Open' THEN 0 WHEN 'On hold' THEN 1 ELSE 2 END, "
                           "updated_at DESC").fetchall()
    return [dict(r) for r in rows]


def get(job_id: int) -> dict | None:
    with connect() as con:
        r = con.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return dict(r) if r else None


def create(data: dict) -> dict:
    d = _clean(data)
    d.setdefault("status", "Open")
    d.setdefault("employment_type", "Full-time")
    ts = now()
    cols = list(d) + ["created_at", "updated_at"]
    with connect() as con:
        cur = con.execute(f"INSERT INTO jobs ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                          [*d.values(), ts, ts])
        new_id = cur.lastrowid
    return get(new_id)


def update(job_id: int, data: dict) -> dict | None:
    d = _clean(data, partial=True)
    if not get(job_id):
        return None
    if d:
        sets = ", ".join(f"{k} = ?" for k in d)
        with connect() as con:
            con.execute(f"UPDATE jobs SET {sets}, updated_at = ? WHERE id = ?", [*d.values(), now(), job_id])
    return get(job_id)


def delete(job_id: int) -> bool:
    with connect() as con:
        return con.execute("DELETE FROM jobs WHERE id = ?", (job_id,)).rowcount > 0


def duplicate(job_id: int) -> dict | None:
    src = get(job_id)
    if not src:
        return None
    copy = {k: src[k] for k in FIELDS}
    copy["title"] = f"{src['title']} (copy)"
    copy["status"] = "On hold"
    return create(copy)


def record_screening(job_id: int, candidates: int, shortlisted: int) -> None:
    """Keep counts only: how many were screened and how many made a shortlist."""
    with connect() as con:
        con.execute("UPDATE jobs SET screenings = screenings + 1, candidates_screened = candidates_screened + ?, "
                    "shortlisted = shortlisted + ?, last_screened_at = ? WHERE id = ?",
                    (candidates, shortlisted, now(), job_id))
