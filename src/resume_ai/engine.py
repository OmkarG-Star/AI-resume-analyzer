"""Scoring, decisions and advice.

A resume is reduced to features (skills found, skills shown in real work,
years, education, bullet quality, structure). The score combines seven parts
with fixed weights so every number on screen can be explained:

    must-have skills 38 · nice-to-have 10 · experience 14 · education 5
    text similarity 13 · evidence 12 · resume quality 8

A skill that only sits in a skills list counts for 70% of one that is shown in
an experience or project bullet. Recruiter mode turns the score and knockouts
into a verdict with reasons, risks and interview questions. Candidate mode
turns the gaps into fixes, each with the score gain it is expected to bring,
worked out by re-scoring the resume with that fix applied.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field, replace

from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from . import jd as jdmod
from .parsing import Profile, mask_pii, profile
from .skills import CATEGORY, by_category, find_skills

WEIGHTS = {"must": 38, "nice": 10, "experience": 14, "education": 5,
           "similarity": 13, "evidence": 12, "quality": 8}
PART_LABELS = {"must": "Must-have skills", "nice": "Nice-to-have skills", "experience": "Experience",
               "education": "Education", "similarity": "Overall relevance", "evidence": "Evidence of impact",
               "quality": "Resume quality"}
LISTED_ONLY_CREDIT = 0.7

ACTION_VERBS = {
    "built", "designed", "developed", "created", "led", "launched", "delivered", "automated", "improved",
    "reduced", "increased", "optimised", "optimized", "deployed", "implemented", "analysed", "analyzed",
    "migrated", "managed", "owned", "drove", "streamlined", "engineered", "architected", "trained",
    "established", "spearheaded", "scaled", "cut", "saved", "won", "mentored", "partnered", "modelled",
    "modeled", "forecasted", "standardised", "standardized", "integrated", "shipped", "transformed", "redesigned",
}
WEAK_PHRASES = re.compile(r"\b(responsible for|worked on|helped( to)?|involved in|duties included|"
                          r"tasked with|assisted( in| with)?|participated in|handled)\b", re.I)
QUANT_RE = re.compile(r"(\d+(?:\.\d+)?\s*(?:%|percent|x\b|k\b|m\b|mn\b|cr\b|crore|lakh|hrs?\b|hours|days|weeks|"
                      r"users|employees|records|rows|reports|dashboards|clients|sites|people|members))|[₹$€£]\s*\d|"
                      r"\b\d{2,}(?:,\d{3})*\b", re.I)
GENERIC_WORDS = set(ENGLISH_STOP_WORDS) | {
    "experience", "work", "working", "team", "teams", "ability", "strong", "good", "excellent", "skills",
    "knowledge", "role", "candidate", "years", "year", "using", "use", "including", "etc", "looking",
    "join", "company", "required", "preferred", "plus", "must", "will", "responsibilities", "requirements",
    "understanding", "related", "field", "degree", "bachelor", "master", "new", "help", "make", "based",
    "within", "across", "ensure", "able", "time", "well", "high", "level", "best", "key", "day", "like",
    "nice", "bonus", "minimum", "need", "needs", "you", "your", "our", "we", "who", "what", "also", "data",
    "actually", "scientist", "engineer", "analyst", "managers", "looking", "role", "hands", "fundamentals", "quantitative",
}

VERDICTS = {
    "strong": {"label": "Strong shortlist", "next": "Move to a hiring-manager interview this week."},
    "shortlist": {"label": "Shortlist", "next": "Book a technical screen focused on the risks listed."},
    "verify": {"label": "Interview to verify", "next": "Run a short phone screen to check the gaps before investing more time."},
    "reject": {"label": "Not a fit", "next": "Decline politely, or keep on file for a more junior or different role."},
}


# ------------------------------------------------------------------ features
@dataclass
class Features:
    found: dict[str, int]
    demonstrated: set[str]
    years: float | None
    education_level: int
    education_label: str | None
    n_bullets: int
    n_quant: int
    n_action: int
    weak_bullets: list[str]
    sections: set[str]
    word_count: int
    has_email: bool
    has_phone: bool
    similarity: float
    extra: set[str] = field(default_factory=set)      # what-if: skills the candidate confirms they have


def _first_word(line: str) -> str:
    m = re.match(r"[A-Za-z]+", line)
    return m.group(0).lower() if m else ""


def features_from(p: Profile, similarity: float) -> Features:
    work_text = "\n".join(p.sections.get(k, "") for k in ("experience", "projects", "summary", "achievements"))
    if not work_text.strip():
        work_text = "\n".join(v for k, v in p.sections.items() if k != "skills")
    found = find_skills(p.text)
    demonstrated = set(find_skills(work_text))
    quant = [b for b in p.bullets if QUANT_RE.search(b)]
    action = [b for b in p.bullets if _first_word(b) in ACTION_VERBS]
    weak = [b for b in p.bullets if WEAK_PHRASES.search(b) or (not QUANT_RE.search(b) and _first_word(b) not in ACTION_VERBS)]
    return Features(found=found, demonstrated=demonstrated, years=p.years_experience,
                    education_level=p.education_level, education_label=p.education_label,
                    n_bullets=len(p.bullets), n_quant=len(quant), n_action=len(action),
                    weak_bullets=weak, sections=set(p.sections), word_count=p.word_count,
                    has_email=p.has_email, has_phone=p.has_phone, similarity=similarity)


def similarity(resume: str, jd_text: str, corpus: list[str] | None = None) -> float:
    docs = [jd_text, resume] + [d for d in (corpus or []) if d not in (jd_text, resume)]
    vec = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), sublinear_tf=True, min_df=1)
    m = vec.fit_transform(docs)
    return float(cosine_similarity(m[0:1], m[1:2])[0][0])


# ------------------------------------------------------------------ scoring
def _skill_credit(skill: str, f: Features) -> float:
    if skill in f.demonstrated or skill in f.extra:
        return 1.0
    if skill in f.found:
        return LISTED_ONLY_CREDIT
    return 0.0


def units(spec: jdmod.JobSpec) -> list[tuple[str, list[str]]]:
    """Requirement units: each either-or group counts once, other skills alone.
    Returns [(importance, [skills...]), ...] in the job's order."""
    out, seen = [], set()
    must = spec.required or spec.preferred
    nice = spec.preferred if spec.required else []
    for importance, pool in (("must", must), ("nice", nice)):
        for s in pool:
            if s in seen:
                continue
            group = next((g for g in spec.groups if s in g and all(x in pool for x in g)), [s])
            seen.update(group)
            out.append((importance, group))
    return out


