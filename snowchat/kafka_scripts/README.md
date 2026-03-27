This folder supersedes the old 'kafka' folder to avoid shadowing the external 'kafka' package.

Contents migrated from deprecated kafka/ directory:
 - producer.py
 - consumer.py
 - replay_spool.py
 - create_topics.py (and native helpers)

Action items:
 1. Delete the legacy 'kafka' folder once no scripts reference it.
 2. Update any docs or automation invoking `python kafka/...` to use `python kafka_scripts/...`.
 3. Ensure `kafka-python` is installed for runtime usage.
