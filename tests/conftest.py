import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
SAMPLES = Path(__file__).resolve().parents[1] / "samples"

import os
import tempfile

# Never touch a real job library from the tests.
os.environ["JOBS_DB"] = os.path.join(tempfile.mkdtemp(prefix="ri-test-"), "jobs.db")
