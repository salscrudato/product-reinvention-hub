"""Consolidated Kafka utility scripts.

This package houses internal tooling that previously lived in folders whose
names risked shadowing the external 'kafka' (kafka-python) package.

Modules provided:
	producer        - CLI & helper for sending JSON events
	consumer        - Streaming consumer with optional filters
	create_topics   - Idempotent topic creation utility
	replay_spool    - Replays a JSONL spool to a topic
	diagnose_native - Diagnostics for kafka-python & broker connectivity

All modules degrade gracefully if kafka-python is not installed by printing a
clear instructional message and exiting with non-zero status (for CLI usage)
or raising a RuntimeError (for programmatic usage). This keeps the broader
application optional with respect to Kafka.
"""
from __future__ import annotations

__all__ = [
		'producer',
		'consumer',
		'create_topics',
		'replay_spool',
		'diagnose_native',
]

from . import producer  # noqa: F401
from . import consumer  # noqa: F401
from . import create_topics  # noqa: F401
from . import replay_spool  # noqa: F401
from . import diagnose_native  # noqa: F401