def _unit_credit(group: list[str], f: Features) -> float:
    return max(_skill_credit(s, f) for s in group)


def score_parts(f: Features, spec: jdmod.JobSpec) -> dict[str, float]:
    us = units(spec)
    req = [g for imp, g in us if imp == "must"]
    nice = [g for imp, g in us if imp == "nice"]
    parts: dict[str, float] = {}
    parts["must"] = (sum(_unit_credit(g, f) for g in req) / len(req)) if req else min(1.0, f.similarity / 0.35)
    parts["nice"] = (sum(_unit_credit(g, f) for g in nice) / len(nice)) if nice else None

    if spec.min_years:
        if f.years is None:
            parts["experience"] = 0.35
        else:
            ratio = f.years / spec.min_years
            parts["experience"] = 1.0 if ratio >= 1 else max(0.0, ratio) ** 0.8
    else:
        parts["experience"] = 1.0 if (f.years or f.n_bullets >= 3) else 0.6

    if spec.education_level:
        gap = spec.education_level - f.education_level
        parts["education"] = 0.6 if f.education_level == 0 else 1.0 if gap <= 0 else 0.5 if gap == 1 else 0.2
    else:
        parts["education"] = None

    parts["similarity"] = max(0.0, min(1.0, (f.similarity - 0.03) / 0.27))

    jd_skills = set(spec.required) | set(spec.preferred)
    relevant = [s for s in jd_skills if s in f.found or s in f.extra]
    demo_ratio = (sum(1 for s in relevant if s in f.demonstrated or s in f.extra) / len(relevant)) if relevant else 0.5
    n = max(f.n_bullets, 1)
    quant_ratio = min(1.0, (f.n_quant / n) / 0.5) if f.n_bullets else 0.0
    action_ratio = min(1.0, (f.n_action / n) / 0.6) if f.n_bullets else 0.0
    parts["evidence"] = 0.45 * quant_ratio + 0.25 * action_ratio + 0.30 * demo_ratio

    checks = quality_checks(f)
    parts["quality"] = sum(c["ok"] for c in checks) / len(checks)
    return parts


def overall(parts: dict[str, float]) -> float:
    active = {k: w for k, w in WEIGHTS.items() if parts.get(k) is not None}
    total_w = sum(active.values())
    return round(sum(parts[k] * w for k, w in active.items()) / total_w * 100, 1)


