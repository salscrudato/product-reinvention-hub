import argparse
import json
import os
import time
from typing import Iterable

BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
RAW_TOPIC = os.getenv("KAFKA_RAW_TOPIC", "crew-raw-events")


def iter_lines(path: str) -> Iterable[str]:
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            yield line


def main():
    parser = argparse.ArgumentParser(description="Replay spooled JSONL events into Kafka raw topic")
    parser.add_argument("--file", default="event_spool.jsonl", help="Path to spool file (default: event_spool.jsonl)")
    parser.add_argument("--topic", default=RAW_TOPIC, help="Kafka topic (default from env or crew-raw-events)")
    parser.add_argument("--batch", type=int, default=500, help="Flush every N messages (default 500)")
    parser.add_argument("--sleep", type=float, default=0.0, help="Sleep seconds between messages (simulate real-time)")
    args = parser.parse_args()

    try:
        from kafka import KafkaProducer  # type: ignore[import-not-found]
    except ImportError:
        print("[replay] ERROR: kafka-python not installed. Run: pip install kafka-python")
        return 1

    if not os.path.exists(args.file):
        print(f"[replay] File not found: {args.file}")
        return 1

    print(f"[replay] Bootstrapping to {BOOTSTRAP}; topic={args.topic}; file={args.file}")
    prod = KafkaProducer(bootstrap_servers=BOOTSTRAP, value_serializer=lambda v: json.dumps(v).encode("utf-8"))

    count = 0
    try:
        for line in iter_lines(args.file):
            try:
                evt = json.loads(line)
            except json.JSONDecodeError:
                print(f"[replay] Skipping invalid JSON: {line[:120]}")
                continue
            prod.send(args.topic, evt)
            count += 1
            if count % args.batch == 0:
                prod.flush()
                print(f"[replay] Flushed {count} events...")
            if args.sleep:
                time.sleep(args.sleep)
        prod.flush()
    finally:
        prod.close()
    print(f"[replay] Completed. Total events sent: {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
