from tinydb import TinyDB

db = TinyDB('state_db.json')
chat = db.table('chat_history')
all_msgs = chat.all()

print(f'Total messages in DB: {len(all_msgs)}')
print(f'\nUnique usernames:')
usernames = set([m.get('username', 'unknown') for m in all_msgs])
for u in sorted(usernames):
    count = len([m for m in all_msgs if m.get('username') == u])
    print(f'  {u}: {count} messages')

print(f'\nLast 3 messages (any user):')
for i, msg in enumerate(all_msgs[-3:], 1):
    print(f'{i}. User: {msg.get("username", "?")} | Sender: {msg.get("sender", "?")} | Time: {msg.get("timestamp", "?")[:19]}')