def quality_checks(f: Features) -> list[dict]:
    return [
        {"check": "Email address present", "ok": f.has_email},
        {"check": "Phone number present", "ok": f.has_phone},
        {"check": "Experience or Projects section", "ok": bool({"experience", "projects"} & f.sections)},
        {"check": "Skills section", "ok": "skills" in f.sections},
        {"check": "Education section", "ok": "education" in f.sections},
        {"check": "Length between 150 and 1,100 words", "ok": 150 <= f.word_count <= 1100},
        {"check": "At least 3 bullets with measurable results", "ok": f.n_quant >= 3},
        {"check": "Most bullets start with an action verb", "ok": f.n_bullets > 0 and f.n_action / max(f.n_bullets, 1) >= 0.5},
    ]


# ------------------------------------------------------------------ analysis
def _status(s: str, f: Features) -> str:
    return "shown" if s in f.demonstrated or s in f.extra else "listed" if s in f.found else "missing"


def _skill_table(spec: jdmod.JobSpec, f: Features) -> list[dict]:
    rank = {"shown": 0, "listed": 1, "missing": 2}
    rows = []
    for importance, group in units(spec):
        statuses = {s: _status(s, f) for s in group}
        best = min(group, key=lambda s: rank[statuses[s]])
        label = " or ".join(group) if len(group) > 1 else group[0]
        rows.append({"skill": label, "members": group, "matched": best if statuses[best] != "missing" else None,
                     "category": CATEGORY.get(group[0], "Other"), "importance": importance,
                     "status": statuses[best]})
    return rows


def _verdict(score: float, parts: dict, table: list[dict]) -> tuple[str, list[str]]:
    must = [r for r in table if r["importance"] == "must"]
    missing = [r["skill"] for r in must if r["status"] == "missing"]
    miss_ratio = len(missing) / len(must) if must else 0.0
    knockouts = []
    if must and miss_ratio > 0.5:
        knockouts.append(f"Missing {len(missing)} of {len(must)} must-have skills")
    if parts["experience"] < 0.45:
        knockouts.append("Well short of the required experience")
    if knockouts and (miss_ratio > 0.5 or score < 55):
        return "reject", knockouts
    if score >= 74 and miss_ratio <= 0.3 and parts["experience"] >= 0.8:
        return "strong", knockouts
    if score >= 62 and miss_ratio <= 0.34:
        return "shortlist", knockouts
    if score >= 48:
        return "verify", knockouts
    return "reject", knockouts


def _confidence(p: Profile) -> tuple[str, str]:
    work = {"experience", "projects"} & set(p.sections)
    if p.word_count >= 150 and work:
        return "High", "Full resume with clear sections."
    if p.word_count >= 80:
        return "Medium", "Some sections are missing or short, so a few signals are estimated."
    return "Low", "Very little text to analyse. Read the resume yourself before deciding."


def _strengths_risks(spec, f, parts, table, p) -> tuple[list[str], list[str]]:
    strengths, risks = [], []
    shown_must = [r["skill"] for r in table if r["importance"] == "must" and r["status"] == "shown"]
    listed_must = [r["skill"] for r in table if r["importance"] == "must" and r["status"] == "listed"]
    missing_must = [r["skill"] for r in table if r["importance"] == "must" and r["status"] == "missing"]
    shown_nice = [r["skill"] for r in table if r["importance"] == "nice" and r["status"] != "missing"]
    if shown_must:
        strengths.append(f"Shows {len(shown_must)} must-have skill{'s' if len(shown_must) != 1 else ''} in real work: "
                         + ", ".join(shown_must[:5]) + ("…" if len(shown_must) > 5 else ""))
    if f.years is not None and spec.min_years and f.years >= spec.min_years:
        strengths.append(f"{f.years:g} years of experience against {spec.min_years:g}+ required")
    elif f.years is not None and not spec.min_years and f.years >= 2:
        strengths.append(f"{f.years:g} years of experience")
    if f.n_quant >= 3:
        strengths.append(f"{f.n_quant} bullets with measurable results")
    if shown_nice:
        strengths.append("Also brings nice-to-haves: " + ", ".join(shown_nice[:4]))
    if spec.education_level and f.education_level >= spec.education_level:
        strengths.append(f"Meets the education requirement ({f.education_label})")

    if missing_must:
        risks.append("Missing must-haves: " + ", ".join(missing_must[:6]))
    if listed_must:
        risks.append("Listed but not shown in any project or job: " + ", ".join(listed_must[:5]))
    if spec.min_years:
        if f.years is None:
            risks.append("Could not find dated roles, so experience is unverified")
        elif f.years < spec.min_years:
            risks.append(f"{f.years:g} years of experience against {spec.min_years:g}+ required")
    if f.n_bullets and f.n_quant == 0:
        risks.append("No measurable results in any bullet")
    if spec.education_level and 0 < f.education_level < spec.education_level:
        risks.append(f"Education below the stated requirement ({spec.education_label})")
    risks.extend(p.warnings)
    return strengths, risks


