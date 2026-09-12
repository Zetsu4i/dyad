// MCP supergateway validation — tests stdio→HTTP bridging inside E2B.
// Usage: E2B_API_KEY=... bun scripts/mcp-smoke.mjs
import { Sandbox } from 'e2b';

const key = process.env.E2B_API_KEY;
if (!key) { console.error('E2B_API_KEY required'); process.exit(1); }

const PORT = 8101;

async function main() {
  console.log('1) Creating sandbox...');
  const sbx = await Sandbox.create('base', { apiKey: key, timeoutMs: 5 * 60_000 });

  console.log('2) Starting supergateway (filesystem server)...');
  await sbx.commands.run(
    `setsid nohup npx -y supergateway --stdio "npx -y @modelcontextprotocol/server-filesystem /tmp" --outputTransport streamableHttp --port ${PORT} > /tmp/mcp.log 2>&1 < /dev/null & echo started`,
    { timeoutMs: 60_000 }
  );

  const host = sbx.getHost(PORT);
  console.log('   host:', host);
  const url = `https://${host}/mcp`;
  console.log('3) Waiting for gateway + testing HTTP transport...');
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } }),
        signal: AbortSignal.timeout(8000),
      });
      console.log(`   attempt ${i + 1}: HTTP ${res.status}`);
      if (res.ok) {
        const text = await res.text();
        console.log('   body[0:200]:', text.slice(0, 200));
        // listTools via JSON-RPC
        const res2 = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
          signal: AbortSignal.timeout(8000),
        });
        const t2 = await res2.text();
        console.log('   tools/list[0:300]:', t2.slice(0, 300));
        break;
      }
    } catch (e) {
      console.log(`   attempt ${i + 1}: ${e.message}`);
    }
  }
  console.log('4) gateway log:');
  const log = await sbx.commands.run('cat /tmp/mcp.log | tail -20');
  console.log(log.stdout);
  await sbx.kill();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
