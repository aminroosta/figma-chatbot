#!/usr/bin/env bun
import { existsSync, readFileSync, unlinkSync } from "fs";
import { fileURLToPath } from "url";

const WS_URL = "ws://127.0.0.1:7017/";
const PID_PATH = "/tmp/figma-chatbot.pid";
const DEFAULT_STATUS_TIMEOUT = 800;
const DEFAULT_START_TIMEOUT = 2000;
const DEFAULT_EVAL_TIMEOUT = 35_000;
const decoder = new TextDecoder();

type ClientInfo = {
  clientId: string;
  label?: string;
};

type StatusPayload = {
  daemon: {
    pid: number | null;
    listening: boolean;
  };
  clients: ClientInfo[];
};

type EvalResult = {
  ok: boolean;
  result?: unknown;
  error?: { name: string; message: string; stack?: string };
  logs?: unknown[];
};

function printJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function printUsage() {
  const usage = [
    "Usage:",
    "  figma.ts status",
    "  figma.ts start",
    "  figma.ts restart",
    "  figma.ts stop",
    "  figma.ts eval [--client <id|index>]",
  ].join("\n");
  process.stderr.write(`${usage}\n`);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseJson(data: unknown): Record<string, unknown> | null {
  if (data === undefined || data === null) {
    return null;
  }

  let text = "";
  if (typeof data === "string") {
    text = data;
  } else if (data instanceof ArrayBuffer) {
    text = decoder.decode(data);
  } else if (ArrayBuffer.isView(data)) {
    text = decoder.decode(data);
  } else {
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    void error;
  }
  return null;
}

function readPidFile() {
  if (!existsSync(PID_PATH)) {
    return null;
  }
  const raw = readFileSync(PID_PATH, "utf8").trim();
  const pid = Number.parseInt(raw, 10);
  return Number.isFinite(pid) ? pid : null;
}

function removePidFile() {
  try {
    if (existsSync(PID_PATH)) {
      unlinkSync(PID_PATH);
    }
  } catch (error) {
    void error;
  }
}

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    void error;
    return false;
  }
}

function normalizeClients(value: unknown): ClientInfo[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const clientId = (entry as { clientId?: unknown }).clientId;
      const label = (entry as { label?: unknown }).label;
      if (!isNonEmptyString(clientId)) {
        return null;
      }
      return {
        clientId,
        label: isNonEmptyString(label) ? label : undefined,
      };
    })
    .filter((entry): entry is ClientInfo => Boolean(entry));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeStatusPayload(pid: number | null, listening: boolean, clients: ClientInfo[]) {
  return {
    daemon: {
      pid: pid ?? null,
      listening,
    },
    clients,
  } satisfies StatusPayload;
}

