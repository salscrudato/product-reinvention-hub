import os
import time

RAW_TOPIC = os.getenv('KAFKA_RAW_TOPIC', 'crew-raw-events')
ENRICHED_TOPIC = os.getenv('KAFKA_ENRICHED_TOPIC', 'crew-enriched-events')
METRICS_TOPIC = os.getenv('KAFKA_METRICS_TOPIC', 'crew-metrics-events')
BOOTSTRAP = os.getenv('KAFKA_BOOTSTRAP', 'localhost:9092')

REQUIRED_TOPICS = [
    (RAW_TOPIC, 1, 1),
    (ENRICHED_TOPIC, 1, 1),
    (METRICS_TOPIC, 1, 1),
]

def ensure_topics():
    try:
        from kafka.admin import KafkaAdminClient, NewTopic  # type: ignore[import-not-found]
        from kafka import KafkaProducer  # type: ignore[import-not-found]
    except ImportError:
        print('[topics] ERROR: kafka-python not installed; run pip install kafka-python')
        return 1

    # Simple connectivity retry
    retries = 10
    while retries > 0:
        try:
            admin = KafkaAdminClient(bootstrap_servers=BOOTSTRAP, client_id='topic-init')
            break
        except Exception as e:
            retries -= 1
            if retries == 0:
                print(f'[topics] ERROR: Cannot connect to Kafka at {BOOTSTRAP}: {e}')
                return 1
            time.sleep(2)
    try:
        existing = set(admin.list_topics())
        to_create = []
        for name, partitions, rf in REQUIRED_TOPICS:
            if name not in existing:
                to_create.append(NewTopic(name=name, num_partitions=partitions, replication_factor=rf))
        if to_create:
            try:
                admin.create_topics(to_create)
                print(f'[topics] Created topics: {[t.name for t in to_create]}')
            except Exception as ce:
                print(f'[topics] WARNING: create_topics issue (may already exist): {ce}')
        else:
            print('[topics] All required topics already exist.')
    finally:
        try:
            admin.close()
        except Exception:
            pass
    # Warm producer to avoid first-send latency in app
    try:
        prod = KafkaProducer(bootstrap_servers=BOOTSTRAP)
        prod.close()
    except Exception:
        pass
    return 0

if __name__ == '__main__':
    exit(ensure_topics())
