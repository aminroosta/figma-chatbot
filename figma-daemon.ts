import { appendFileSync, existsSync, unlinkSync, writeFileSync } from "fs";
import type { ServerWebSocket } from "bun";

const WS_HOST = "127.0.0.1";
const WS_PORT = 7017;
const PID_PATH = "/tmp/figma-chatbot.pid";
const LOG_PATH = "/tmp/figma-chatbot.log";
const REQUEST_TIMEOUT_MS = 30_000;

type Role = "figma-ui" | "cli";

type Peer = {
  socket: ServerWebSocket<unknown>;
  role?: Role;
  clientId?: string;
  label?: string;
  connectedAt: number;
};

type PendingRequest = {
  id: string;
  cliSocket: ServerWebSocket<unknown>;
  clientId: string;
  timeout: ReturnType<typeof setTimeout>;
  createdAt: number;
};

const peers = new Map<ServerWebSocket<unknown>, Peer>();
const figmaClients = new Map<string, Peer>();
const pendingRequests = new Map<string, PendingRequest>();
const decoder = new TextDecoder();

function log(message: string) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    appendFileSync(LOG_PATH, line);
  } catch (error) {
    void error;
  }
}

function writePidFile() {
  try {
    writeFileSync(PID_PATH, String(process.pid));
  } catch (error) {
    log(`Failed to write pid file: ${String(error)}`);
  }
}

