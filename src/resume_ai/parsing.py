"""Turn an uploaded resume or job description into structured text.

Supports PDF, DOCX and plain text. Resumes are split into sections by their
headings, and the profile pulls out what screening needs: years of experience
from date ranges, education level, contact presence and the bullet lines that
describe work. Personal details are detected only so they can be masked.
"""
from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from datetime import date

SECTION_ALIASES = {
    "summary": ["summary", "profile", "professional summary", "about me", "objective", "career objective", "about"],
    "experience": ["experience", "work experience", "professional experience", "employment history",
                   "employment", "work history", "internships", "internship", "career history"],
    "projects": ["projects", "personal projects", "academic projects", "key projects", "portfolio"],
    "skills": ["skills", "technical skills", "core skills", "key skills", "tech stack", "technologies",
               "tools", "competencies", "core competencies", "skills & tools", "skills and tools"],
    "education": ["education", "academic background", "qualifications", "academics", "educational qualifications"],
    "certifications": ["certifications", "certificates", "licenses", "courses", "training"],
    "achievements": ["achievements", "awards", "honors", "honours", "accomplishments"],
}
_HEADING_LOOKUP = {alias: key for key, aliases in SECTION_ALIASES.items() for alias in aliases}

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}
_MONTH = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
_END = r"(present|current|now|till date|today|ongoing)"
RANGE_RE = re.compile(
    rf"(?:{_MONTH}\s*[’']?\s*)?((?:19|20)\d{{2}})\s*(?:-|–|—|to|till|until)\s*"
    rf"(?:(?:{_MONTH}\s*[’']?\s*)?((?:19|20)\d{{2}})|{_END})", re.I)

EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE_RE = re.compile(r"(?<![\w])(?:\+?\d{1,3}[\s.-]?)?\(?\d{3,5}\)?[\s.-]?\d{3,5}(?:[\s.-]?\d{2,5})?(?![\w])")
YEAR_RANGE_RE = re.compile(r"^\(?(19|20)\d{2}\s*[-.]\s*(19|20)\d{2}\)?$")


def _is_phone(m: re.Match) -> bool:
    raw = m.group().strip()
    return sum(c.isdigit() for c in raw) >= 8 and not YEAR_RANGE_RE.match(raw)


LINK_RE = re.compile(r"(?:https?://)?(?:www\.)?(linkedin\.com/[\w/-]+|github\.com/[\w-]+)", re.I)

EDU_LEVELS = [
    (4, "PhD", r"\b(ph\.?d|doctorate)\b"),
    (3, "Master's", r"\b(master'?s?|m\.?tech|m\.?sc|mba|m\.?s\.?|mca|m\.?e\.?|pgdm|post ?graduate)\b"),
    (2, "Bachelor's", r"\b(bachelor'?s?|b\.?tech|b\.?e\.?|b\.?sc|bca|b\.?com|bba|b\.?s\.?|undergraduate|graduate)\b"),
    (1, "Diploma", r"\b(diploma|polytechnic)\b"),
]

BULLET_RE = re.compile(r"^\s*(?:[-•*▪●◦‣·]|\d+[.)])\s+")


@dataclass
class Profile:
    text: str
    sections: dict[str, str]
    lines: list[str]
    bullets: list[str]
    years_experience: float | None
    education_level: int
    education_label: str | None
    has_email: bool
    has_phone: bool
    has_links: bool
    word_count: int
    name_guess: str | None = None
    warnings: list[str] = field(default_factory=list)


# ------------------------------------------------------------------ extraction
def extract_text(filename: str, data: bytes) -> str:
    """Read text out of a PDF, DOCX or text upload."""
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    if name.endswith(".docx"):
        import docx
        doc = docx.Document(io.BytesIO(data))
        parts = [p.text for p in doc.paragraphs]
        for table in doc.tables:
            for row in table.rows:
                parts.append(" | ".join(c.text for c in row.cells))
        return "\n".join(parts)
    for enc in ("utf-8", "utf-16", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="ignore")


