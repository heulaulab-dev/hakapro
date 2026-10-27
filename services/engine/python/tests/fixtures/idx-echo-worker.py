import json
import sys

for line in sys.stdin:
    message = json.loads(line)
    if message.get("op") == "close":
        print(json.dumps({"id": message["id"], "ok": True, "closed": True}), flush=True)
        break
    body = {"path": message["path"], "params": message["params"]} if message.get("op") == "request" else {"data": [{"IndexCode": "IHSG"}]}
    print(json.dumps({"id": message["id"], "result": {"ok": True, "status": 200, "attempts": 1, "body": body}}), flush=True)
