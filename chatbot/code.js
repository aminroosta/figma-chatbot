figma.showUI(__html__, { width: 320, height: 200 });

const helpers = {
  notify: (message, options) => figma.notify(message, options),
  serializeNode,
};

function serializeNode(node) {
  if (!node || typeof node !== "object") {
    return null;
  }

  return {
    id: node.id,
    name: node.name,
    type: node.type,
  };
}

function isNode(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.type === "string"
  );
}

function normalizeValue(value, seen) {
  if (value === null || value === undefined) {
    return null;
  }

  const valueType = typeof value;
  if (valueType === "string" || valueType === "number" || valueType === "boolean") {
    return value;
  }

  if (valueType === "bigint") {
    return value.toString();
  }

  if (valueType === "symbol") {
    return value.toString();
  }

  if (valueType === "function") {
    return "[Function]";
  }

  if (isNode(value)) {
    return serializeNode(value);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    return value.map((item) => normalizeValue(item, seen));
  }

  if (value instanceof Map) {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    return Array.from(value.entries()).map(([key, entry]) => [
      normalizeValue(key, seen),
      normalizeValue(entry, seen),
    ]);
  }

  if (value instanceof Set) {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    return Array.from(value.values()).map((entry) => normalizeValue(entry, seen));
  }

  if (valueType === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    const output = {};
    for (const key of Object.keys(value)) {
      output[key] = normalizeValue(value[key], seen);
    }
    return output;
  }

  return String(value);
}

function serializeValue(value) {
  return normalizeValue(value, new WeakSet());
}

function serializeError(error) {
  if (error && typeof error === "object") {
    return {
      name: error.name || "Error",
      message: error.message || String(error),
      stack: error.stack,
    };
  }

  return {
    name: "Error",
    message: String(error),
  };
}

function formatLogArg(arg) {
  if (typeof arg === "string") {
    return arg;
  }

  try {
    const serialized = JSON.stringify(serializeValue(arg));
    return serialized === undefined ? String(arg) : serialized;
  } catch (error) {
    return String(arg);
  }
}

function captureConsole() {
  const logs = [];
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  const wrap = (level) => (...args) => {
    const message = args.map(formatLogArg).join(" ");
    const prefix = level === "log" ? "" : `${level}: `;
    logs.push(`${prefix}${message}`);
    if (original[level]) {
      original[level](...args);
    }
  };

  console.log = wrap("log");
  console.info = wrap("info");
  console.warn = wrap("warn");
  console.error = wrap("error");

  return {
    logs,
    restore: () => {
      console.log = original.log;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}

async function runEval(js) {
  const { logs, restore } = captureConsole();

  try {
    const script = new Function(
      "figma",
      "helpers",
      `"use strict"; return (async ({ figma, helpers }) => { ${js}\n})({ figma, helpers });`
    );
    const result = await script(figma, helpers);
    return {
      ok: true,
      result: serializeValue(result),
      logs,
    };
  } catch (error) {
    return {
      ok: false,
      error: serializeError(error),
      logs,
    };
  } finally {
    restore();
  }
}

function getLabel() {
  const documentName = figma.root?.name || "Untitled";
  const pageName = figma.currentPage?.name || "Page";
  return `${documentName} / ${pageName}`;
}

function sendLabel() {
  figma.ui.postMessage({ type: "label", label: getLabel() });
}

figma.on("currentpagechange", () => {
  sendLabel();
});

figma.ui.onmessage = async (msg) => {
  if (!msg || typeof msg !== "object") {
    return;
  }

  if (msg.type === "label_request" || msg.type === "ui_ready") {
    sendLabel();
    return;
  }

  if (msg.type === "eval_request") {
    const id = msg.id || String(Date.now());
    const js = typeof msg.js === "string" ? msg.js : "";
    const response = await runEval(js);
    figma.ui.postMessage({ type: "eval_response", id, ...response });
  }
};

sendLabel();
