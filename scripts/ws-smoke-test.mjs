// Smoke test: connect to the dyad web server's WS IPC bridge and invoke
// a few real handlers, verifying the envelope protocol end-to-end.
import WebSocket from "ws";

const PORT = process.env.PORT || 3000;
const URL_ = `ws://localhost:${PORT}/__dyad_ipc`;

function invoke(ws, id, channel, args = []) {
  return new Promise((resolve, reject) => {
    const onMessage = (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "result" && msg.id === id) {
          ws.off("message", onMessage);
          if (msg.ok) resolve(msg.payload);
          else reject(new Error(msg.error?.message || "invoke failed"));
        }
      } catch {}
    };
    ws.on("message", onMessage);
    ws.send(JSON.stringify({ v: 1, type: "invoke", id, channel, args }));
  });
}

function unwrap(envelope) {
  if (envelope && typeof envelope === "object" && envelope.__dyadIpcEnvelope) {
    if (envelope.ok) return envelope.value;
    throw new Error(envelope.error?.message || "envelope error");
  }
  return envelope;
}

async function main() {
  const ws = new WebSocket(URL_);
  await new Promise((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
  });
  console.log("WS CONNECTED");

  let id = 0;

  const version = await invoke(ws, ++id, "get-app-version");
  console.log("app-version:", JSON.stringify(unwrap(version)));

  const settings = await invoke(ws, ++id, "get-user-settings");
  const s = unwrap(settings);
  console.log(
    "settings: runtimeMode2=%s selectedModel=%s e2bKey=%s",
    s?.runtimeMode2,
    s?.selectedModel?.name,
    s?.e2bApiKey?.value ? "(set)" : "(unset)",
  );

  const apps = await invoke(ws, ++id, "list-apps");
  console.log("list-apps:", JSON.stringify(unwrap(apps)).slice(0, 200));

  const providers = await invoke(ws, ++id, "get-language-model-providers");
  const provs = unwrap(providers);
  const custom = provs?.filter((p) => p.id === "custom::gateway");
  console.log(
    "providers: %d total, custom::gateway present=%s baseUrl=%s",
    provs?.length,
    custom?.length > 0,
    custom?.[0]?.apiBaseUrl,
  );

  const models = await invoke(ws, ++id, "get-language-models", [
    { providerId: "custom::gateway" },
  ]);
  console.log("custom models:", JSON.stringify(unwrap(models)).slice(0, 300));

  const templates = await invoke(ws, ++id, "get-templates");
  console.log("templates:", JSON.stringify(unwrap(templates)).slice(0, 120));

  // Also verify an event subscription (terminal channel is dynamic).
  ws.send(
    JSON.stringify({ v: 1, type: "send", channel: "first-prompt:commit-creation", args: [{}] }),
  );

  ws.close();
  console.log("SMOKE TEST PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error("SMOKE TEST FAILED:", e.message);
  process.exit(1);
});
