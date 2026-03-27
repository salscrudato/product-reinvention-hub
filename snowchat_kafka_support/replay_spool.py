"""DEPRECATED shim for replay_spool.

Use:
  python -m kafka_scripts.replay_spool --file event_spool.jsonl
"""
from __future__ import annotations
import runpy

def main():  # pragma: no cover
    print('[deprecated replay_spool] Redirecting to kafka_scripts.replay_spool')
    runpy.run_module('kafka_scripts.replay_spool', run_name='__main__')

if __name__ == '__main__':  # pragma: no cover
    main()
