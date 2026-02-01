# changelog format

- step <N>
  - learnings, gotchas, findings, etc.
  - ^ be informative, not prescriptive; information density is the key!

---

- step 1
  - replaced plugin boilerplate with a websocket-driven bridge UI showing connection state, client id, and document label
  - added main-context evaluator with helper surface, console capture, and JSON-safe result/error serialization
  - wired UI/main message flow for eval request/response forwarding and label updates with reconnect backoff
