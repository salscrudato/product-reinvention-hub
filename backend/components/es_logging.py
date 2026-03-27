import os
import json
import time
import threading
import logging
from datetime import datetime, timezone
from typing import List, Dict, Any

try:
    from elasticsearch import Elasticsearch, helpers  # type: ignore
except Exception:  # pragma: no cover
    Elasticsearch = None  # type: ignore
    helpers = None  # type: ignore

_ES_CLIENT = None
_ES_LOCK = threading.Lock()
_ES_BUFFER: List[Dict[str, Any]] = []
_ES_LAST_FLUSH = 0.0
_ES_FLUSH_INTERVAL = 2.0  # seconds (can be overridden by ELASTICSEARCH_FLUSH_INTERVAL)
_ES_MAX_BUFFER = 200       # can be overridden by ELASTICSEARCH_MAX_BUFFER
_ES_IMMEDIATE = False      # set true when ELASTICSEARCH_IMMEDIATE_FLUSH=1

def _bool(name: str, default: str = '0') -> bool:
    return os.getenv(name, default).lower() in ('1','true','yes','on')

def _es_enabled() -> bool:
    return _bool('ELASTICSEARCH_ENABLE') and Elasticsearch is not None

def _get_client():
    global _ES_CLIENT
    if _ES_CLIENT is not None:
        return _ES_CLIENT
    if not _es_enabled():
        return None
    # Config variables
    url = os.getenv('ELASTICSEARCH_URL', 'http://localhost:9200')
    user = os.getenv('ELASTICSEARCH_USERNAME') or os.getenv('ELASTICSEARCH_USER')
    pwd = os.getenv('ELASTICSEARCH_PASSWORD')
    ca_cert = os.getenv('ELASTICSEARCH_CA_CERT')
    verify_certs = _bool('ELASTICSEARCH_VERIFY_CERTS', '1')
    timeout = float(os.getenv('ELASTICSEARCH_TIMEOUT', '10'))
    auth = None
    if user and pwd:
        auth = (user, pwd)
    try:
        if Elasticsearch is None:  # library not installed
            return None
        es_kwargs: Dict[str, Any] = {'request_timeout': timeout}
        if auth:
            es_kwargs['basic_auth'] = auth
        if ca_cert and os.path.exists(ca_cert):
            es_kwargs['ca_certs'] = ca_cert
        if not verify_certs:
            es_kwargs['verify_certs'] = False  # type: ignore
        _ES_CLIENT = Elasticsearch(url, **es_kwargs)
    except Exception:
        _ES_CLIENT = None
    return _ES_CLIENT

def _flush(force: bool = False):
    global _ES_BUFFER, _ES_LAST_FLUSH
    if not _es_enabled():
        return
    with _ES_LOCK:
        now = time.time()
        if not force and not _ES_IMMEDIATE and (now - _ES_LAST_FLUSH) < _ES_FLUSH_INTERVAL and len(_ES_BUFFER) < _ES_MAX_BUFFER:
            return
        if not _ES_BUFFER:
            return
        client = _get_client()
        if not client:
            _ES_BUFFER = []
            _ES_LAST_FLUSH = now
            return
        index = os.getenv('ELASTICSEARCH_INDEX', 'snowchat-logs')
        actions = []
        for doc in _ES_BUFFER:
            actions.append({
                "_index": index,
                "_op_type": "index",
                "_source": doc
            })
        try:
            helpers.bulk(client, actions, raise_on_error=False)  # type: ignore
        except Exception:
            # On failure, drop buffer silently to avoid blocking app
            pass
        _ES_BUFFER = []
        _ES_LAST_FLUSH = now

class ElasticsearchLogHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:  # pragma: no cover (network)
        if not _es_enabled():
            return
        try:
            doc = {
                'timestamp': datetime.utcfromtimestamp(record.created).replace(tzinfo=timezone.utc).isoformat(),
                'level': record.levelname,
                'logger': record.name,
                'message': record.getMessage(),
                'module': record.module,
                'funcName': record.funcName,
                'line': record.lineno,
                'thread': record.threadName
            }
            # Capture extra structured attributes
            base_attrs = set(logging.LogRecord('',0,'',0,'',(),None).__dict__.keys())
            for attr, val in record.__dict__.items():
                if attr in base_attrs or attr.startswith('_'):
                    continue
                if attr in ('args', 'message'):
                    continue
                try:
                    json.dumps(val)
                    doc[attr] = val
                except Exception:
                    doc[attr] = str(val)
            with _ES_LOCK:
                _ES_BUFFER.append(doc)
            _flush(force=_ES_IMMEDIATE)
        except Exception:
            # Never raise from logging handler
            pass

