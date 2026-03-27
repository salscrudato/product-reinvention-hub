"""Generic Kafka JSON producer utility (consolidated).

This is the canonical version inside kafka_scripts. See module docstring in
__init__ for rationale of consolidation (avoid shadowing external 'kafka').
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Iterable, Iterator, Dict, Any, Optional

BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
DEFAULT_TOPIC = os.getenv("KAFKA_RAW_TOPIC", "crew-raw-events")

def iter_jsonl(path: str) -> Iterator[Dict[str, Any]]:
	with open(path, "r", encoding="utf-8") as f:
		for lineno, line in enumerate(f, 1):
			line = line.strip()
			if not line:
				continue
			try:
				yield json.loads(line)
			except json.JSONDecodeError as e:
				print(f"[producer] WARN line {lineno}: invalid JSON skipped ({e})", file=sys.stderr)

def iter_stdin() -> Iterator[Dict[str, Any]]:
	for lineno, line in enumerate(sys.stdin, 1):
		line = line.strip()
		if not line:
			continue
		try:
			yield json.loads(line)
		except json.JSONDecodeError as e:
			print(f"[producer] WARN stdin line {lineno}: invalid JSON skipped ({e})", file=sys.stderr)

def generate_dummy(count: int, template: Optional[str]) -> Iterator[Dict[str, Any]]:
	base: Dict[str, Any] = {}
	if template:
		try:
			base = json.loads(template)
		except Exception as e:  # pragma: no cover
			print(f"[producer] WARN invalid template JSON ignored: {e}", file=sys.stderr)
	for i in range(count):
		evt = dict(base)
		evt.setdefault("event_id", f"dummy-{i}")
		evt.setdefault("ts", __import__('datetime').datetime.utcnow().isoformat() + 'Z')
		evt.setdefault("sequence", i)
		yield evt

def build_arg_parser() -> argparse.ArgumentParser:
	p = argparse.ArgumentParser(description="Produce JSON events to Kafka")
	p.add_argument("--topic", default=DEFAULT_TOPIC, help="Kafka topic (default from env)")
	p.add_argument("--file", help="Path to JSONL file (one JSON object per line)")
	p.add_argument("--stdin", action="store_true", help="Read JSON objects from STDIN")
	p.add_argument("--generate", type=int, default=0, help="Generate N dummy events if >0")
	p.add_argument("--template", help="JSON template for generated events")
	p.add_argument("--key-field", default="event_id", help="Field to use as Kafka message key (if present)")
	p.add_argument("--delay", type=float, default=0.0, help="Sleep seconds between sends")
	p.add_argument("--max", type=int, default=0, help="Stop after N events (0 = unlimited for input sources)")
	p.add_argument("--dry-run", action="store_true", help="Parse & count only; do not send to Kafka")
	return p

def resolve_source(args) -> Iterable[Dict[str, Any]]:
	sources: list[Iterable[Dict[str, Any]]] = []
	if args.file:
		if not os.path.exists(args.file):
			print(f"[producer] ERROR file not found: {args.file}", file=sys.stderr)
			sys.exit(1)
		sources.append(iter_jsonl(args.file))
	if args.stdin:
		sources.append(iter_stdin())
	if args.generate > 0:
		sources.append(generate_dummy(args.generate, args.template))
	if not sources:
		print("[producer] ERROR no input source specified (use --file, --stdin, or --generate)", file=sys.stderr)
		sys.exit(2)
	# Simple chaining
	for src in sources:
		for item in src:
			yield item

def main() -> int:
	parser = build_arg_parser()
	args = parser.parse_args()

	if args.dry_run:
		count = 0
		for evt in resolve_source(args):
			count += 1
			if args.max and count >= args.max:
				break
		print(f"[producer] Dry run complete. Events parsed={count}")
		return 0

	try:
		from kafka import KafkaProducer  # type: ignore[import-not-found]
	except Exception as e:  # pragma: no cover
		print(f"[producer] ERROR kafka-python not installed ({e}). Run: pip install kafka-python", file=sys.stderr)
		return 1

	prod = KafkaProducer(
		bootstrap_servers=BOOTSTRAP,
		value_serializer=lambda v: json.dumps(v).encode("utf-8"),
		key_serializer=lambda v: v.encode("utf-8") if isinstance(v, str) else v,
		linger_ms=50,
		retries=3,
	)

	sent = 0
	try:
		for evt in resolve_source(args):
			key_val = None
			if args.key_field and isinstance(evt, dict) and args.key_field in evt:
				key_val = str(evt[args.key_field])
			prod.send(args.topic, value=evt, key=key_val)
			sent += 1
			if sent % 1000 == 0:
				print(f"[producer] Sent {sent} events...")
			if args.delay:
				time.sleep(args.delay)
			if args.max and sent >= args.max:
				break
		prod.flush()
	finally:
		try:
			prod.close()
		except Exception:
			pass
	print(f"[producer] Completed. Events sent={sent}")
	return 0

if __name__ == "__main__":  # pragma: no cover
	raise SystemExit(main())
