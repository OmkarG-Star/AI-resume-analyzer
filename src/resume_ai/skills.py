"""Skill taxonomy and matching.

Each canonical skill has a category and a list of aliases. Matching uses token
boundaries so "sql" does not fire inside "mysql" and "excel" does not fire
inside "excellent". A few skills imply a broader one (PostgreSQL implies SQL),
so a resume is not penalised for naming the specific tool.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

TAXONOMY: dict[str, dict[str, list[str]]] = {
    "Programming": {
        "Python": ["python", "python3"],
        "SQL": ["sql", "t-sql", "tsql", "pl/sql", "plsql"],
        "R": ["r programming", "r language", "rstudio"],
        "Java": ["java"],
        "Scala": ["scala"],
        "JavaScript": ["javascript", "js", "es6"],
        "TypeScript": ["typescript"],
        "C++": ["c++", "cpp"],
        "C#": ["c#", "csharp", ".net"],
        "Go": ["golang"],
        "Bash": ["bash", "shell scripting", "shell script"],
        "VBA": ["vba", "excel macros", "macros"],
    },
    "Data & Analytics": {
        "Pandas": ["pandas"],
        "NumPy": ["numpy"],
        "Excel": ["excel", "ms excel", "microsoft excel", "advanced excel"],
        "Power BI": ["power bi", "powerbi", "dax", "power query"],
        "Tableau": ["tableau"],
        "Looker": ["looker", "looker studio", "google data studio"],
        "Data Analysis": ["data analysis", "data analytics", "analytical"],
        "Data Visualization": ["data visualization", "data visualisation", "dashboards", "dashboard", "visualization"],
        "Statistics": ["statistics", "statistical analysis", "hypothesis testing", "a/b testing", "ab testing"],
        "EDA": ["eda", "exploratory data analysis"],
        "Matplotlib": ["matplotlib"],
        "Seaborn": ["seaborn"],
        "Plotly": ["plotly"],
        "MIS Reporting": ["mis", "mis reporting", "management information"],
        "Data Cleaning": ["data cleaning", "data cleansing", "data wrangling", "data preparation"],
    },
    "Machine Learning": {
        "Machine Learning": ["machine learning", "ml models", "ml model", "predictive modeling", "predictive modelling"],
        "Deep Learning": ["deep learning", "neural networks", "neural network"],
        "Scikit-learn": ["scikit-learn", "scikit learn", "sklearn"],
        "TensorFlow": ["tensorflow", "keras"],
        "PyTorch": ["pytorch", "torch"],
        "XGBoost": ["xgboost"],
        "LightGBM": ["lightgbm"],
        "NLP": ["nlp", "natural language processing", "text mining", "text classification"],
        "Computer Vision": ["computer vision", "opencv", "image classification"],
        "LLMs": ["llm", "llms", "large language models", "gpt", "langchain", "rag", "retrieval augmented generation", "prompt engineering"],
        "Feature Engineering": ["feature engineering", "feature selection"],
        "Model Evaluation": ["model evaluation", "cross-validation", "cross validation", "roc-auc", "precision and recall"],
        "Time Series": ["time series", "time-series", "forecasting", "arima", "prophet"],
        "Explainable AI": ["shap", "explainable ai", "lime", "model explainability", "xai"],
        "Clustering": ["clustering", "kmeans", "k-means", "segmentation"],
        "Regression": ["regression", "linear regression", "logistic regression"],
        "Classification": ["classification", "classifier"],
        "Recommender Systems": ["recommender system", "recommendation engine", "recommendation system"],
        "MLOps": ["mlops", "mlflow", "model monitoring", "model deployment", "kubeflow"],
    },
    "Data Engineering": {
        "ETL": ["etl", "elt", "data pipeline", "data pipelines", "pipelines"],
        "Apache Spark": ["spark", "pyspark", "apache spark", "spark sql"],
        "Hadoop": ["hadoop", "hdfs", "hive", "mapreduce"],
        "Kafka": ["kafka", "apache kafka"],
        "Airflow": ["airflow", "apache airflow"],
        "dbt": ["dbt", "data build tool"],
        "Data Warehousing": ["data warehouse", "data warehousing", "dimensional modeling", "star schema"],
        "Snowflake": ["snowflake"],
        "BigQuery": ["bigquery", "big query"],
        "Redshift": ["redshift"],
        "Databricks": ["databricks", "delta lake"],
        "Parquet": ["parquet"],
        "Data Modeling": ["data modeling", "data modelling"],
        "Data Quality": ["data quality", "data validation", "great expectations"],
    },
    "Databases": {
        "PostgreSQL": ["postgresql", "postgres"],
        "MySQL": ["mysql"],
        "SQL Server": ["sql server", "mssql", "ssms", "ssis"],
        "Oracle": ["oracle db", "oracle database"],
        "MongoDB": ["mongodb", "mongo"],
        "SQLite": ["sqlite"],
        "Redis": ["redis"],
        "DuckDB": ["duckdb"],
    },
    "Cloud & DevOps": {
        "AWS": ["aws", "amazon web services", "s3", "ec2", "aws lambda", "sagemaker", "aws glue"],
        "Azure": ["azure", "azure data factory", "adf", "synapse"],
        "GCP": ["gcp", "google cloud", "vertex ai"],
        "Docker": ["docker", "containers", "containerization"],
        "Kubernetes": ["kubernetes", "k8s"],
        "CI/CD": ["ci/cd", "cicd", "github actions", "jenkins", "gitlab ci"],
        "Git": ["git", "github", "gitlab", "bitbucket", "version control"],
        "Linux": ["linux", "unix"],
        "Terraform": ["terraform"],
    },
    "Web & APIs": {
        "FastAPI": ["fastapi"],
        "Flask": ["flask"],
        "Django": ["django"],
        "REST APIs": ["rest api", "rest apis", "restful", "api development"],
        "Streamlit": ["streamlit"],
        "React": ["react", "reactjs", "react.js"],
        "HTML/CSS": ["html", "css"],
    },
    "Tools": {
        "Jupyter": ["jupyter", "jupyter notebook", "notebooks"],
        "Jira": ["jira"],
        "SAP": ["sap"],
        "Google Sheets": ["google sheets"],
    },
    "Business & Soft Skills": {
        "Stakeholder Management": ["stakeholder management", "stakeholders", "stakeholder"],
        "Communication": ["communication", "presentation skills", "presenting"],
        "Leadership": ["leadership", "led a team", "team lead", "mentored", "mentoring"],
        "Problem Solving": ["problem solving", "problem-solving"],
        "Business Insights": ["business insights", "business acumen", "actionable insights"],
        "HR Analytics": ["hr analytics", "people analytics", "workforce analytics", "attrition"],
        "Finance": ["financial analysis", "financial modeling", "budgeting"],
        "Project Management": ["project management", "agile", "scrum"],
    },
}

# Specific tools that demonstrate a broader skill.
IMPLIES: dict[str, list[str]] = {
    "PostgreSQL": ["SQL"], "MySQL": ["SQL"], "SQL Server": ["SQL"], "Oracle": ["SQL"],
    "SQLite": ["SQL"], "DuckDB": ["SQL"], "Snowflake": ["SQL"], "BigQuery": ["SQL"], "Redshift": ["SQL"],
    "PyTorch": ["Deep Learning"], "TensorFlow": ["Deep Learning"],
    "Scikit-learn": ["Machine Learning"], "XGBoost": ["Machine Learning"], "LightGBM": ["Machine Learning"],
    "Apache Spark": ["ETL"], "Airflow": ["ETL"], "dbt": ["ETL"],
    "Databricks": ["Apache Spark"],
    "Power BI": ["Data Visualization"], "Tableau": ["Data Visualization"], "Looker": ["Data Visualization"],
    "Kubernetes": ["Docker"],
}

CATEGORY: dict[str, str] = {s: cat for cat, skills in TAXONOMY.items() for s in skills}
ALL_SKILLS: list[str] = list(CATEGORY)


@dataclass(frozen=True)
class SkillHit:
    skill: str
    category: str
    count: int


@lru_cache(maxsize=1)
def _patterns() -> list[tuple[str, re.Pattern]]:
    out = []
    for cat, skills in TAXONOMY.items():
        for canonical, aliases in skills.items():
            names = {*aliases}
            if len(canonical) > 2:          # "R" and "Go" only match through their aliases
                names.add(canonical.lower())
            names = sorted(names, key=len, reverse=True)
            alt = "|".join(re.escape(n) for n in names)
            out.append((canonical, re.compile(rf"(?<![a-z0-9+#])(?:{alt})(?![a-z0-9+#])")))
    return out


def find_skills(text: str) -> dict[str, int]:
    """Return {canonical skill: mention count} found in the text."""
    low = text.lower()
    found: dict[str, int] = {}
    for canonical, pat in _patterns():
        n = len(pat.findall(low))
        if n:
            found[canonical] = n
    for skill in list(found):
        for broader in IMPLIES.get(skill, []):
            found.setdefault(broader, 1)
    return found


def skill_spans(text: str) -> list[tuple[int, int, str]]:
    """Non-overlapping (start, end, skill) mentions, in reading order."""
    low = text.lower()
    hits = []
    for canonical, pat in _patterns():
        for m in pat.finditer(low):
            hits.append((m.start(), m.end(), canonical))
    hits.sort(key=lambda h: (h[0], -(h[1] - h[0])))
    out, last_end = [], -1
    for h in hits:
        if h[0] >= last_end:
            out.append(h)
            last_end = h[1]
    return out


def by_category(skills) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = {}
    for s in skills:
        groups.setdefault(CATEGORY.get(s, "Other"), []).append(s)
    return {k: sorted(v) for k, v in sorted(groups.items())}
