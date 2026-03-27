#!/usr/bin/env python
"""Repair tool for a potentially corrupted TinyDB JSON file (state_db.json).

Symptoms handled:
  - 'Extra data' JSONDecodeError due to multiple concatenated JSON objects
  - Truncated JSON (missing closing braces)

Strategy:
 1. Read entire file.
 2. Attempt direct json.loads(). If success -> report healthy.
 3. If failure with 'Extra data', iteratively try to find a salvage point by scanning for last complete JSON object boundary (counting braces) *or* splitting when multiple JSON roots are concatenated.
 4. If failure with 'Unterminated' or similar, truncate at last full brace-balanced position.
 5. Write repaired content to either a new output path (default: state_db.repaired.json) unless --in-place is given.
 6. Always back up the original file with timestamp if doing in-place.

Usage (PowerShell):
  python backend/repair_state_db.py --path backend/state_db.json
  python backend/repair_state_db.py --path backend/state_db.json --in-place

Exit codes:
  0 success (healthy or repaired)
  1 unrecoverable
"""
from __future__ import annotations
import argparse, json, time, os, sys
from typing import Tuple


def load_raw(path: str) -> str:
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def try_parse(data: str):
    return json.loads(data)


def brace_balance_salvage(data: str) -> Tuple[bool, str, str]:
    """Attempt to salvage by finding a position where braces balance.
    Returns (success, repaired_json, reason)."""
    balance = 0
    last_good_index = -1
    in_string = False
    escape = False
    for i, ch in enumerate(data):
        if in_string:
            if escape:
                escape = False
            elif ch == '\\':
                escape = True
            elif ch == '"':
                in_string = False
        else:
            if ch == '"':
                in_string = True
            elif ch == '{':
                balance += 1
            elif ch == '}':
                balance -= 1
                if balance == 0:
                    last_good_index = i
        if balance < 0:
            break
    if last_good_index != -1:
        candidate = data[: last_good_index + 1]
        try:
            try_parse(candidate)
            return True, candidate, 'Truncated at last balanced brace'
        except Exception as e:
            return False, '', f'Balanced brace candidate failed to parse: {e}'
    return False, '', 'No balanced brace point found'


def split_concatenated_json(data: str) -> Tuple[bool, str, str]:
    """If multiple JSON objects are concatenated, keep only the first valid one."""
    # Heuristic: find first object that parses by scanning for balanced brace and try parse
    balance = 0
    start = None
    for i, ch in enumerate(data):
        if ch == '{' and start is None:
            start = i
            balance = 1
            continue
        if start is not None:
            if ch == '{':
                balance += 1
            elif ch == '}':
                balance -= 1
                if balance == 0:
                    candidate = data[start:i+1]
                    try:
                        try_parse(candidate)
                        return True, candidate, 'Extracted first JSON object from concatenated stream'
                    except Exception:
                        # continue searching
                        pass
    return False, '', 'Could not isolate first JSON object'


def repair(data: str) -> Tuple[bool, str, str]:
    # Direct parse first
    try:
        try_parse(data)
        return True, data, 'Already valid'
    except json.JSONDecodeError as e:
        msg = str(e)
        if 'Extra data' in msg:
            ok, repaired, reason = split_concatenated_json(data)
            if ok:
                return True, repaired, reason
            # fallback to brace balance salvage
            ok2, repaired2, reason2 = brace_balance_salvage(data)
            if ok2:
                return True, repaired2, reason + ' + ' + reason2
            return False, '', 'Could not salvage concatenated JSON'
        else:
            # Possibly truncated
            ok, repaired, reason = brace_balance_salvage(data)
            if ok:
                return True, repaired, reason
            return False, '', f'Unhandled JSON error: {e}'
    except Exception as e:
        return False, '', f'Unknown parse failure: {e}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--path', default='backend/state_db.json', help='Path to TinyDB JSON file')
    ap.add_argument('--out', default=None, help='Output file (default: <orig>.repaired.json)')
    ap.add_argument('--in-place', action='store_true', help='Overwrite the original (backs up first)')
    args = ap.parse_args()

    path = args.path
    if not os.path.exists(path):
        print(f'[repair] File not found: {path}', file=sys.stderr)
        sys.exit(1)

    raw = load_raw(path)
    ok, repaired, reason = repair(raw)
    if not ok:
        print(f'[repair] FAILED to repair: {reason}', file=sys.stderr)
        sys.exit(1)

    if args.in_place:
        ts = int(time.time())
        backup = f'{path}.bak.{ts}'
        with open(backup, 'w', encoding='utf-8') as bf:
            bf.write(raw)
        with open(path, 'w', encoding='utf-8') as outf:
            outf.write(repaired)
        print(f'[repair] SUCCESS (in-place). Backup: {backup}. Reason: {reason}')
    else:
        out = args.out or (path + '.repaired.json')
        with open(out, 'w', encoding='utf-8') as outf:
            outf.write(repaired)
        print(f'[repair] SUCCESS. Wrote repaired file: {out}. Reason: {reason}')

if __name__ == '__main__':
    main()
