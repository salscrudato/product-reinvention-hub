import json
import glob
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, Any, List

LOG_FILES = ["agentic_orchestrator_auto.log", "agentic_orchestrator.log"]

# Simple heuristic: scan log lines containing 'Final result:' and parse JSON tail

def extract_results() -> List[Dict[str, Any]]:
    results = []
    for path in LOG_FILES:
        try:
            with open(path, 'r', encoding='utf-8') as f:
                for line in f:
                    if 'Final result:' in line:
                        # JSON starts after first '{'
                        idx = line.find('{')
                        if idx != -1:
                            js = line[idx:].strip()
                            try:
                                results.append(json.loads(js))
                            except Exception:
                                pass
        except FileNotFoundError:
            continue
    return results


@dataclass
class PersonaStats:
    count: int = 0
    tool_calls: int = 0
    unique_tools: set[str] = field(default_factory=set)
    errors: int = 0
    latencies_ms: List[float] = field(default_factory=list)


def summarize(results: List[Dict[str, Any]]):
    persona_stats: Dict[str, PersonaStats] = defaultdict(PersonaStats)
    for r in results:
        persona = (r.get('metadata') or {}).get('persona', 'unknown')
        traces = r.get('traces', [])
        ps = persona_stats[persona]
        ps.count += 1
        for t in traces:
            ps.tool_calls += 1
            tool_name = t.get('tool')
            if tool_name:
                ps.unique_tools.add(tool_name)
            if t.get('status') == 'error' or t.get('error'):
                ps.errors += 1
            if 'start_time' in t and 'end_time' in t:
                try:
                    ps.latencies_ms.append(round((t['end_time'] - t['start_time']) * 1000, 2))
                except Exception:
                    pass
    report: List[Dict[str, Any]] = []
    for persona, data in persona_stats.items():
        unique_tool_count = len(data.unique_tools)
        avg_latency = round(sum(data.latencies_ms) / len(data.latencies_ms), 2) if data.latencies_ms else 0
        error_rate = round(data.errors / data.tool_calls, 3) if data.tool_calls else 0
        report.append({
            'persona': persona,
            'runs': data.count,
            'tool_calls': data.tool_calls,
            'unique_tools': unique_tool_count,
            'error_rate': error_rate,
            'avg_tool_latency_ms': avg_latency,
            'tools': sorted(list(data.unique_tools))
        })
    return report


def main():
    results = extract_results()
    report = summarize(results)
    print("Persona Metrics Summary ({} sessions)".format(len(results)))
    for row in report:
        print(json.dumps(row, indent=2))

if __name__ == '__main__':
    main()
