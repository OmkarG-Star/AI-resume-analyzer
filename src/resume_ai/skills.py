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

# Plain-language descriptions of the work a skill involves. A resume that says
# "orchestrated DAG-based workflows" is doing what the job means by Airflow, even
# without naming the tool. These matches are "related" evidence: worth partial
# credit and a question in the interview, never full credit.
RELATED: dict[str, list[str]] = {
    "Airflow": [r"\bdags?\b", r"dag-based", r"orchestrat\w*\s+(?:\w+\s+){0,2}(?:workflows?|pipelines?|jobs|tasks)",
                r"workflow (?:scheduling|orchestration|scheduler)", r"job schedul\w+"],
    "ETL": [r"batch jobs?", r"\bingest\w*", r"extract(?:ed|ing)?,? transform", r"data feeds?", r"loading \w+ into"],
    "Data Warehousing": [r"\bwarehouse\b", r"star-schema", r"fact tables?", r"dimension(?:al)? (?:tables?|models?)",
                         r"lakehouse", r"data marts?"],
    "Data Modeling": [r"star-schema", r"dimensional models?", r"schema design", r"designed (?:\w+\s+){0,3}schemas?",
                      r"data models?\b", r"fact tables?"],
    "Snowflake": [r"cloud (?:data )?warehouse", r"lakehouse"],
    "BigQuery": [r"cloud (?:data )?warehouse", r"lakehouse"],
    "Redshift": [r"cloud (?:data )?warehouse", r"lakehouse"],
    "dbt": [r"sql transformations?", r"transformation layer", r"modular sql", r"sql models? with tests"],
    "Kafka": [r"message (?:broker|queue|bus)", r"event stream\w*", r"stream(?:ed|ing)? (?:\w+\s+){0,2}events",
              r"pub/?sub", r"real-time (?:ingestion|pipelines?|events)"],
    "Apache Spark": [r"distributed (?:compute|computing|processing|jobs?)", r"cluster computing",
                     r"compute cluster"],
    "Data Cleaning": [r"\bclean(?:ed|ing|s)?\b(?:\s+\w+){0,3}\s+(?:data|records|datasets?)", r"de-?duplicat\w*",
                      r"fix(?:ed|ing)\s+(?:[\d,]+\s+)?(?:\w+\s+){0,2}records", r"master data"],
    "Data Quality": [r"data (?:checks|tests)", r"validation (?:rules|checks)", r"reconcil\w+",
                     r"(?:null|duplicate|schema) checks", r"data contracts?"],
    "CI/CD": [r"automated (?:deploy\w*|tests?|testing|releases?)", r"deployment pipelines?",
              r"continuous (?:integration|deployment|delivery)"],
    "Git": [r"pull requests?", r"code reviews?", r"version[- ]controlled", r"branching"],
    "Machine Learning": [r"predictive models?", r"trained (?:a |an )?(?:\w+\s+){0,2}models?", r"model training"],
    "Statistics": [r"statistical(?:ly)? significan\w+", r"confidence intervals?", r"p-values?", r"t-tests?",
                   r"chi-square", r"\banova\b", r"experiment design"],
    "Classification": [r"predict(?:ed|ing|s)? (?:whether|which|if)\b", r"churn (?:model|prediction)",
                       r"attrition (?:model|risk)", r"risk scor\w+"],
    "Regression": [r"predict(?:ed|ing|s)? (?:\w+\s+){0,2}(?:amount|value|price|cost|demand|salary|salaries)"],
    "Feature Engineering": [r"(?:built|created|derived|designed) (?:\w+\s+){0,2}features", r"feature tables?"],
    "Model Evaluation": [r"precision", r"recall\b", r"\bauc\b", r"f1[- ]score", r"holdout", r"back-?test\w*"],
    "Data Visualization": [r"\bcharts?\b", r"visual reports?", r"kpi (?:views|boards?)"],
    "Docker": [r"containeri[sz]ed"],
    "REST APIs": [r"\bendpoints?\b", r"served (?:\w+\s+){0,3}(?:behind|via|through) an? api", r"\bapis?\b"],
}
RELATED_CREDIT = 0.4

