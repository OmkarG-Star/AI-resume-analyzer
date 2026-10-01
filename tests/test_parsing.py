from datetime import date

from resume_ai.parsing import mask_pii, profile, split_sections, years_from_ranges


def test_sections_are_detected_from_headings():
    s = split_sections("Jane\nSUMMARY\nAnalyst\nWork Experience\n- Built X\nSkills:\nPython\nEducation\nB.Tech")
    assert {"summary", "experience", "skills", "education"} <= set(s)


def test_overlapping_ranges_are_merged():
    text = "Analyst Jan 2020 - Dec 2021\nFreelance Jun 2021 - Mar 2022"
    assert years_from_ranges(text, today=date(2026, 1, 1)) == 2.2


def test_present_ranges_run_to_today():
    assert years_from_ranges("Engineer | Jun 2024 – Present", today=date(2026, 6, 1)) == 2.1


def test_stated_years_used_when_no_dates():
    p = profile("Summary\nData analyst with 4+ years of experience in reporting.\nSkills\nSQL")
    assert p.years_experience == 4.0


def test_education_level_and_contact():
    p = profile("Asha Rao\nasha@example.com | +91 98200 11223\nEducation\nM.Sc. Statistics")
    assert p.education_label == "Master's" and p.has_email and p.has_phone
    assert p.name_guess == "Asha Rao"


def test_pii_is_masked():
    out = mask_pii("Call +91 98200 11223 or mail asha@example.com")
    assert "[phone]" in out and "[email]" in out and "98200" not in out


def test_year_ranges_are_not_phone_numbers():
    assert mask_pii("Analyst 2020-2022") == "Analyst 2020-2022"
    assert not profile("Jane Doe\nExperience\nAnalyst 2019-2023").has_phone
