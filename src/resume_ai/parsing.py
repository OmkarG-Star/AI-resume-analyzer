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
# One date in a role header. Covers the styles seen on real resumes:
#   Jan 2020 · January 2020 · Jan-2020 · Jan, 2020 · Jun'21 · Jun ’21
#   06/2021 · 6/2021 · 01.2020 · 06-2021 · 2021-06 · 2021/06 · 2020
_MON = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
_Y4 = r"(?:19|20)\d{2}"
_DATE = (rf"(?:{_MON}[\s,\-/]*(?:{_Y4}|[’'`]\s?\d{{2}}\b)"      # month name + year or 'YY
         rf"|(?<![\d/.\-])(?:0?[1-9]|1[0-2])[/.\-]{_Y4}"          # 06/2021, 01.2020
         rf"|{_Y4}[/.\-](?:0[1-9]|1[0-2])(?![\d])"                  # 2021-06
         rf"|{_Y4})")                                                # 2020
_END = r"(?:present|current(?:ly)?|now|till\s+(?:date|now)|to\s+date|today|ongoing|date)\b"
_TO = r"\s*(?:-|–|—|to|till|until|through)\s*"
RANGE_RE = re.compile(rf"(?P<a>{_DATE}){_TO}(?:(?P<b>{_DATE})|(?P<end>{_END}))", re.I)
SINCE_RE = re.compile(rf"\b(?:since|from)\s+(?P<a>{_DATE})(?!{_TO})", re.I)

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

BULLET_RE = re.compile(r"^\s*(?:[-–—•*▪●◦‣·➢➤►▶▸■□◆◇❖✓✔✦★→»⁃∙○]|o(?=\s)|\d+[.)])\s+")


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
    dated_years: float | None = None      # from the date ranges on each role
    stated_years: float | None = None     # from a claim such as "8 years of experience"


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
        from docx.table import Table
        from docx.text.paragraph import Paragraph
        doc = docx.Document(io.BytesIO(data))
        parts = []
        # Walk paragraphs and tables in document order, so a skills table
        # stays under its Skills heading instead of moving to the end.
        for child in doc.element.body.iterchildren():
            tag = child.tag.rsplit("}", 1)[-1]
            if tag == "p":
                parts.append(Paragraph(child, doc).text)
            elif tag == "tbl":
                for row in Table(child, doc).rows:
                    cells = []
                    for c in row.cells:                      # merged cells repeat; keep each once
                        if c.text.strip() and (not cells or cells[-1] != c.text.strip()):
                            cells.append(c.text.strip())
                    if cells:
                        parts.append(" | ".join(cells))
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
# Words that mark a heading's section when the exact wording is unusual
# ("Professional Experience & Projects", "Skill Set", "Areas of Expertise").
# Checked in this order, so "Work Experience & Projects" is Experience.
_HEADING_WORDS = [
    ("experience", r"experience|employment|work history|career history|internship"),
    ("skills", r"skill|expertise|competenc|tech(?:nical)? stack|toolkit|technologies|proficienc"),
    ("projects", r"project|portfolio"),
    ("education", r"education|academic|qualification"),
    ("certifications", r"certif|courses?\b|training"),
    ("achievements", r"achievement|award|honou?rs|accomplishment"),
    ("summary", r"summary|profile|objective|about me|overview"),
]


def _heading_key(line: str) -> str | None:
    clean = re.sub(r"[^a-z& ]", "", line.lower()).strip()
    clean = re.sub(r"\s+", " ", clean)
    if not clean or len(clean) > 40:
        return None
    if clean in _HEADING_LOOKUP:
        return _HEADING_LOOKUP[clean]
    # A short line that looks like a heading (Title Case, CAPITALS or ending
    # in a colon; not a bullet; no digits or sentence punctuation) and names a section.
    raw = line.strip()
    body = raw.rstrip(":").strip()
    words = [w for w in re.findall(r"[A-Za-z]+", body) if w.lower() not in ("and", "of", "the", "for", "in", "my")]
    looks_like_heading = raw.endswith(":") or body.isupper() or (words and all(w[0].isupper() for w in words))
    if (looks_like_heading and len(clean.split()) <= 5 and not BULLET_RE.match(raw)
            and not re.search(r"[\d.,;|@]", body)):
        for key, pat in _HEADING_WORDS:
            if re.search(pat, clean):
                return key
    return None


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