def normalise(text: str) -> str:
    text = text.replace("\r", "\n").replace("\t", " ")
    text = re.sub(r"[  ]{2,}", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


# ------------------------------------------------------------------ sections
def _heading_key(line: str) -> str | None:
    clean = re.sub(r"[^a-z& ]", "", line.lower()).strip()
    if not clean or len(clean) > 40:
        return None
    return _HEADING_LOOKUP.get(clean)


def split_sections(text: str) -> dict[str, str]:
    sections: dict[str, list[str]] = {"header": []}
    current = "header"
    for line in text.split("\n"):
        key = _heading_key(line.strip().rstrip(":"))
        if key:
            current = key
            sections.setdefault(current, [])
            continue
        sections.setdefault(current, []).append(line)
    return {k: "\n".join(v).strip() for k, v in sections.items() if "\n".join(v).strip()}


# ------------------------------------------------------------------ experience
def _month_index(token: str | None, default: int) -> int:
    if not token:
        return default
    return MONTHS.get(token[:3].lower(), default)


def years_from_ranges(text: str, today: date | None = None) -> float | None:
    """Total years covered by date ranges, with overlaps merged."""
    today = today or date.today()
    spans = []
    for m in RANGE_RE.finditer(text):
        m1, y1, m2, y2, end = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
        start = int(y1) * 12 + _month_index(m1, 1) - 1
        if end:
            stop = today.year * 12 + today.month - 1
        elif y2:
            stop = int(y2) * 12 + _month_index(m2, 12) - 1
        else:
            continue
        if stop < start or stop - start > 45 * 12:
            continue
        spans.append((start, stop))
    if not spans:
        return None
    spans.sort()
    merged = [list(spans[0])]
    for s, e in spans[1:]:
        if s <= merged[-1][1] + 1:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    months = sum(e - s + 1 for s, e in merged)
    return round(months / 12, 1)


STATED_YEARS_RE = re.compile(r"(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years|yrs)\b(?:\s+of)?(?:\s+\w+){0,3}\s+experience", re.I)


def stated_years(text: str) -> float | None:
    vals = [float(m.group(1)) for m in STATED_YEARS_RE.finditer(text)]
    return max(vals) if vals else None


# ------------------------------------------------------------------ education
def education(text: str) -> tuple[int, str | None]:
    low = text.lower()
    for level, label, pat in EDU_LEVELS:
        if re.search(pat, low):
            return level, label
    return 0, None


# ------------------------------------------------------------------ profile
def guess_name(text: str) -> str | None:
    for line in text.split("\n")[:4]:
        line = line.strip()
        if not line or EMAIL_RE.search(line) or any(ch.isdigit() for ch in line):
            continue
        words = line.split()
        if 1 < len(words) <= 4 and all(w[:1].isupper() for w in words) and _heading_key(line) is None:
            return line
    return None


def profile(text: str, today: date | None = None) -> Profile:
    text = normalise(text)
    sections = split_sections(text)
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    work = "\n".join(sections.get(k, "") for k in ("experience", "projects"))
    bullets = [BULLET_RE.sub("", l).strip() for l in work.split("\n")
               if l.strip() and (BULLET_RE.match(l) or len(l.split()) >= 7)]
    exp_text = sections.get("experience") or text
    years = years_from_ranges(exp_text, today)
    stated = stated_years(sections.get("summary", "") + "\n" + sections.get("header", ""))
    if stated is not None and (years is None or stated > years):
        years = stated
    level, label = education(sections.get("education", text))
    warnings = []
    words = len(text.split())
    if words < 80:
        warnings.append("Very short text: the analysis has less to work with, so treat the result with care.")
    if "experience" not in sections and "projects" not in sections:
        warnings.append("No Experience or Projects heading was found, so work evidence was read from the whole text.")
    return Profile(
        text=text, sections=sections, lines=lines, bullets=bullets,
        years_experience=years, education_level=level, education_label=label,
        has_email=bool(EMAIL_RE.search(text)),
        has_phone=any(_is_phone(m) for m in PHONE_RE.finditer(text)),
        has_links=bool(LINK_RE.search(text)), word_count=words,
        name_guess=guess_name(text), warnings=warnings)


def mask_pii(text: str) -> str:
    text = EMAIL_RE.sub("[email]", text)
    text = PHONE_RE.sub(lambda m: "[phone]" if _is_phone(m) else m.group(), text)
    return text
