import requests

BASE = "http://127.0.0.1:5000"
ENDPOINTS = [
    "/generic_tool_orchestrator/function_sequence_feedback",
    "/function_sequence_feedback",
    "/generic_tool_orchestrator/chat_history",
    "/chat_history",
]
HEADERS = {"Origin": "http://localhost:3000", "Content-Type": "application/json"}

for path in ENDPOINTS:
    url = BASE + path
    print(f"\n--- Testing path: {path} ---")
    try:
        r = requests.options(url, headers={"Origin": HEADERS["Origin"]}, timeout=5)
        print("OPTIONS status:", r.status_code)
        print("Access-Control-Allow-Origin:", r.headers.get("Access-Control-Allow-Origin"))
    except Exception as e:
        print("OPTIONS error:", e)

    # If this looks like a feedback endpoint, try POST
    if 'function_sequence_feedback' in path:
        payload = {
            "user_id": "sim-user-1",
            "username": "Sim User",
            "question": "Summary of INC0000001?",
            "liked": True
        }
        try:
            r = requests.post(url, json=payload, headers=HEADERS, timeout=5)
            print("POST status:", r.status_code)
            try:
                print("POST JSON:", r.json())
            except Exception:
                print("POST text:", r.text)
            print("POST headers:\n", r.headers)
        except Exception as e:
            print("POST error:", e)
