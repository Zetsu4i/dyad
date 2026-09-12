// MCP SDK client test against a live supergateway in an E2B sandbox.
// Usage: E2B_API_KEY=... bun scripts/mcp-sdk-test.mjs
import { Sandbox } from 'e2b';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const key = process.env.E2B_API_KEY;

async function main() {
  const sbx = await Sandbox.create('base', { apiKey: key, timeoutMs: 5 * 60_000 });
  await sbx.commands.run(
    `setsid nohup npx -y supergateway --stdio "npx -y @modelcontextprotocol/server-filesystem /tmp" --outputTransport streamableHttp --port 8101 > /tmp/mcp.log 2>&1 < /dev/null & echo started`,
    { timeoutMs: 60_000 }
  );
  const host = sbx.getHost(8101);

  // wait for gateway
  await new Promise((r) => setTimeout(r, 12000));

  console.log('A) StreamableHTTPClientTransport...');
  try {
    const client = new Client({ name: 'forge-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`https://${host}/mcp`), {
      requestInit: { headers: { Accept: 'application/json, text/event-stream' } },
    });
    await client.connect(transport, { timeout: 20000 });
    const res = await client.listTools();
    console.log('   CONNECTED — tools:', res.tools?.length, res.tools?.slice(0, 3).map((t) => t.name));
    await client.close();
  } catch (e) {
    console.log('   FAILED:', e.message?.slice(0, 200));
    console.log('B) SSEClientTransport fallback...');
    try {
      const client = new Client({ name: 'forge-test', version: '1.0.0' });
      const transport = new SSEClientTransport(new URL(`https://${host}/sse`));
      await client.connect(transport, { timeout: 20000 });
      const res = await client.listTools();
      console.log('   CONNECTED (SSE) — tools:', res.tools?.length);
      await client.close();
    } catch (e2) {
      console.log('   SSE FAILED:', e2.message?.slice(0, 200));
      const log = await sbx.commands.run('tail -5 /tmp/mcp.log');
      console.log('gateway log:', log.stdout);
    }
  }
  await sbx.kill();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
