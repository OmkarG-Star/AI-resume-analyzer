"""Read a job description into requirements.

Skills are split into must-have and nice-to-have. A skill counts as
nice-to-have when it only appears under a "nice to have" style heading or in a
sentence with words like "preferred", "bonus" or "plus". Minimum years and
education are read from phrases such as "3+ years of experience" and
"Bachelor's degree".
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .parsing import EDU_LEVELS, normalise
from .skills import find_skills, skill_spans

PREFERRED_WORDS = re.compile(
    r"\b(preferred|nice[- ]to[- ]have|good[- ]to[- ]have|a plus|is a plus|bonus|desirable|"
    r"advantage|ideally|familiarity|exposure to|would be great|optional)\b", re.I)
PREFERRED_HEADINGS = re.compile(r"^(nice[- ]to[- ]have|good[- ]to[- ]have|preferred|bonus|desired|plus)\b", re.I)
REQUIRED_HEADINGS = re.compile(
    r"^(requirements?|must[- ]haves?|required|qualifications|what you('| wi)ll need|who you are|"
    r"key skills|skills required|minimum qualifications|what we('re| are) looking for|you have|"
    r"skills (and|&) experience)\b", re.I)
CONTEXT_HEADINGS = re.compile(
    r"^(responsibilities|what you('| wi)ll do|the role|about the role|about us|your day|key responsibilities|"
    r"role overview|duties)\b", re.I)
YEARS_RE = re.compile(r"(\d{1,2})\s*\+?\s*(?:-|–|to)?\s*(\d{1,2})?\s*\+?\s*(?:years|yrs)", re.I)
TITLE_RE = re.compile(r"\b(?:senior|sr\.?|junior|jr\.?|lead|principal|staff|associate)?\s*"
                      r"(data (?:scientist|engineer|analyst)|machine learning engineer|ml engineer|"
                      r"ai engineer|business analyst|analytics engineer|bi developer|software engineer|"
                      r"mis executive|hr analyst|product analyst)\b", re.I)


@dataclass
class JobSpec:
    text: str
    title: str | None
    seniority: str | None
    required: list[str]
    preferred: list[str]
    groups: list[list[str]]          # either-or alternatives, e.g. ["Power BI", "Tableau"]
    min_years: float | None
    education_level: int
    education_label: str | None


def _sentences(text: str) -> list[str]:
    parts = []
    for line in text.split("\n"):
        parts.extend(s for s in re.split(r"(?<=[.;!?])\s+", line) if s.strip())
    return parts


_CONNECTOR = re.compile(r"^\s*(,|/|or|,\s*or|and/or)\s*$", re.I)


def alternatives(sentence: str) -> list[list[str]]:
    """Find runs like "Power BI or Tableau" / "Snowflake, BigQuery or Redshift".

    A run is a chain of skills joined only by commas, slashes or "or"; it
    becomes an either-or group only if at least one joint is "or" or "/".
    """
    spans = skill_spans(sentence)
    groups: list[list[str]] = []
    run: list[str] = []
    has_or = False

    def close():
        if len(run) > 1 and has_or:
            g = list(dict.fromkeys(run))
            if len(g) > 1:
                groups.append(g)

    for a, b in zip(spans, spans[1:]):
        between = sentence[a[1]:b[0]]
        is_or = bool(re.search(r"\bor\b|/", between, re.I))
        if _CONNECTOR.match(between) and not (has_or and not is_or):
            if not run:
                run = [a[2]]
            run.append(b[2])
            has_or = has_or or is_or
        else:
            close()
            run, has_or = [], False
    close()
    return groups


def parse(text: str) -> JobSpec:
    text = normalise(text)
    required: dict[str, int] = {}
    preferred: dict[str, int] = {}
    context: dict[str, int] = {}
    mode = None
    has_requirements_section = False
    groups: list[list[str]] = []
    for line in text.split("\n"):
        stripped = line.strip().lstrip("-•* ").rstrip(":")
        if len(stripped) < 60:
            if PREFERRED_HEADINGS.match(stripped):
                mode = "preferred"
            elif REQUIRED_HEADINGS.match(stripped):
                mode, has_requirements_section = "required", True
            elif CONTEXT_HEADINGS.match(stripped):
                mode = "context"
        for sentence in _sentences(line):
            hits = find_skills(sentence)
            if not hits:
                continue
            if mode == "preferred" or PREFERRED_WORDS.search(sentence):
                target = preferred
            elif mode == "context":
                target = context
            else:
                target = required
            for s, n in hits.items():
                target[s] = target.get(s, 0) + n
            groups.extend(g for g in alternatives(sentence) if g not in groups)
    # Skills only mentioned in the duties are must-haves when the advert has no
    # explicit requirements list; otherwise they count as nice-to-haves.
    for s, n in context.items():
        target = preferred if has_requirements_section else required
        target[s] = target.get(s, 0) + n
    for s in list(preferred):
        if s in required:
            del preferred[s]

    years = None
    for m in YEARS_RE.finditer(text):
        window = text[max(0, m.start() - 60): m.end() + 60].lower()
        if "experience" in window or "exp" in window:
            years = float(m.group(1))
            break

    level, label = 0, None
    low = text.lower()
    for lvl, lab, pat in sorted(EDU_LEVELS, key=lambda x: x[0]):
        if re.search(pat, low):
            level, label = lvl, lab
            break

    title_m = TITLE_RE.search(text)
    title = title_m.group(0).strip().title() if title_m else None
    seniority = None
    if re.search(r"\b(senior|sr\.|lead|principal|staff)\b", low):
        seniority = "Senior"
    elif re.search(r"\b(junior|jr\.|entry[- ]level|fresher|graduate trainee|intern)\b", low):
        seniority = "Junior"
    elif years is not None:
        seniority = "Senior" if years >= 5 else "Mid-level" if years >= 2 else "Junior"

    order = lambda d: sorted(d, key=lambda s: (-d[s], s))
    req = order(required)
    final = []
    for g in groups:
        for pool in (required, preferred):
            members = [x for x in g if x in pool]
            if len(members) > 1 and members not in final:
                final.append(members)
    groups = final
    return JobSpec(text=text, title=title, seniority=seniority, required=req,
                   preferred=order(preferred), groups=groups, min_years=years, education_level=level,
                   education_label=label)