# One-line descriptions of what each skill looks like in practice. The semantic
# model compares these with resume lines to spot skills described without
# their name. Skills without an entry use "<name> (<category>)".
SKILL_DESC: dict[str, str] = {
    "Python": "writing Python code and scripts for data processing or automation",
    "SQL": "writing SQL queries, joins and aggregations on relational databases",
    "Excel": "building spreadsheets, pivot tables and formulas in Excel",
    "Power BI": "building Power BI reports and dashboards with DAX",
    "Tableau": "building Tableau dashboards and visual analytics",
    "Data Visualization": "building dashboards, charts and visual reports for stakeholders",
    "Data Analysis": "analysing data to find trends and answer business questions",
    "Data Cleaning": "cleaning, deduplicating and fixing messy records and master data",
    "Statistics": "statistical analysis, hypothesis tests, significance and confidence intervals",
    "EDA": "exploring a dataset to understand distributions and patterns",
    "Pandas": "manipulating tabular data with pandas dataframes in Python",
    "NumPy": "numerical computing with arrays in Python",
    "MIS Reporting": "preparing recurring management information reports",
    "Machine Learning": "training and evaluating predictive machine learning models",
    "Deep Learning": "training neural networks for prediction or perception tasks",
    "Scikit-learn": "building machine learning models with scikit-learn",
    "PyTorch": "training neural networks with PyTorch",
    "TensorFlow": "training neural networks with TensorFlow or Keras",
    "NLP": "processing and classifying text with natural language processing",
    "LLMs": "building applications with large language models, prompts and retrieval",
    "Feature Engineering": "deriving and selecting input features for a predictive model",
    "Model Evaluation": "evaluating models with holdout sets, precision, recall and AUC",
    "Time Series": "forecasting values over time such as demand or headcount",
    "Explainable AI": "explaining model predictions with SHAP or feature importance",
    "Classification": "classification models that predict which category something belongs to, such as whether an employee will leave",
    "Regression": "regression models that predict a numeric value such as salary, price or demand",
    "Clustering": "grouping similar records into segments without labels",
    "MLOps": "deploying, tracking and monitoring machine learning models in production",
    "ETL": "building data pipelines that extract, transform and load data on a schedule",
    "Apache Spark": "processing large datasets with distributed compute such as Spark",
    "Kafka": "streaming events through a message broker in real time",
    "Airflow": "scheduling and orchestrating data pipeline workflows as DAGs with retries",
    "dbt": "SQL transformation models with tests and documentation in a data warehouse",
    "Data Warehousing": "designing and loading a data warehouse with fact and dimension tables",
    "Data Modeling": "designing data models and schemas such as star schemas",
    "Data Quality": "data validation checks for nulls, duplicates and broken records",
    "Snowflake": "working in the Snowflake cloud data warehouse",
    "BigQuery": "working in the Google BigQuery cloud data warehouse",
    "Redshift": "working in the Amazon Redshift cloud data warehouse",
    "Databricks": "working with notebooks and Spark on Databricks",
    "AWS": "using Amazon Web Services cloud such as S3, EC2 or Lambda",
    "Azure": "using Microsoft Azure cloud services",
    "GCP": "using Google Cloud Platform services",
    "Docker": "packaging applications in Docker containers",
    "Kubernetes": "running containers on Kubernetes clusters",
    "CI/CD": "automated build, test and deployment pipelines",
    "Git": "version control with Git, branches, pull requests and code review",
    "FastAPI": "building REST APIs with FastAPI",
    "Flask": "building web services with Flask",
    "REST APIs": "designing and building REST API endpoints",
    "HR Analytics": "analysing workforce data such as headcount, attrition, hiring and absenteeism",
    "Stakeholder Management": "working with business stakeholders to agree requirements",
    "Communication": "presenting findings clearly to managers and non-technical people",
    "Leadership": "leading or mentoring a team",
    "Project Management": "planning and delivering projects with agile or scrum",
    "Looker": "building Looker or Looker Studio dashboards and metrics",
}


# Short extra phrasings. A long description dilutes the match for terse resume
# lines, so each skill is compared with its description and these, and the best
# match counts.
SKILL_PHRASES: dict[str, list[str]] = {
    "Classification": ["classification model", "predicted whether something will happen", "churn or attrition prediction model"],
    "Regression": ["regression model", "predicted a numeric value such as price, time or salary"],
    "Feature Engineering": ["feature engineering", "derived input features for a model"],
    "Model Evaluation": ["model evaluation", "evaluated models with cross-validation, precision, recall or AUC"],
    "Machine Learning": ["machine learning model", "trained predictive models"],
    "Statistics": ["statistical analysis", "hypothesis tests and significance"],
    "Airflow": ["Airflow", "orchestrated scheduled data pipelines as DAGs"],
    "ETL": ["ETL pipeline", "loaded data from source systems into a warehouse"],
    "dbt": ["dbt", "SQL transformation models with tests in a data warehouse"],
    "Data Warehousing": ["data warehouse", "fact and dimension tables in a warehouse"],
    "Data Modeling": ["data modeling", "designed star schema tables"],
    "Data Quality": ["data quality checks", "checks that stop bad or duplicate data"],
    "Kafka": ["Kafka", "streamed events in real time"],
    "CI/CD": ["CI/CD", "automated build and deployment pipelines"],
    "Git": ["Git", "version control with pull request reviews"],
    "HR Analytics": ["HR analytics", "analysed employee attrition, headcount or hiring data"],
    "Data Visualization": ["data visualization", "built dashboards and charts"],
    "Data Cleaning": ["data cleaning", "cleaned and deduplicated records"],
    "MLOps": ["MLOps", "deployed and monitored machine learning models in production"],
}


def skill_query(skill: str) -> str:
    return SKILL_DESC.get(skill) or f"{skill} ({CATEGORY.get(skill, 'skill')})"


def skill_queries(skill: str) -> list[str]:
    """Every phrasing used to look for a skill described without its name."""
    return [skill_query(skill)] + SKILL_PHRASES.get(skill, [])

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


def find_skills(text: str, implied: bool = True) -> dict[str, int]:
    """Return {canonical skill: mention count} found in the text.

    With implied=False only skills named outright are returned (PostgreSQL,
    not the SQL it implies).
    """
    low = text.lower()
    found: dict[str, int] = {}
    for canonical, pat in _patterns():
        n = len(pat.findall(low))
        if n:
            found[canonical] = n
    if not implied:
        return found
    for skill in list(found):
        for broader in IMPLIES.get(skill, []):
            found.setdefault(broader, 1)
    return found


@lru_cache(maxsize=1)
def _related_patterns() -> list[tuple[str, re.Pattern]]:
    return [(skill, re.compile("|".join(f"(?:{p})" for p in pats), re.I)) for skill, pats in RELATED.items()]


def find_related(text: str, exclude=()) -> dict[str, str]:
    """{skill: the phrase that suggests it} for skills described but not named.

    Skills in `exclude` (usually the ones already found by name) are skipped.
    """
    out: dict[str, str] = {}
    skip = set(exclude)
    for skill, pat in _related_patterns():
        if skill in skip:
            continue
        m = pat.search(text)
        if m:
            out[skill] = m.group(0).strip()
    return out


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
