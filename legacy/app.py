import streamlit as st
import pandas as pd
import re

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# ---------------------------
# Page Config
# ---------------------------
st.set_page_config(page_title="AI Resume Analyzer", layout="wide")

# ---------------------------
# UI Styling
# ---------------------------
st.markdown("""
<style>
.stButton>button {
    background: linear-gradient(90deg, #2563EB, #4F46E5);
    color: white;
    border-radius: 10px;
    height: 3em;
    width: 100%;
    font-size: 18px;
}
</style>
""", unsafe_allow_html=True)

# ---------------------------
# Title
# ---------------------------
st.markdown("""
<h1 style='text-align:center;'>📄 AI Resume Analyzer</h1>
<p style='text-align:center;'>NLP + TF-IDF + Cosine Similarity</p>
""", unsafe_allow_html=True)

st.markdown("---")

# ---------------------------
# Input Fields
# ---------------------------
col1, col2 = st.columns(2)

with col1:
    resume_text = st.text_area("📄 Paste Resume", height=300)

with col2:
    jd_text = st.text_area("📋 Paste Job Description", height=300)

# ---------------------------
# Skill List
# ---------------------------
skills_list = [
    "python", "sql", "machine learning", "deep learning",
    "data analysis", "data science", "pandas", "numpy",
    "scikit learn", "statistics", "nlp", "xgboost",
    "random forest", "logistic regression", "data visualization",
    "matplotlib", "seaborn", "power bi", "tableau", "excel",
    "streamlit", "flask", "fastapi", "aws", "spark",
    "git", "github", "jupyter"
]

# ---------------------------
# Text Cleaning Function
# ---------------------------
def clean_text(text):
    text = text.lower()
    text = re.sub(r"[^a-zA-Z0-9\s]", "", text)
    return text

# ---------------------------
# Analyze Button
# ---------------------------
if st.button("🚀 Analyze Resume"):

    if resume_text.strip() == "" or jd_text.strip() == "":
        st.warning("Please enter both Resume and Job Description")
    else:

        # Clean text
        clean_resume = clean_text(resume_text)
        clean_jd = clean_text(jd_text)

        # ---------------------------
        # TF-IDF + Cosine Similarity
        # ---------------------------
        vectorizer = TfidfVectorizer()
        vectors = vectorizer.fit_transform([clean_resume, clean_jd])

        score = cosine_similarity(vectors[0:1], vectors[1:2])[0][0]
        score_percent = round(score * 100, 2)

        # ---------------------------
        # Score Display
        # ---------------------------
        st.subheader("📊 Match Score")

        if score_percent > 75:
            st.success(f"🔥 High Match: {score_percent}%")
        elif score_percent > 50:
            st.warning(f"⚠️ Medium Match: {score_percent}%")
        else:
            st.error(f"❌ Low Match: {score_percent}%")

        st.progress(score)

        # ---------------------------
        # Skill Extraction
        # ---------------------------
        resume_skills = [skill for skill in skills_list if skill in clean_resume]
        jd_skills = [skill for skill in skills_list if skill in clean_jd]

        # FIXED Missing Skills Logic
        missing_skills = list(set(jd_skills) - set(resume_skills))

        # ---------------------------
        # Display Skills
        # ---------------------------
        col3, col4 = st.columns(2)

        with col3:
            st.subheader("🧠 Skills Found in Resume")
            st.write(resume_skills)

        with col4:
            st.subheader("❌ Missing Skills")

            if missing_skills:
                st.write(missing_skills)
            else:
                st.success("No major skills missing 🎯")

        # ---------------------------
        # Save Result CSV
        # ---------------------------
        result_df = pd.DataFrame({
            "Match Score": [score_percent],
            "Resume Skills": [", ".join(resume_skills)],
            "Missing Skills": [", ".join(missing_skills)]
        })

        csv = result_df.to_csv(index=False).encode("utf-8")

        st.download_button(
            label="📥 Download Analysis Report",
            data=csv,
            file_name="resume_analysis.csv",
            mime="text/csv"
        )