def _questions(spec, f, table) -> list[dict]:
    qs = []
    for r in table:
        if r["importance"] == "must" and r["status"] == "missing" and len(qs) < 2:
            qs.append({"topic": r["skill"], "why": "Must-have skill not found",
                       "question": f"This role uses {r['skill']} daily. What have you used that is closest to it, "
                                   f"and how quickly could you get productive with {r['skill']}?"})
    for r in table:
        if r["status"] == "listed" and len(qs) < 4:
            qs.append({"topic": r["skill"], "why": "Listed without evidence",
                       "question": f"Your resume lists {r['skill']}. Walk me through one piece of work where you "
                                   f"used it from start to finish. What was the result?"})
    if spec.min_years and (f.years or 0) < spec.min_years and len(qs) < 5:
        qs.append({"topic": "Experience", "why": "Below required years",
                   "question": "Which project best shows you can work at the level this role needs without close supervision?"})
    shown = [r["skill"] for r in table if r["importance"] == "must" and r["status"] == "shown"]
    if shown and len(qs) < 5:
        qs.append({"topic": shown[0], "why": "Deep-dive on a core strength",
                   "question": f"Tell me about the hardest problem you solved with {shown[0]}. What would you do differently now?"})
    if f.n_quant == 0 and len(qs) < 5:
        qs.append({"topic": "Impact", "why": "No measurable results on the resume",
                   "question": "Pick one project. How did you know it worked? What changed for the business or the users?"})
    return qs[:5]


def _keyword_gaps(spec_text: str, resume_text: str, limit: int = 8) -> list[str]:
    low_r = resume_text.lower()
    tokens = re.findall(r"[a-z][a-z+#.-]{3,}", spec_text.lower())
    counts: dict[str, int] = {}
    skill_words = {w for s in find_skills(spec_text) for w in s.lower().split()}
    for t in tokens:
        t = t.strip(".-")
        if t in GENERIC_WORDS or t in skill_words or len(t) < 4:
            continue
        counts[t] = counts.get(t, 0) + 1
    ranked = sorted(counts, key=lambda w: (-counts[w], w))
    return [w for w in ranked if w not in low_r][:limit]


VERB_HINTS = [
    (r"dashboard|report|visuali", "Built"), (r"model|predict|classif|forecast", "Developed"),
    (r"pipeline|etl|automat|script", "Automated"), (r"analys|analyz|insight", "Analysed"),
    (r"team|lead|mentor", "Led"), (r"process|workflow", "Streamlined"),
]
IRREGULAR = {"building": "Built", "making": "Made", "leading": "Led", "running": "Ran", "writing": "Wrote",
             "setting": "Set", "getting": "Got", "bringing": "Brought", "teaching": "Taught", "driving": "Drove"}
SUPPORT_RE = re.compile(r"^(helped|assisted|supported)( to)?\s+(in |with )?", re.I)
CONTRIB_RE = re.compile(r"^(involved in|participated in)\s+", re.I)
OWN_RE = re.compile(r"^(responsible for|tasked with|duties included|in charge of)\s+", re.I)
WORKED_RE = re.compile(r"^(worked on|handled)\s+", re.I)


def _past(gerund: str) -> str:
    """preparing -> Prepared, planning -> Planned, creating -> Created."""
    g = gerund.lower()
    if g in IRREGULAR:
        return IRREGULAR[g]
    past = g[:-3] + "ed"
    return past[0].upper() + past[1:]


def _keep_case(word: str) -> str:
    """Lower-case a leading word unless it is an acronym such as HR or MIS."""
    return word if len(word) > 1 and word[1].isupper() else word[:1].lower() + word[1:]


