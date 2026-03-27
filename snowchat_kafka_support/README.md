# Snowchat Kafka Support Folder

This directory replaces the previous `kafka/` folder to avoid shadowing the external `kafka` (kafka-python) package.

Contents:
- start-native.bat: Launches Zookeeper and Kafka (native)
- create_topics.py / create_topics_native.bat: Ensure required topics
- consumer.py / producer.py: Simple test utilities
- replay_spool.py: Replays spooled events into Kafka
- reset-native-state.bat: Clears local state

Folder was renamed from `kafka` to `snowchat_kafka_support` specifically to prevent Python import collisions with `kafka-python`.
