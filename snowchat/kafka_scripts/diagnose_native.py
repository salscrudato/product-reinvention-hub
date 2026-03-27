"""Diagnostics for Kafka local/native environment & kafka-python availability (consolidated)."""
from __future__ import annotations

import os, socket, subprocess, json, shutil, sys

REPORT: dict[str, object] = {}

def check_env():
    kafka_home = os.getenv('KAFKA_HOME')
    REPORT['KAFKA_HOME'] = kafka_home or '<not set>'
    if kafka_home and os.path.isdir(kafka_home):
        needed = [
            'bin/windows/zookeeper-server-start.bat',
            'bin/windows/kafka-server-start.bat',
            'config/zookeeper.properties',
            'config/server.properties'
        ]
        missing = [p for p in needed if not os.path.exists(os.path.join(kafka_home, p))]
        REPORT['missing_kafka_files'] = missing
    else:
        REPORT['missing_kafka_files'] = 'n/a'

def check_java():
    java = shutil.which('java')
    REPORT['java_found'] = bool(java)
    if not java:
        REPORT['java_issue'] = 'java not on PATH'

def port_open(port: int, host: str='localhost', timeout: float=1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False

def check_ports():
    REPORT['port_2181_open'] = port_open(2181)
    REPORT['port_9092_open'] = port_open(9092)

def list_topics_native():
    kafka_home = os.getenv('KAFKA_HOME')
    if not kafka_home:
        return None, 'KAFKA_HOME not set'
    script = os.path.join(kafka_home, 'bin', 'windows', 'kafka-topics.bat')
    if not os.path.exists(script):
        return None, 'kafka-topics.bat missing'
    try:
        cmd = [script, '--list', '--bootstrap-server', 'localhost:9092']
        out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, timeout=10, shell=False)
        topics = out.decode(errors='ignore').strip().splitlines()
        return topics, None
    except subprocess.CalledProcessError as e:
        return None, f'error listing topics: {e.output.decode(errors="ignore")[:300]}'
    except Exception as e:
        return None, str(e)

def attempt_kafka_python():
    try:
        from kafka import KafkaAdminClient  # type: ignore[import-not-found]
    except Exception as e:
        REPORT['kafka_python'] = f'not available ({e.__class__.__name__})'
        return
    try:
        admin = KafkaAdminClient(bootstrap_servers='localhost:9092', client_id='diagnose')
        topics = admin.list_topics()
        REPORT['kafka_python_topics'] = list(topics)[:50]
        admin.close()
    except Exception as e:
        REPORT['kafka_python_error'] = str(e)

def main():
    check_env()
    check_java()
    check_ports()
    topics, err = list_topics_native()
    if topics is not None:
        REPORT['native_topics'] = topics
    else:
        REPORT['native_topics_error'] = err
    attempt_kafka_python()
    print(json.dumps(REPORT, indent=2))
    guidance: list[str] = []
    if REPORT.get('KAFKA_HOME') in (None, '<not set>'):
        guidance.append('Set KAFKA_HOME to your Kafka folder (e.g. C:/dev/kafka).')
    missing_files = REPORT.get('missing_kafka_files')
    if isinstance(missing_files, list) and missing_files:
        guidance.append('Kafka distribution incomplete; re-extract the archive.')
    if not REPORT.get('java_found'):
        guidance.append('Install Java (Adoptium Temurin 17) and add to PATH.')
    if not REPORT.get('port_9092_open'):
        guidance.append('Broker not listening on 9092; check broker window for errors.')
    native_err = REPORT.get('native_topics_error')
    if isinstance(native_err, str) and 'Connection refused' in native_err:
        guidance.append('Topics list failed: broker not ready yet or port blocked.')
    if guidance:
        print('\nNEXT ACTIONS:')
        for g in guidance:
            print('-', g)

if __name__ == '__main__':
    main()
