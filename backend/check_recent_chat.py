from tinydb import TinyDB
import json
import os

# Use the correct path - go up one level to snowchat root
db_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'state_db.json'))
print(f'Using database: {db_path}')
print(f'Database exists: {os.path.exists(db_path)}')
print()

db = TinyDB(db_path)
chat = db.table('chat_history')

# Get all messages for snow_admin
msgs = chat.search(lambda doc: doc.get('username') == 'snow_admin')
print(f'Total messages for snow_admin: {len(msgs)}')
print('\n' + '='*80)
print('LAST 6 MESSAGES:')
print('='*80)

recent = msgs[-6:]
for i, m in enumerate(recent):
    sender = m.get('sender', 'unknown')
    text = m.get('text', '')
    
    # Handle dict or string text
    if isinstance(text, dict):
        text_preview = json.dumps(text, indent=2)[:200]
    else:
        text_preview = str(text)[:200]
    
    print(f'\n{i+1}. [{sender.upper()}]')
    print(f'   Text preview: {text_preview}')
    if len(str(text)) > 200:
        print(f'   ... (total {len(str(text))} chars)')
    print()
