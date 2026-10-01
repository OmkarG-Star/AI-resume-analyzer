from resume_ai.skills import find_skills, skill_spans


def test_aliases_map_to_canonical_names():
    found = find_skills("Built models with sklearn and Postgres, deployed with k8s")
    assert {"Scikit-learn", "PostgreSQL", "Kubernetes"} <= set(found)


def test_specific_tools_imply_broader_skills():
    found = find_skills("Queried PostgreSQL and trained PyTorch models")
    assert "SQL" in found and "Deep Learning" in found


def test_word_boundaries_prevent_false_matches():
    found = find_skills("Excellent communicator who used MySQL")
    assert "Excel" not in found
    assert "MySQL" in found and "SQL" in found          # implied, not substring-matched


def test_short_names_only_match_through_aliases():
    found = find_skills("Ready to go. R programming and golang experience.")
    assert found.get("R") == 1 and "Go" in found


def test_spans_are_ordered_and_non_overlapping():
    spans = skill_spans("power bi or tableau")
    assert [s[2] for s in spans] == ["Power BI", "Tableau"]
