from components.langgraph_flow import process_question_with_prompt_and_metadata
from tinydb import TinyDB
import json, time

messages = [
    {"role":"user","content":"Can you please tell me the short description for the incident numbered INC0000001?"},
    {"role":"assistant","content":"The short description for incident number INC0000001 is: \"Unable to Quote for Auto Insurance in NJ due to missing  Underinsured Motorist Coverage limits\"."},
    {"role":"user","content":"Great, what are other similar incidents like this one?"}
]

# Insert the first two messages into the TinyDB chat_history table for the username so
# the planner's canonical-extraction can find the referenced incident.
db = TinyDB("state_db.json")
chat_table = db.table("chat_history")
# Remove existing entries for this username to keep the test deterministic
chat_table.remove(lambda r: r.get('username') == 'Super User')
ts = int(time.time())
chat_table.insert({"username": "Super User", "sender": "user", "text": messages[0]["content"], "timestamp": ts})
chat_table.insert({"username": "Super User", "sender": "server", "text": messages[1]["content"], "timestamp": ts + 1})

res = process_question_with_prompt_and_metadata(messages[-1]['content'], prompt='', metadata={}, username='Super User')
print(json.dumps(res, indent=2, default=str))
