"""Verify devpilot interpreter, Python version, and presence of key packages.
Run via VS Code task or manually: python scripts/verify_devpilot.py
"""
from __future__ import annotations
import sys
import importlib.metadata as m
from pathlib import Path

PACKAGE_NAMES = ["langgraph", "langchain", "openai", "faiss-cpu", "numpy"]

def safe_version(pkg: str) -> str:
    try:
        return m.version(pkg)
    except Exception:
        return "<missing>"

names_lower = set()
for dist in m.distributions():
    try:
        name = (dist.metadata.get("Name", "") or "").lower()
        if name:
            names_lower.add(name)
    except Exception:
        pass

print("Interpreter:", sys.executable)
print("Version:", sys.version.split()[0])
print("Site-Packages Path Exists?:", Path(sys.executable).parent.joinpath("Lib", "site-packages").exists())
for pkg in PACKAGE_NAMES:
    print(f"{pkg}:", (pkg in names_lower), "version:", safe_version(pkg))

# Explicit boolean summary line for CI / task parser
missing = [p for p in PACKAGE_NAMES if p not in names_lower]
print("All required packages present?", not missing)
if missing:
    print("Missing packages:", ", ".join(missing))
