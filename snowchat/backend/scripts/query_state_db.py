from tinydb import TinyDB, Query
import os

DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'state_db.json'))
print('DB_PATH:', DB_PATH)

db = TinyDB(DB_PATH)
chat = db.table('chat_history')
print('Total chat entries:', len(chat))

users = {}
for r in chat:
    u = r.get('username')
    if u is None:
        # check nested text
        t = r.get('text')
        if isinstance(t, dict):
            u = t.get('username')
    users[u] = users.get(u, 0) + 1

print('User counts:')
for k, v in sorted(users.items(), key=lambda x: (str(x[0]) if x[0] is not None else '', -x[1]))[:50]:
    print(' ', repr(k), v)

# Entries for supervis1
User = Query()
res = chat.search(User.username == 'supervis1')
print('\nRecords for supervis1 count:', len(res))
for i, r in enumerate(res, 1):
    print('---', i, '---')
    print(r)