async function requestStatus(timeoutMs: number): Promise<StatusPayload> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const requestId = `status-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        ws.close();
      } catch (error) {
        void error;
      }
      reject(new Error("status request timed out"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("close", onClose);
      try {
        ws.close();
      } catch (error) {
        void error;
      }
    };

    const onOpen = () => {
      ws.send(JSON.stringify({ type: "hello", role: "cli" }));
      ws.send(JSON.stringify({ type: "status_request", id: requestId }));
    };

    const onMessage = (event: MessageEvent) => {
      const payload = parseJson(event.data);
      if (!payload || payload.type !== "status_response") {
        return;
      }
      if (payload.id !== requestId) {
        return;
      }

      if (!settled) {
        settled = true;
        cleanup();
        const daemon = payload.daemon as { pid?: unknown; listening?: unknown } | undefined;
        const pid = typeof daemon?.pid === "number" ? daemon.pid : null;
        const listening = daemon?.listening === false ? false : true;
        const clients = normalizeClients(payload.clients);
        resolve(makeStatusPayload(pid, listening, clients));
      }
    };

    const onError = () => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error("status request failed"));
      }
    };

    const onClose = () => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error("status socket closed"));
      }
    };

    ws.addEventListener("open", onOpen);
    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);
  });
}

async function getStatus() {
  const pid = readPidFile();
  if (!pid) {
    return makeStatusPayload(null, false, []);
  }

  if (!isProcessRunning(pid)) {
    removePidFile();
    return makeStatusPayload(null, false, []);
  }

  try {
    const response = await requestStatus(DEFAULT_STATUS_TIMEOUT);
    return makeStatusPayload(response.daemon.pid ?? pid, response.daemon.listening, response.clients);
  } catch (error) {
    void error;
    return makeStatusPayload(pid, false, []);
  }
}

function getDaemonPath() {
  return fileURLToPath(new URL("./figma-daemon.ts", import.meta.url));
}

async function waitForDaemonReady() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < DEFAULT_START_TIMEOUT) {
    try {
      const status = await requestStatus(400);
      if (status.daemon.listening) {
        return status;
      }
    } catch (error) {
      void error;
    }
    await delay(100);
  }
  throw new Error("daemon did not start");
}

async function startDaemon() {
  const daemonPath = getDaemonPath();
  if (!existsSync(daemonPath)) {
    throw new Error(`missing daemon at ${daemonPath}`);
  }
  const bunBinary = process.execPath || "bun";
  const child = Bun.spawn([bunBinary, daemonPath], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    detached: true,
  });
  if (typeof child.unref === "function") {
    child.unref();
  }
  return await waitForDaemonReady();
}

async function stopDaemon() {
  const pid = readPidFile();
  if (!pid) {
    return;
  }
  if (!isProcessRunning(pid)) {
    removePidFile();
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    void error;
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < 2000) {
    if (!isProcessRunning(pid)) {
      break;
    }
    await delay(50);
  }
  removePidFile();
}

async function ensureDaemonRunning() {
  const pid = readPidFile();
  if (pid && isProcessRunning(pid)) {
    try {
      const status = await requestStatus(DEFAULT_STATUS_TIMEOUT);
      if (status.daemon.listening) {
        return status;
      }
    } catch (error) {
      void error;
    }
    await stopDaemon();
  } else if (pid) {
    removePidFile();
  }
  return await startDaemon();
}

function resolveClient(clients: ClientInfo[], requested?: string | null) {
  if (!clients.length) {
    return { error: "No Figma clients connected" };
  }
  if (!requested) {
    if (clients.length > 1) {
      return { error: "Multiple Figma clients connected; use --client <id|index>" };
    }
    return { clientId: clients[0].clientId };
  }

  if (/^\d+$/.test(requested)) {
    const index = Number.parseInt(requested, 10);
    if (Number.isNaN(index) || index < 0 || index >= clients.length) {
      return {
        error: `Client index out of range (0-${clients.length - 1})`,
      };
    }
    return { clientId: clients[index].clientId };
  }

  const matched = clients.find((client) => client.clientId === requested);
  if (!matched) {
    return { error: `Unknown clientId: ${requested}` };
  }
  return { clientId: matched.clientId };
}

async function readStdin() {
  try {
    return await new Response(Bun.stdin).text();
  } catch (error) {
    void error;
    return "";
  }
}

async function runEval(js: string, requestedClient?: string | null): Promise<EvalResult> {
  const status = await ensureDaemonRunning();
  const initialSelection = resolveClient(status.clients, requestedClient);
  if (initialSelection.error) {
    return {
      ok: false,
      error: { name: "Error", message: initialSelection.error },
      logs: [],
    };
  }

  return await new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    const statusId = `status-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const evalId = `eval-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let settled = false;
    let clientId: string | undefined = initialSelection.clientId;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve({
        ok: false,
        error: { name: "TimeoutError", message: "Eval request timed out" },
        logs: [],
      });
    }, DEFAULT_EVAL_TIMEOUT);

    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("close", onClose);
      try {
        ws.close();
      } catch (error) {
        void error;
      }
    };

    const sendEvalRequest = () => {
      if (!clientId) {
        settled = true;
        cleanup();
        resolve({
          ok: false,
          error: { name: "Error", message: "No target client available" },
          logs: [],
        });
        return;
      }
      ws.send(
        JSON.stringify({
          type: "eval_request",
          id: evalId,
          clientId,
          js,
        })
      );
    };

    const onOpen = () => {
      ws.send(JSON.stringify({ type: "hello", role: "cli" }));
      ws.send(JSON.stringify({ type: "status_request", id: statusId }));
    };

    const onMessage = (event: MessageEvent) => {
      const payload = parseJson(event.data);
      if (!payload) {
        return;
      }

      if (payload.type === "status_response" && payload.id === statusId) {
        const clients = normalizeClients(payload.clients);
        const selection = resolveClient(clients, requestedClient ?? null);
        if (selection.error) {
          if (!settled) {
            settled = true;
            cleanup();
            resolve({
              ok: false,
              error: { name: "Error", message: selection.error },
              logs: [],
            });
          }
          return;
        }
        clientId = selection.clientId;
        sendEvalRequest();
        return;
      }

      if (payload.type === "eval_response" && payload.id === evalId) {
        if (!settled) {
          settled = true;
          cleanup();
          resolve({
            ok: Boolean(payload.ok),
            result: payload.result,
            error: payload.error as EvalResult["error"],
            logs: Array.isArray(payload.logs) ? payload.logs : [],
          });
        }
      }
    };

    const onError = () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve({
          ok: false,
          error: { name: "Error", message: "Eval socket error" },
          logs: [],
        });
      }
    };

    const onClose = () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve({
          ok: false,
          error: { name: "Error", message: "Eval socket closed" },
          logs: [],
        });
      }
    };

    ws.addEventListener("open", onOpen);
    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);
  });
}

function parseEvalArgs(args: string[]) {
  let client: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--client") {
      const value = args[i + 1];
      if (value) {
        client = value;
        i += 1;
      }
      continue;
    }
    if (arg.startsWith("--client=")) {
      client = arg.slice("--client=".length);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return { help: true, client };
    }
    return { help: false, client, error: `Unknown argument: ${arg}` };
  }
  return { help: false, client };
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (command === "status") {
    const status = await getStatus();
    printJson(status);
    return;
  }

  if (command === "start") {
    try {
      await ensureDaemonRunning();
      const status = await getStatus();
      printJson(status);
    } catch (error) {
      process.stderr.write(`${String(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (command === "restart") {
    try {
      await stopDaemon();
      await ensureDaemonRunning();
      const status = await getStatus();
      printJson(status);
    } catch (error) {
      process.stderr.write(`${String(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (command === "stop") {
    await stopDaemon();
    const status = await getStatus();
    printJson(status);
    return;
  }

  if (command === "eval") {
    const parsed = parseEvalArgs(args.slice(1));
    if (parsed.help) {
      printUsage();
      return;
    }
    if (parsed.error) {
      process.stderr.write(`${parsed.error}\n`);
      process.exitCode = 1;
      return;
    }
    const js = await readStdin();
    const result = await runEval(js, parsed.client);
    printJson({
      ok: result.ok,
      result: result.result,
      error: result.error,
      logs: result.logs ?? [],
    });
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  printUsage();
  process.exitCode = 1;
}

await main();
