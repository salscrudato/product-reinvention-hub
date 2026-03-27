import json
import os
import threading
from queue import Queue, Empty
from typing import Dict, Any, Optional

from .schema import new_event

_KAFKA_ENABLED = os.getenv('ENABLE_EVENT_STREAMING', 'false').lower() in ('1','true','yes','on')
_KAFKA_BOOTSTRAP = os.getenv('KAFKA_BOOTSTRAP', 'localhost:9092')
_KAFKA_TOPIC = os.getenv('KAFKA_RAW_TOPIC', 'crew-raw-events')
_SPOOL_FILE = os.getenv('EVENT_SPOOL_FILE', 'event_spool.jsonl')

_queue: "Queue[Dict[str, Any]]" = Queue(maxsize=5000)
_started = False
_kafka_producer = None

def _init_kafka():
    global _kafka_producer
    if not _KAFKA_ENABLED:
        return
    try:
        from kafka import KafkaProducer  # type: ignore[import-not-found]  # kafka-python optional dependency
        _kafka_producer = KafkaProducer(
            bootstrap_servers=_KAFKA_BOOTSTRAP,
            value_serializer=lambda v: json.dumps(v).encode('utf-8'),
            linger_ms=50,
            retries=3
        )
    except Exception as e:
        _kafka_producer = None

def _worker():
    while True:
        try:
            evt = _queue.get()
            if evt is None:
                break
            if _kafka_producer:
                try:
                    _kafka_producer.send(_KAFKA_TOPIC, evt)
                except Exception:
                    _spool(evt)
            else:
                _spool(evt)
        except Exception:
            pass

def _spool(evt: Dict[str, Any]):
    try:
        with open(_SPOOL_FILE, 'a', encoding='utf-8') as f:
            f.write(json.dumps(evt, ensure_ascii=False) + '\n')
    except Exception:
        pass

def _ensure_started():
    global _started
    if _started:
        return
    _init_kafka()
    t = threading.Thread(target=_worker, name='event-emitter', daemon=True)
    t.start()
    _started = True

def emit_event(event_type: str, correlation_id: Optional[str] = None, **data):
    """Public API: create and enqueue an event."""
    try:
        _ensure_started()
        evt = new_event(event_type, correlation_id=correlation_id, **data)
        try:
            _queue.put_nowait(evt)
        except Exception:
            _spool(evt)  # fallback if queue full
        return evt
    except Exception:
        return None

__all__ = ['emit_event']
