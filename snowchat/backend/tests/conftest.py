import sys
import os

# Ensure the backend package root is on sys.path so tests can import components.*
HERE = os.path.dirname(__file__)
BACKEND_ROOT = os.path.abspath(os.path.join(HERE, '..'))
PROJECT_ROOT = os.path.abspath(os.path.join(BACKEND_ROOT, '..'))
for p in (PROJECT_ROOT, BACKEND_ROOT):
    if p not in sys.path:
        sys.path.insert(0, p)
print(f"[conftest] inserted {BACKEND_ROOT} and {PROJECT_ROOT} into sys.path")

import pytest
from components.generic_tool_orchestrator import app as gto_app


@pytest.fixture
def client():
    gto_app.testing = True
    with gto_app.test_client() as c:
        yield c
