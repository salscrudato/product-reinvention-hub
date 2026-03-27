# Intelligent Observability: CB → Elastic Stack → SnowChat (DevCopilot)

Purpose
-------
This document defines a pragmatic, demo-ready design to:

- Ingest logs and telemetry (RUM/APM/agent logs) from the `cb` application into a local Elastic Stack (Elasticsearch + APM Server + Kibana).
- Ensure `SnowChat` (the agentic AI platform) can query and interact with those logs for natural-language assisted analysis (DevCopilot features).
- Provide test data and a runnable checklist to demonstrate telematics-based analysis that reduces MTTD/MTTR.

Overview (one-line)
-------------------
Start `cb` so it emits structured logs + APM/RUM; Elasticsearch/APM/Kibana ingest those; SnowChat connects to Elasticsearch to answer natural-language queries about logs and perform guided automated analysis.

Key Goals for the Demo
----------------------
- Show logs and traces in Kibana dashboards (RUM, backend traces).
- Demonstrate conversational analysis of logs using SnowChat (e.g., "Show me all 500s in the payments API in last 24 hours and root causes")
- Provide sample test data and an ingestion script to seed Elasticsearch for repeatable demos.

Assumptions
-----------
- You have local installs under `C:\dev` (Elasticsearch 9.x, Kibana 9.x, APM Server 9.x) as previously referenced in `.env`.
- `cb` can be configured to send structured JSON logs and APM instrumentation (or we can simulate logs if not).
- `snowchat` can reach Elasticsearch over HTTPS/local network and has credentials configured in `backend/.env`.

High-level Architecture (ASCII)
------------------------------
This converts well to SmartArt: central pipeline (cb -> APM/Log ingest -> Elastic -> Kibana + SnowChat)

             +----------------+
             | cb App (Backend)|
             | - Structured    |
             |   JSON logs     |
             | - APM traces    |
             +--------+-------+
                      | logs/traces (OTLP/HTTP/RUM)
          +-----------v-----------+
          |     APM Server        |  (apm-server ingest)
          +-----------+-----------+
                      |
            +---------v----------+
            |  Elasticsearch     |  (indices: apm-*, logs-*, rum-*)
            +----+----+----+-----+
                 |    |    |
                 |    |    +--> Kibana (dashboards, Discover)
                 |    +------> SnowChat (RAG + search via ES queries)
                 +----------> Long-tail storage / backups

Component Details
-----------------

- cb Application
  - Emit structured JSON logs (preferred fields: timestamp, level, service, env, message, trace.id, span.id, http.* headers and route, user.id if relevant).
  - Instrument backend with APM agent (e.g., Elastic APM Node/Java/.NET agent) so traces and spans are captured.
  - Add RUM snippet (Elastic RUM) to frontend to send browser telemetry to APM Server.

- Elastic Stack
  - Elasticsearch: store indexes for logs (`logs-cb-*`), APM (`apm-*`), RUM sessions (`rum-*`).
  - APM Server: receive APM agent data and RUM events, forward to ES.
  - Kibana: dashboards, logs discover, tracing UI.
  - Local paths referenced in repo: `C:\dev\elasticsearch-9.1.4`, `C:\dev\kibana-9.1.4-...`, `C:\dev\apm-server-9.1.4-...`

- SnowChat (DevCopilot integration)
  - Connect to Elasticsearch using credentials in `backend/.env`:
    - `ELASTICSEARCH_ENABLE=1`
    - `ELASTICSEARCH_URL=https://localhost:9200` (or appropriate host)
    - `ELASTICSEARCH_USERNAME=elastic`
    - `ELASTICSEARCH_PASSWORD=...`
    - `ELASTICSEARCH_CA_CERT=C:\dev\elasticsearch-9.1.4\config\certs\http_ca.crt`
  - Add a tool to the SnowChat `FUNCTION_REGISTRY` to query Elasticsearch (e.g., `es_query_tool(query, index, time_range)`).
  - Implement RAG: index saved search results or use ES as the retrieval layer and synthesize with LLM.

Detailed Implementation Steps (developer-friendly)
------------------------------------------------

1) Start Elastic stack locally (PowerShell examples)

```powershell
# Elasticsearch
& 'C:\dev\elasticsearch-9.1.4\bin\elasticsearch.bat'

# APM Server (with RUM enabled)
& 'C:\dev\apm-server-9.1.4-windows-x86_64\apm-server-9.1.4-windows-x86_64\apm-server.exe' -E apm-server.rum.enabled=true

# Kibana
& 'C:\dev\kibana-9.1.4-windows-x86_64\kibana-9.1.4\bin\kibana.bat'
```

2) Configure APM in the `cb` project

- Install and configure Elastic APM agent appropriate to `cb` (Node/Java/.NET). Example (Node):

```js
// at app startup
var apm = require('elastic-apm-node').start({
  serviceName: 'cb-app',
  serverUrl: 'http://localhost:8200',
  serviceVersion: '1.0.0'
})
```

3) Configure `cb` logging

- Use structured JSON logging (e.g., `winston` with `winston.format.json()` for Node).
- Ensure logs include trace id/span id when available. Example JSON log shape:

```json
{
  "@timestamp": "2025-12-17T12:00:00Z",
  "level": "error",
  "service": "cb-payments",
  "env": "dev",
  "message": "Payment processing failed: timeout",
  "http": {"method":"POST","path":"/payments/charge","status_code":504},
  "trace": {"id":"<trace-id>","span_id":"<span-id>"}
}
```

4) Update `snowchat` config

- Edit `backend/.env` in SnowChat (example keys):

```
ELASTICSEARCH_ENABLE=1
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_USERNAME=elastic
ELASTICSEARCH_PASSWORD=changeme
ELASTICSEARCH_INDEX=logs-cb-*
ELASTICSEARCH_CA_CERT=C:\dev\elasticsearch-9.1.4\config\certs\http_ca.crt
```

5) Add an ES query tool to SnowChat

- Example tool skeleton (Python):

```python
from elasticsearch import Elasticsearch
import os

def es_query_tool(query: str, index: str='logs-cb-*', size=100):
    es = Elasticsearch([os.getenv('ELASTICSEARCH_URL')], http_auth=(os.getenv('ELASTICSEARCH_USERNAME'), os.getenv('ELASTICSEARCH_PASSWORD')), ca_certs=os.getenv('ELASTICSEARCH_CA_CERT'))
    resp = es.search(index=index, body={"query": {"query_string": {"query": query}}, "size": size})
    return resp
```

6) Implement natural-language prompts / templates

- Create a prompt template for log analysis in `prompt_catalog.json`:

```json
{
  "id": "log_analysis",
  "persona": "SRE Assistant",
  "template": "You are an SRE assistant. Given these log records and traces: {context}\nAnswer: {question}",
  "enabled": true
}
```

7) Demonstration flows (examples)

- Developer asks: "Show me all errors in the payments service in the last 24 hours"
  - SnowChat `es_query_tool` runs ES query: `service:cb-payments AND level:error AND @timestamp:[now-24h TO now]`
  - SnowChat synthesizes response and suggests likely root causes.

- Developer asks: "Which 5xx errors correlate with slow backend DB calls?"
  - SnowChat runs two queries (logs + APM spans) and correlates trace IDs, returns top causes.

8) Test Data (sample generator)

- Add a small script to seed Elasticsearch with 200 sample log documents and 50 sample APM-like trace documents.
- Minimal Python script (seed_logs.py) example to produce JSON logs to ES using `elasticsearch` client.

Sample seed snippet (conceptual):

```python
from elasticsearch import Elasticsearch
import time, random, uuid
es = Elasticsearch(['http://localhost:9200'])
for i in range(200):
    doc = {
        '@timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'level': random.choice(['info','error','warn'] if random.random()>0.2 else ['error']),
        'service': 'cb-payments',
        'env': 'dev',
        'message': 'Simulated event %d' % i,
        'http': {'method':'POST','path':'/payments/charge','status_code': random.choice([200,500,504,502])},
        'trace': {'id': str(uuid.uuid4())}
    }
    es.index(index='logs-cb-2025.12', document=doc)

```

9) SnowChat RAG approach

- Use ES as retrieval: run a search for top-K logs given an NL query and pass results as context to the LLM.
- Optionally pre-index summary documents (daily rollups) to reduce token cost.

10) Example conversational prompts

- "Summarize the top 3 error patterns in cb-payments for the last 24 hours and propose remediations." 
- "Show traces that include http status 504 and list the slowest spans in those traces." 

Operational Metrics to Highlight in Demo
---------------------------------------
- MTTD: time from first error log to detection (use SnowChat 'alert' flow to detect patterns).
- MTTR: time from detection to proposed remediation (measure time until fix or workaround suggested).
- Query coverage: number of unique NL queries SnowChat can map to ES queries.

Security & Governance
---------------------
- Use role-based API tokens for SnowChat when querying ES; avoid broad access keys in code.
- Mask or exclude PII in logs before indexing; provide a redaction transformer in the ingest pipeline.
- Audit all SnowChat queries and responses (store in `chat_history` table) for compliance.

Presentation tips (2-slide demo)
--------------------------------
- Slide 1: System diagram showing cb → APM → Elastic → Kibana + SnowChat (use the ASCII diagram above as base SmartArt).
- Slide 2: Demo flow with sample queries, a screenshot of Kibana Discover + SnowChat transcript showing a root-cause analysis.

Appendix: Next steps & optional additions
----------------------------------------
- Add automated Kibana dashboards (JSON export) for the demo (RUM overview, error heatmap, traces timeline).
- Add scripted synthetic traffic generator (e.g., `artillery` or `locust`) to produce realistic RUM/APM traces.
- Add an ES ingest pipeline to normalize fields and drop PII before indexing.

Questions for you
------------------
1. Where under `C:\dev` are your Elastic stack installs located? Confirm exact paths for Elasticsearch/Kibana/APM so I can build starter PowerShell scripts.
2. Do you prefer real `cb` traffic or synthetic test traffic (I can provide a synthetic generator)?
3. Will SnowChat have access to the Elastic stack on `localhost` or via a secured network endpoint (TLS + auth)?

Files I can add next (if you want)
---------------------------------
- `scripts/start-observability.ps1` — start Elasticsearch, APM, Kibana and verify health.
- `scripts/seed_es_logs.py` — seed ES with sample logs and traces.
- `backend/components/es_tools.py` — minimal SnowChat tool to query ES and return records to the planner.

---
Created: intelligent_observability.md
