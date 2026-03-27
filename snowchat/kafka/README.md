DEPRECATED FOLDER
=================
This `kafka` directory is deprecated and retained temporarily for reference only. All active scripts have moved to `snowchat_kafka_support/` to avoid Python import shadowing with the external `kafka` package (`kafka-python`).

Use files under `snowchat_kafka_support/` instead (e.g. `snowchat_kafka_support/create_topics.py`). After verifying everything works you may delete this folder.

Legacy Documentation (for reference)
====================================
Kafka Stack
===========

Services:
- Zookeeper (port 2181)
- Kafka Broker (port 9092 exposed for localhost, internal 29092)

Topics (created automatically by start-all.bat via create_topics.py):
- crew-raw-events (default raw event ingestion)
- crew-enriched-events (future enrichment output)
- crew-metrics-events (future aggregated metrics)

Environment Overrides:
- KAFKA_RAW_TOPIC
- KAFKA_ENRICHED_TOPIC
- KAFKA_METRICS_TOPIC
- KAFKA_BOOTSTRAP (default localhost:9092)

Manual Topic Creation:
	set KAFKA_BOOTSTRAP=localhost:9092
	python create_topics.py

Testing Publish:
	python - <<EOF
from kafka import KafkaProducer; p=KafkaProducer(bootstrap_servers='localhost:9092'); p.send('crew-raw-events', b'test'); p.flush(); print('sent')
EOF

Consumer (simple):
	python - <<EOF
from kafka import KafkaConsumer; c=KafkaConsumer('crew-raw-events', bootstrap_servers='localhost:9092', auto_offset_reset='earliest');
print('Waiting...');
for m in c: print(m.topic, m.value)
EOF

The application backend uses ENABLE_EVENT_STREAMING=true to enable Kafka publishing; otherwise events spool to event_spool.jsonl.

Native (No Docker) Kafka
------------------------
1. Download Apache Kafka binary (e.g. 3.x) and extract (e.g. C:\kafka).
2. Set env var KAFKA_HOME to that path.
3. Run start-all.bat (it will auto-detect and start native Zookeeper + Broker if Docker absent).
4. Topics are ensured via create_topics_native.bat.
5. Replay any spooled events once running:  python snowchat_kafka_support\replay_spool.py

Manual native start (optional):
	%KAFKA_HOME%\bin\windows\zookeeper-server-start.bat %KAFKA_HOME%\config\zookeeper.properties
	%KAFKA_HOME%\bin\windows\kafka-server-start.bat %KAFKA_HOME%\config\server.properties
