from resume_ai import jd

JD = """Senior Data Engineer
Responsibilities
- Build pipelines with Airflow
Requirements
- 4+ years of experience
- Strong SQL and Python
- Snowflake, BigQuery or Redshift
- Bachelor's degree in Computer Science
Nice to have
- Kafka
- Experience with Docker is a plus
"""


def test_required_and_preferred_split():
    spec = jd.parse(JD)
    assert {"SQL", "Python", "Snowflake"} <= set(spec.required)
    assert {"Kafka", "Docker", "Airflow"} <= set(spec.preferred)   # duties-only skills become nice-to-have


def test_years_education_and_seniority():
    spec = jd.parse(JD)
    assert spec.min_years == 4 and spec.education_label == "Bachelor's" and spec.seniority == "Senior"


def test_either_or_groups():
    assert ["Snowflake", "BigQuery", "Redshift"] in jd.parse(JD).groups
    assert jd.alternatives("FastAPI or Flask, Docker and Git") == [["FastAPI", "Flask"]]
    assert jd.alternatives("Airflow, dbt and Spark") == []


def test_unstructured_job_treats_mentions_as_required():
    spec = jd.parse("We need someone who knows Python and SQL to build reports.")
    assert set(spec.required) == {"Python", "SQL"}
