"""DEPRECATED shim.

This script is deprecated. Use kafka_scripts/consumer.py instead:
  python -m kafka_scripts.consumer <topics...>

We keep this thin wrapper temporarily for backwards compatibility.
"""
from __future__ import annotations
import runpy, sys

def main():  # pragma: no cover - simple delegator
    target = 'kafka_scripts/consumer.py'
    print('[deprecated consumer] Redirecting to', target)
    runpy.run_module('kafka_scripts.consumer', run_name='__main__')

if __name__ == '__main__':  # pragma: no cover
    main()