def install_elasticsearch_logging(root_logger_names: List[str] | None = None) -> bool:
    """Install the Elasticsearch logging handler.

    Honors env vars:
      ELASTICSEARCH_ENABLE (bool)
      ELASTICSEARCH_URL
      ELASTICSEARCH_USERNAME / ELASTICSEARCH_USER
      ELASTICSEARCH_PASSWORD
      ELASTICSEARCH_CA_CERT
      ELASTICSEARCH_VERIFY_CERTS (default 1)
      ELASTICSEARCH_INDEX (default snowchat-logs)
      ELASTICSEARCH_FLUSH_INTERVAL (seconds)
      ELASTICSEARCH_MAX_BUFFER
      ELASTICSEARCH_IMMEDIATE_FLUSH (bool) -> flush every emit
    """
    global _ES_FLUSH_INTERVAL, _ES_MAX_BUFFER, _ES_IMMEDIATE
    if not _es_enabled():
        return False
    # Apply tunables
    try:
        _ES_FLUSH_INTERVAL = float(os.getenv('ELASTICSEARCH_FLUSH_INTERVAL', str(_ES_FLUSH_INTERVAL)))
    except ValueError:
        pass
    try:
        _ES_MAX_BUFFER = int(os.getenv('ELASTICSEARCH_MAX_BUFFER', str(_ES_MAX_BUFFER)))
    except ValueError:
        pass
    _ES_IMMEDIATE = _bool('ELASTICSEARCH_IMMEDIATE_FLUSH')

    client = _get_client()
    if not client:
        return False
    handler = ElasticsearchLogHandler()
    handler.setLevel(logging.INFO)
    names = root_logger_names or [
        'agentic_orchestrator_auto',
        'agentic_orchestrator_auto.servicenow',
        'agentic_orchestrator_auto.user_context',
        __name__
    ]
    for n in names:
        lg = logging.getLogger(n)
        if not any(isinstance(h, ElasticsearchLogHandler) for h in lg.handlers):
            lg.addHandler(handler)
    logging.getLogger(__name__).info(
        '[es_logging] Elasticsearch log handler installed index=%s immediate=%s interval=%.2fs max_buffer=%d',
        os.getenv('ELASTICSEARCH_INDEX','snowchat-logs'), _ES_IMMEDIATE, _ES_FLUSH_INTERVAL, _ES_MAX_BUFFER
    )
    return True

def search_elastic_logs(query: str, minutes: int = 60, level: str | None = None, size: int = 50) -> Dict[str, Any]:  # pragma: no cover (network)
    """Simple ES log search tool.

    Args:
        query: substring to match in message (case-insensitive)
        minutes: lookback window
        level: optional exact level filter
        size: max hits
    """
    if not _es_enabled():
        return {'error': 'elasticsearch_logging_disabled'}
    client = _get_client()
    if not client:
        return {'error': 'elasticsearch_client_unavailable'}
    index = os.getenv('ELASTICSEARCH_INDEX', 'snowchat-logs')
    now = datetime.utcnow().replace(tzinfo=timezone.utc)
    gte = (now.timestamp() - minutes*60) * 1000
    must: List[Dict[str, Any]] = [
        {"range": {"timestamp": {"gte": gte, "format": "epoch_millis"}}},
        {"match": {"message": {"query": query, "operator": "and"}}}
    ]
    if level:
        must.append({"term": {"level.keyword": level}})
    body = {
        "size": size,
        "sort": [{"timestamp": {"order": "desc"}}],
        "query": {"bool": {"must": must}}
    }
    try:
        resp = client.search(index=index, body=body)  # type: ignore
        hits = [h['_source'] for h in resp.get('hits', {}).get('hits', [])]
        return {'count': len(hits), 'hits': hits, 'index': index, 'query': query, 'minutes': minutes}
    except Exception as e:
        return {'error': str(e), 'index': index}
