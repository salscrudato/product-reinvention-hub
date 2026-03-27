from tinydb import TinyDB
import json
from datetime import datetime, timedelta

db = TinyDB('../state_db.json')
chat = db.table('chat_history')

# Get all messages for snow_admin
msgs = [m for m in chat.all() if m.get('username') == 'snow_admin']

print(f'Total messages: {len(msgs)}')
print('\n' + '='*80)
print('RECENT QUESTIONS AND ANSWERS')
print('='*80)

# Show last 10 messages (5 Q&A pairs)
recent = msgs[-10:]
for i, m in enumerate(recent):
    sender = m.get('sender', 'unknown')
    ts = m.get('timestamp', 0)
    dt = datetime.fromtimestamp(ts).strftime('%Y-%m-%d %H:%M:%S') if ts else 'unknown'
    text = m.get('text', '')
    
    if isinstance(text, dict):
        if sender == 'user':
            q = text.get('text', '')[:300]
            print(f'\n[{dt}] USER ASKED:')
            print(f'  {q}')
        elif sender == 'server':
            ans = text.get('final_answer', '')
            if ans:
                # Show first 500 characters of response
                print(f'[{dt}] SYSTEM RESPONDED:')
                print(f'  {ans[:500]}...')
                print(f'  (Total response: {len(ans)} chars)')
    else:
        print(f'\n[{dt}] {sender.upper()}: {str(text)[:200]}')

print('\n' + '='*80)
print('Checking for workaround/solution related questions...')
print('='*80)

# Look for questions about workarounds, solutions, fix, resolution
keywords = ['workaround', 'solution', 'fix', 'resolve', 'resolution', 'how to', 'pattern']
for m in recent:
    if m.get('sender') == 'user':
        text = m.get('text', {})
        if isinstance(text, dict):
            q = text.get('text', '').lower()
            for kw in keywords:
                if kw in q:
                    print(f'\nFound "{kw}" in question: {text.get("text", "")[:200]}')
                    break