function removePidFile() {
  try {
    if (existsSync(PID_PATH)) {
      unlinkSync(PID_PATH);
    }
  } catch (error) {
    log(`Failed to remove pid file: ${String(error)}`);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function send(socket: ServerWebSocket<unknown>, payload: Record<string, unknown>) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

function sendHelloAck(socket: ServerWebSocket<unknown>) {
  send(socket, { type: "hello_ack" });
}

function sendEvalResponse(
  socket: ServerWebSocket<unknown>,
  payload: { id: string; ok: boolean; result?: unknown; error?: unknown; logs?: unknown }
) {
  send(socket, {
    type: "eval_response",
    id: payload.id,
    ok: payload.ok,
    result: payload.result,
    error: payload.error,
    logs: payload.logs ?? [],
  });
}

function buildStatusResponse(id: string) {
  return {
    type: "status_response",
    id,
    daemon: {
      pid: process.pid,
      listening: true,
    },
    clients: Array.from(figmaClients.values()).map((client) => ({
      clientId: client.clientId,
      label: client.label ?? "",
    })),
  };
}

function generateRequestId() {
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function resolveTargetClient(requestedId?: string) {
  if (isNonEmptyString(requestedId)) {
    const client = figmaClients.get(requestedId);
    if (!client) {
      return { error: `Unknown clientId: ${requestedId}` };
    }
    return { client };
  }

  const connected = Array.from(figmaClients.values());
  if (connected.length === 0) {
    return { error: "No Figma clients connected" };
  }
  if (connected.length > 1) {
    return { error: "Multiple Figma clients connected; specify clientId" };
  }
  return { client: connected[0] };
}

function cancelPendingForClient(clientId: string, reason: string) {
  for (const [id, pending] of pendingRequests.entries()) {
    if (pending.clientId !== clientId) {
      continue;
    }
    clearTimeout(pending.timeout);
    pendingRequests.delete(id);
    sendEvalResponse(pending.cliSocket, {
      id,
      ok: false,
      error: { name: "Error", message: reason },
      logs: [],
    });
  }
}

function cancelPendingForCli(socket: ServerWebSocket<unknown>) {
  for (const [id, pending] of pendingRequests.entries()) {
    if (pending.cliSocket !== socket) {
      continue;
    }
    clearTimeout(pending.timeout);
    pendingRequests.delete(id);
  }
}

function handleHello(peer: Peer, message: Record<string, unknown>) {
  const role = message.role;
  if (role === "figma-ui") {
    const clientId = message.clientId;
    if (!isNonEmptyString(clientId)) {
      log("hello from figma-ui missing clientId");
      sendHelloAck(peer.socket);
      peer.socket.close(1008, "Missing clientId");
      return;
    }

    const label = isNonEmptyString(message.label) ? message.label : "";
    const existing = figmaClients.get(clientId);
    if (existing && existing.socket !== peer.socket) {
      log(`replacing existing figma client ${clientId}`);
      try {
        existing.socket.close(1000, "Replaced by new client");
      } catch (error) {
        void error;
      }
    }

    peer.role = "figma-ui";
    peer.clientId = clientId;
    peer.label = label;
    figmaClients.set(clientId, peer);
    log(`figma-ui connected ${clientId}`);
    sendHelloAck(peer.socket);
    return;
  }

  if (role === "cli") {
    peer.role = "cli";
    log("cli connected");
    sendHelloAck(peer.socket);
    return;
  }

  log(`hello with unknown role: ${String(role)}`);
  sendHelloAck(peer.socket);
}

function handleClientUpdate(peer: Peer, message: Record<string, unknown>) {
  const clientId = message.clientId;
  if (!isNonEmptyString(clientId)) {
    return;
  }
  const label = isNonEmptyString(message.label) ? message.label : "";
  const client = figmaClients.get(clientId);
  if (client) {
    client.label = label;
  }
  if (peer.role === "figma-ui" && peer.clientId === clientId) {
    peer.label = label;
  }
}

function handleEvalRequest(peer: Peer, message: Record<string, unknown>) {
  if (peer.role && peer.role !== "cli") {
    log("eval_request rejected: non-cli peer");
    return;
  }

  const rawId = message.id;
  const id = isNonEmptyString(rawId)
    ? rawId
    : rawId !== undefined && rawId !== null
      ? String(rawId)
      : generateRequestId();
  const js = isNonEmptyString(message.js) ? message.js : "";
  const requestedId = isNonEmptyString(message.clientId) ? message.clientId : undefined;
  const { client, error } = resolveTargetClient(requestedId);

  if (!client || error) {
    sendEvalResponse(peer.socket, {
      id,
      ok: false,
      error: { name: "Error", message: error ?? "No client available" },
      logs: [],
    });
    return;
  }

  if (pendingRequests.has(id)) {
    sendEvalResponse(peer.socket, {
      id,
      ok: false,
      error: { name: "Error", message: `Duplicate request id: ${id}` },
      logs: [],
    });
    return;
  }

  const timeout = setTimeout(() => {
    const pending = pendingRequests.get(id);
    if (!pending) {
      return;
    }
    pendingRequests.delete(id);
    sendEvalResponse(pending.cliSocket, {
      id,
      ok: false,
      error: {
        name: "TimeoutError",
        message: `Eval timed out after ${REQUEST_TIMEOUT_MS}ms`,
      },
      logs: [],
    });
  }, REQUEST_TIMEOUT_MS);

  pendingRequests.set(id, {
    id,
    cliSocket: peer.socket,
    clientId: client.clientId ?? "",
    timeout,
    createdAt: Date.now(),
  });

  send(client.socket, {
    type: "eval_request",
    id,
    js,
  });
}

function handleEvalResponse(peer: Peer, message: Record<string, unknown>) {
  if (peer.role && peer.role !== "figma-ui") {
    log("eval_response rejected: non-figma peer");
    return;
  }

  const idValue = message.id;
  const id = isNonEmptyString(idValue)
    ? idValue
    : idValue !== undefined && idValue !== null
      ? String(idValue)
      : "";
  if (!id) {
    return;
  }

  const pending = pendingRequests.get(id);
  if (!pending) {
    log(`eval_response with unknown id ${id}`);
    return;
  }

  clearTimeout(pending.timeout);
  pendingRequests.delete(id);

  sendEvalResponse(pending.cliSocket, {
    id,
    ok: Boolean(message.ok),
    result: message.result,
    error: message.error,
    logs: message.logs ?? [],
  });
}

function handleStatusRequest(peer: Peer, message: Record<string, unknown>) {
  const idValue = message.id;
  const id = isNonEmptyString(idValue)
    ? idValue
    : idValue !== undefined && idValue !== null
      ? String(idValue)
      : generateRequestId();
  send(peer.socket, buildStatusResponse(id));
}

function handleMessage(peer: Peer, data: string) {
  let message: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === "object") {
      message = parsed as Record<string, unknown>;
    }
  } catch (error) {
    log(`invalid json from peer: ${String(error)}`);
  }

  if (!message) {
    return;
  }

  const type = message.type;
  if (type === "hello") {
    handleHello(peer, message);
    return;
  }

  if (type === "client_update") {
    handleClientUpdate(peer, message);
    return;
  }

  if (type === "eval_request") {
    handleEvalRequest(peer, message);
    return;
  }

  if (type === "eval_response") {
    handleEvalResponse(peer, message);
    return;
  }

  if (type === "status_request") {
    handleStatusRequest(peer, message);
    return;
  }

  log(`unknown message type: ${String(type)}`);
}

const server = Bun.serve({
  hostname: WS_HOST,
  port: WS_PORT,
  fetch(request, serverInstance) {
    if (serverInstance.upgrade(request)) {
      return;
    }
    return new Response("figma-daemon\n", { status: 200 });
  },
  websocket: {
    open(ws) {
      const peer: Peer = { socket: ws, connectedAt: Date.now() };
      peers.set(ws, peer);
      log(`socket opened (${peers.size} total)`);
    },
    message(ws, message) {
      const peer = peers.get(ws);
      if (!peer) {
        return;
      }
      const text = typeof message === "string" ? message : decoder.decode(message);
      handleMessage(peer, text);
    },
    close(ws) {
      const peer = peers.get(ws);
      peers.delete(ws);
      if (peer?.role === "figma-ui" && peer.clientId) {
        const existing = figmaClients.get(peer.clientId);
        if (existing?.socket === ws) {
          figmaClients.delete(peer.clientId);
          cancelPendingForClient(peer.clientId, "Figma client disconnected");
        }
      }
      if (peer?.role === "cli") {
        cancelPendingForCli(ws);
      }
      log(`socket closed (${peers.size} total)`);
    },
  },
});

writePidFile();
log(`figma-daemon listening on ws://${WS_HOST}:${WS_PORT}`);

function shutdown() {
  log("shutting down figma-daemon");
  try {
    server.stop();
  } catch (error) {
    void error;
  }
  removePidFile();
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});

process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

process.on("exit", () => {
  removePidFile();
});
