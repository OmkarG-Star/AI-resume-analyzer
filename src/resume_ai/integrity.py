"""Checks for resumes written to game the scorer rather than describe the work.

Keyword scoring is easy to inflate: paste the job description into the resume,
or write one bullet that names every required tool. These checks find those
patterns so the engine can ignore the inflated parts and tell the recruiter
what it saw:

* copied text    lines that repeat the job description almost word for word.
                 They are removed before scoring.
* crammed bullet a single bullet naming five or more of the job's skills.
                 Skills that appear only in such bullets count as listed, not shown.
* years claim    a stated total ("12 years of experience") well above what the
                 dated roles add up to. The dated figure is used.

Each finding costs points (shown as an integrity penalty) and caps the verdict
at "Interview to verify", because a person should look before deciding.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .skills import find_skills

SHINGLE = 5                 # words per shingle when comparing resume lines with the job
COPY_THRESHOLD = 0.6        # share of a line's shingles found in the job to call it copied
MIN_COPY_WORDS = 6
CRAM_SKILLS = 6             # job skills named outright in one bullet to call it crammed
YEARS_GAP = 2.0             # stated years above dated years by more than this is flagged

PENALTY = {"copied": 12.0, "crammed": 6.0, "years": 4.0}
PENALTY_CAP = 20.0

_WORD = re.compile(r"[a-z0-9+#/]+")


def _words(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def _shingles(words: list[str], n: int = SHINGLE) -> set[tuple[str, ...]]:
    return {tuple(words[i:i + n]) for i in range(len(words) - n + 1)}


@dataclass
class Integrity:
    copied_lines: list[str] = field(default_factory=list)
    crammed_bullets: list[str] = field(default_factory=list)
    stated_years: float | None = None
    dated_years: float | None = None
    flags: list[str] = field(default_factory=list)
    penalty: float = 0.0

    @property
    def suspicious(self) -> bool:
        """True when the resume looks written for the scorer (not just an odd years claim)."""
        return bool(self.copied_lines or self.crammed_bullets)

    def as_dict(self) -> dict:
        return {"flags": self.flags, "penalty": self.penalty, "suspicious": self.suspicious,
                "copied_lines": len(self.copied_lines), "crammed_bullets": len(self.crammed_bullets)}


def copied_lines(resume: str, job: str) -> list[str]:
    """Resume lines that repeat the job description almost word for word."""
    job_sh = _shingles(_words(job))
    if not job_sh:
        return []
    out = []
    for line in resume.split("\n"):
        words = _words(line)
        if len(words) < MIN_COPY_WORDS:
            continue
        sh = _shingles(words)
        if sh and len(sh & job_sh) / len(sh) >= COPY_THRESHOLD:
            out.append(line.strip())
    return out


def strip_lines(text: str, lines: list[str]) -> str:
    drop = {l.strip() for l in lines}
    return "\n".join(l for l in text.split("\n") if l.strip() not in drop)


def crammed_bullets(bullets: list[str], job_skills: set[str]) -> list[str]:
    """Bullets that name CRAM_SKILLS or more of the job's skills at once.

    Implied skills are not counted, so a real bullet such as "Built Airflow
    pipelines into Snowflake with dbt" is not mistaken for a keyword list.
    """
    return [b for b in bullets if len(set(find_skills(b, implied=False)) & job_skills) >= CRAM_SKILLS]


def check(copied: list[str], bullets: list[str], job_skills: set[str],
          stated_years: float | None, dated_years: float | None) -> Integrity:
    res = Integrity(copied_lines=copied, crammed_bullets=crammed_bullets(bullets, job_skills),
                    stated_years=stated_years, dated_years=dated_years)
    if res.copied_lines:
        n = len(res.copied_lines)
        res.flags.append(f"{n} line{'s' if n != 1 else ''} copied from the job description "
                         "(ignored when scoring)")
        res.penalty += PENALTY["copied"]
    if res.crammed_bullets:
        n = len(res.crammed_bullets)
        res.flags.append(f"{n} bullet{'s' if n != 1 else ''} naming {CRAM_SKILLS}+ required skills at once "
                         "(counted as listed, not shown)")
        res.penalty += PENALTY["crammed"]
    if stated_years is not None and dated_years is not None and stated_years - dated_years > YEARS_GAP:
        res.flags.append(f"Claims {stated_years:g} years of experience but dated roles add up to "
                         f"{dated_years:g} (the dated figure is used)")
        res.penalty += PENALTY["years"]
    res.penalty = min(res.penalty, PENALTY_CAP)
    return res