def rewrite(bullet: str) -> str:
    text = bullet.strip(" ,.;:-")
    if SUPPORT_RE.match(text):
        rest = SUPPORT_RE.sub("", text)
        sentence = f"Supported {_keep_case(rest)} by [what you did, e.g. building a tracker in Excel]"
    elif CONTRIB_RE.match(text):
        sentence = f"Contributed to {_keep_case(CONTRIB_RE.sub('', text))} by [your specific part]"
    else:
        core = OWN_RE.sub("", text)
        owned = core != text
        core = WORKED_RE.sub("", core)
        first = core.split(" ", 1)[0] if core else ""
        if first.lower().endswith("ing") and len(first) > 5:
            rest = core.split(" ", 1)[1] if " " in core else ""
            sentence = f"{_past(first)} {rest}".strip()
        elif _first_word(core) in ACTION_VERBS:
            sentence = core[0].upper() + core[1:]
        else:
            core = re.sub(r"^(the|a|an)\s+", "", core, flags=re.I)
            verb = "Owned" if owned else "Delivered"
            for pat, v in VERB_HINTS:
                if re.search(pat, core, re.I):
                    verb = v
                    break
            sentence = f"{verb} {_keep_case(core)}"
    if not QUANT_RE.search(sentence):
        sentence += " — [add the result: e.g. cut time by X%, used by N people, saved ₹X]"
    return sentence


def _suggestions(spec, f, parts, table, p, base_score) -> list[dict]:
    out = []

    def gain_with(**changes) -> float:
        g = replace(f, **changes)
        return round(overall(score_parts(g, spec)) - base_score, 1)

    missing = [r for r in table if r["status"] == "missing"]
    if missing:
        must_missing = [r for r in missing if r["importance"] == "must"] or missing
        gains = {r["skill"]: gain_with(extra=f.extra | {r["members"][0]}) for r in must_missing}
        names = [r["skill"] for r in sorted(must_missing, key=lambda r: -gains[r["skill"]])]
        shown = ", ".join(names[:4]) + (f" and {len(names) - 4} more" if len(names) > 4 else "")
        out.append({
            "kind": "skills", "skills": names, "gain": max(gains.values()),
            "title": f"Check the must-haves you have not shown: {shown}",
            "detail": ("If you have real experience with any of these, add it to a job or project bullet that says what "
                       "you did with it. Each one adds about +" + f"{max(gains.values()):g}" + " points. Use the what-if "
                       "simulator to see the effect. Only add skills you can talk about in an interview."),
        })
    listed = [r for r in table if r["status"] == "listed"]
    if listed:
        names = [r["matched"] for r in listed]
        gain = gain_with(demonstrated=f.demonstrated | set(names))
        out.append({"kind": "evidence", "gain": gain, "skills": names,
                    "title": f"Prove {', '.join(names[:3])}{'…' if len(names) > 3 else ''} in your bullets",
                    "detail": "These skills only appear in your skills list. Recruiters and screening software trust a skill "
                              "far more when a bullet shows it in use, for example \"Automated weekly MIS in Python, "
                              "cutting prep time from 6 hours to 40 minutes\"."})
    if f.n_quant < 3 and f.n_bullets:
        target = min(f.n_bullets, max(3, f.n_quant + 3))
        gain = gain_with(n_quant=target)
        out.append({"kind": "impact", "gain": gain,
                    "title": "Add numbers to your strongest bullets",
                    "detail": f"Only {f.n_quant} of {f.n_bullets} bullets show a measurable result. Add time saved, "
                              "accuracy, volume, money or people reached to at least three of them."})
    if f.n_bullets and f.n_action / f.n_bullets < 0.5:
        gain = gain_with(n_action=f.n_bullets)
        out.append({"kind": "verbs", "gain": gain, "title": "Start bullets with strong action verbs",
                    "detail": "Replace openings like \"Responsible for\" or \"Worked on\" with what you did: Built, "
                              "Automated, Reduced, Led, Delivered."})
    missing_sections = [c["check"] for c in quality_checks(f) if not c["ok"] and "section" in c["check"].lower()]
    for c in missing_sections:
        key = "experience" if "Experience" in c else "skills" if "Skills" in c else "education"
        gain = gain_with(sections=f.sections | {key})
        out.append({"kind": "structure", "gain": gain, "title": f"Add a clear {c.replace(' section', '')} heading",
                    "detail": "Use a standard heading so both people and screening software find this part straight away."})
    if not f.has_email or not f.has_phone:
        gain = gain_with(has_email=True, has_phone=True)
        out.append({"kind": "contact", "gain": gain, "title": "Add your email and phone at the top",
                    "detail": "Recruiters cannot shortlist someone they cannot contact."})
    if spec.min_years and (f.years or 0) < spec.min_years:
        out.append({"kind": "experience", "gain": 0.0, "title": "Make your experience dates easy to read",
                    "detail": f"The job asks for {spec.min_years:g}+ years. Put month and year on every role "
                              "(e.g. Jun 2022 – Present) and include internships and freelance work that used the same skills."})
    out.sort(key=lambda s: -s["gain"])
    for i, s in enumerate(out):
        s["priority"] = "High" if s["gain"] >= 4 or i == 0 else "Medium" if s["gain"] >= 1.5 else "Low"
    return out


