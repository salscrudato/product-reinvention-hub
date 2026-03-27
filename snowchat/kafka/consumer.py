"""Generic Kafka JSON consumer utility.

Features:
 - Subscribe to one or more topics.
 - Optional regex / substring filtering on message value.
 - Pretty-print or raw JSON output.
 - Offset reset control & max message cap.
 - Graceful handling if kafka-python missing.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any, Iterable

BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")


def build_arg_parser() -> argparse.ArgumentParser:
	p = argparse.ArgumentParser(description="Consume Kafka JSON messages")
	p.add_argument("topics", nargs="+", help="Topic(s) to subscribe to")
	p.add_argument("--group", default="snowchat-consumer", help="Consumer group id")
	p.add_argument("--from-beginning", action="store_true", help="Start from earliest offset")
	p.add_argument("--max", type=int, default=0, help="Stop after N messages (0 = unlimited)")
	p.add_argument("--grep", help="Substring filter applied to serialized JSON")
	p.add_argument("--sleep", type=float, default=0.0, help="Sleep between polls (sec)")
	p.add_argument("--pretty", action="store_true", help="Pretty-print JSON output")
	p.add_argument("--show-meta", action="store_true", help="Print partition/offset metadata")
	p.add_argument("--timeout", type=float, default=30.0, help="Exit if no messages within N seconds (0=never)")
	return p


def main() -> int:
	parser = build_arg_parser()
	args = parser.parse_args()

	try:
		from kafka import KafkaConsumer  # type: ignore[import-not-found]
	except Exception as e:  # pragma: no cover
		print(f"[consumer] ERROR kafka-python not installed ({e}). Run: pip install kafka-python", file=sys.stderr)
		return 1

	consumer = KafkaConsumer(
		*args.topics,
		bootstrap_servers=BOOTSTRAP,
		group_id=args.group,
		auto_offset_reset="earliest" if args.from_beginning else "latest",
		value_deserializer=lambda b: json.loads(b.decode("utf-8")) if b else None,
		enable_auto_commit=True,
		consumer_timeout_ms=5000,
		max_poll_records=500,
	)

	print(f"[consumer] Subscribed to {args.topics} on {BOOTSTRAP} group={args.group}")
	received = 0
	last_msg_time = time.time()
	try:
		while True:
			for msg in consumer.poll(timeout_ms=500).values():  # dict partition -> list[ConsumerRecord]
				for record in msg:
					last_msg_time = time.time()
					val = record.value
					try:
						serialized = json.dumps(val, ensure_ascii=False)
					except Exception:
						serialized = str(val)
					if args.grep and args.grep not in serialized:
						continue
					if args.show_meta:
						meta = f"[p={record.partition} o={record.offset}] "
					else:
						meta = ""
					if args.pretty and isinstance(val, (dict, list)):
						print(meta + json.dumps(val, indent=2, ensure_ascii=False))
					else:
						print(meta + serialized)
					received += 1
					if args.max and received >= args.max:
						print(f"[consumer] Reached max {args.max}; exiting.")
						return 0
			if args.timeout and args.timeout > 0 and (time.time() - last_msg_time) > args.timeout:
				print(f"[consumer] Inactivity timeout {args.timeout}s reached; exiting.")
				return 0
			if args.sleep:
				time.sleep(args.sleep)
	finally:
		try:
			consumer.close()
		except Exception:
			pass


if __name__ == "__main__":  # pragma: no cover
	raise SystemExit(main())

