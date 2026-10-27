import json
import sys

for line in sys.stdin:
    message = json.loads(line)
    if message.get("op") == "close":
        print(json.dumps({"id": message["id"], "ok": True, "closed": True}), flush=True)
        break
    print(json.dumps({"id": message["id"], "result": {"ok": True, "status": 200, "attempts": 1, "body": {"data": [{"IndexCode": "IHSG"}]}}}), flush=True)