def _when(text: str, end: bool, today: date) -> int | None:
    """One date as a month count (year * 12 + month - 1). A bare year means
    January when it starts a range and December when it ends one."""
    t = text.strip().lower()
    name = re.match(r"([a-z]+)", t)
    if name and name.group(1)[:3] in MONTHS:
        month = MONTHS[name.group(1)[:3]]
        y4 = re.search(_Y4, t)
        if y4:
            year = int(y4.group(0))
        else:
            yy = int(re.search(r"(\d{2})\s*$", t).group(1))
            year = 2000 + yy if 2000 + yy <= today.year + 1 else 1900 + yy
        return year * 12 + month - 1
    nums = re.findall(r"\d+", t)
    if len(nums) == 2:
        a, b = nums
        year, month = (int(a), int(b)) if len(a) == 4 else (int(b), int(a))
        return year * 12 + month - 1
    if len(nums) == 1 and len(nums[0]) == 4:
        return int(nums[0]) * 12 + (11 if end else 0)
    return None


def _span(m: re.Match, today: date) -> tuple[int, int] | None:
    """(start, stop) in months for one date-range or "since" match, or None if implausible."""
    now = today.year * 12 + today.month - 1
    start = _when(m.group("a"), False, today)
    if "b" in m.re.groupindex and m.group("b"):
        stop = _when(m.group("b"), True, today)
    else:
        stop = now                                   # Present / till date / since 2020
    if start is None or stop is None:
        return None
    stop = min(stop, now)
    if stop < start or stop - start > 45 * 12:
        return None
    return start, stop


def date_spans(text: str, today: date | None = None) -> list[tuple[int, int]]:
    """Every plausible date range in the text, including "Since 2020"."""
    today = today or date.today()
    out = [sp for m in RANGE_RE.finditer(text) if (sp := _span(m, today))]
    out += [sp for m in SINCE_RE.finditer(text) if (sp := _span(m, today))]
    return out


def merged_years(spans: list[tuple[int, int]]) -> float | None:
    """Years covered by month spans, overlaps merged."""
    if not spans:
        return None
    spans = sorted(spans)
    merged = [list(spans[0])]
    for s, e in spans[1:]:
        if s <= merged[-1][1] + 1:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    return round(sum(e - s + 1 for s, e in merged) / 12, 1)


def years_from_ranges(text: str, today: date | None = None) -> float | None:
    """Total years covered by date ranges, with overlaps merged."""
    return merged_years(date_spans(text, today))


def roles(text: str, today: date | None = None) -> list[dict]:
    """Dated roles in an Experience section: the header line with the dates,
    the lines under it, and the months it covers."""
    today = today or date.today()
    out: list[dict] = []
    for line in text.split("\n"):
        found = date_spans(line, today)
        sp = found[0] if found else None
        if sp:
            out.append({"header": line.strip(), "body": "", "span": sp})
        elif out and line.strip():
            out[-1]["body"] += line.strip() + "\n"
    return out


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
    dated = years_from_ranges(exp_text, today)
    stated = stated_years(sections.get("summary", "") + "\n" + sections.get("header", ""))
    # Dated roles are evidence; a stated total is a claim. Use the claim only when
    # there are no dates at all, and let integrity.py flag a large gap between them.
    years = dated if dated is not None else stated
    level, label = education(sections.get("education", text))
    warnings = []
    words = len(text.split())
    letters = [ch for ch in text if ch.isalpha()]
    if letters and sum(ch.isascii() for ch in letters) / len(letters) < 0.6:
        warnings.append("Most of this resume is not in English. The screener reads English resumes only, "
                        "so this score is not meaningful: read it yourself.")
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
        name_guess=guess_name(text), warnings=warnings,
        dated_years=dated, stated_years=stated)


def mask_pii(text: str) -> str:
    text = EMAIL_RE.sub("[email]", text)
    text = PHONE_RE.sub(lambda m: "[phone]" if _is_phone(m) else m.group(), text)
    return text