def analyze(resume_text: str, jd_text: str, *, corpus: list[str] | None = None,
            assume_skills: list[str] | None = None, spec: jdmod.JobSpec | None = None) -> dict:
    spec = spec or jdmod.parse(jd_text)
    p = profile(resume_text)
    f = features_from(p, similarity(p.text, spec.text, corpus))
    if assume_skills:
        f.extra = set(assume_skills)
    parts = score_parts(f, spec)
    score = overall(parts)
    table = _skill_table(spec, f)
    verdict_key, knockouts = _verdict(score, parts, table)
    strengths, risks = _strengths_risks(spec, f, parts, table, p)
    conf, conf_note = _confidence(p)
    resume_skills = sorted(set(f.found) | f.extra)
    jd_skills = set(spec.required) | set(spec.preferred)

    return {
        "score": score,
        "verdict": {"key": verdict_key, **VERDICTS[verdict_key], "knockouts": knockouts},
        "confidence": {"level": conf, "note": conf_note},
        "parts": [{"key": k, "label": PART_LABELS[k], "weight": WEIGHTS[k],
                   "value": None if v is None else round(v * 100, 1)} for k, v in parts.items()],
        "skills": table,
        "summary": {
            "must_total": len(spec.required), "nice_total": len(spec.preferred),
            "must_matched": sum(1 for r in table if r["importance"] == "must" and r["status"] != "missing"),
            "nice_matched": sum(1 for r in table if r["importance"] == "nice" and r["status"] != "missing"),
            "years": f.years, "education": f.education_label, "word_count": f.word_count,
            "bullets": f.n_bullets, "quantified": f.n_quant, "similarity": round(f.similarity, 3),
        },
        "extra_skills": by_category([s for s in resume_skills if s not in jd_skills]),
        "strengths": strengths,
        "risks": risks,
        "questions": _questions(spec, f, table),
        "suggestions": _suggestions(spec, f, parts, table, p, score),
        "rewrites": [{"before": mask_pii(b), "after": rewrite(b)} for b in f.weak_bullets[:4]],
        "keywords": _keyword_gaps(spec.text, p.text),
        "ats": quality_checks(f),
        "name_guess": p.name_guess,
    }


def job_summary(spec: jdmod.JobSpec) -> dict:
    return {"title": spec.title, "seniority": spec.seniority, "min_years": spec.min_years,
            "must_units": [" or ".join(g) for imp, g in units(spec) if imp == "must"],
            "nice_units": [" or ".join(g) for imp, g in units(spec) if imp == "nice"],
            "education": spec.education_label, "required": spec.required, "preferred": spec.preferred,
            "required_by_category": by_category(spec.required), "preferred_by_category": by_category(spec.preferred)}


def screen(jd_text: str, resumes: list[tuple[str, str]]) -> dict:
    """Rank many resumes against one job. resumes = [(file name, text), ...]"""
    spec = jdmod.parse(jd_text)
    texts = [t for _, t in resumes]
    results = []
    for i, (fname, text) in enumerate(resumes, start=1):
        r = analyze(text, jd_text, corpus=texts, spec=spec)
        r["id"] = f"C{i:02d}"
        r["label"] = f"Candidate {i:02d}"
        r["file"] = fname
        results.append(r)
    order = {"strong": 0, "shortlist": 1, "verify": 2, "reject": 3}
    results.sort(key=lambda r: (order[r["verdict"]["key"]], -r["score"]))
    for rank, r in enumerate(results, start=1):
        r["rank"] = rank
    counts = {k: sum(1 for r in results if r["verdict"]["key"] == k) for k in order}
    must_units = [" or ".join(g) for imp, g in units(spec) if imp == "must"]
    must_cov = {s: sum(1 for r in results for row in r["skills"]
                       if row["skill"] == s and row["status"] != "missing") for s in must_units}
    return {"job": job_summary(spec), "candidates": results, "counts": counts,
            "skill_coverage": [{"skill": s, "have": n, "of": len(results)} for s, n in must_cov.items()]}
