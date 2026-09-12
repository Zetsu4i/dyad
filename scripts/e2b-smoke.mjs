// E2B smoke test — validates the exact APIs our app will rely on.
// Usage: E2B_API_KEY=e2b_... bun scripts/e2b-smoke.mjs
import { Sandbox } from 'e2b';

const key = process.env.E2B_API_KEY;
if (!key) { console.error('E2B_API_KEY env var required'); process.exit(1); }

async function main() {
  console.log('1) Creating sandbox (template: base)...');
  const sbx = await Sandbox.create('base', {
    apiKey: key,
    timeoutMs: 5 * 60_000,
  });
  console.log('   sandboxId:', sbx.sandboxId ?? sbx.id ?? '(unknown)');

  console.log('2) node/npm versions...');
  const v = await sbx.commands.run('node --version && npm --version && which npx');
  console.log('   ', v.stdout.trim().replace(/\n/g, ' | '), 'exit:', v.exitCode);

  console.log('3) file ops...');
  await sbx.files.makeDirs?.('/app/test');
  await sbx.files.write('/app/test/hello.txt', 'hello forge');
  const content = await sbx.files.read('/app/test/hello.txt');
  console.log('   read back:', String(content).trim());
  const entries = await sbx.files.list('/app/test');
  console.log('   list:', entries.map(e => `${e.name}(${e.type})`).join(', '));

  console.log('4) background process + hostname...');
  const handle = await sbx.commands.run(
    'cd /app/test && npx -y http-server -p 5173 -s',
    { background: true }
  );
  await new Promise(r => setTimeout(r, 8000)); // let http-server install+start
  const host = sbx.getHost(5173);
  console.log('   getHost(5173) =', host);
  const url = `https://${host}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const body = await res.text();
    console.log(`   fetch ${url} -> ${res.status}, body[0:60]=${body.slice(0, 60)}`);
  } catch (e) {
    console.log('   fetch FAILED:', e.message);
  }
  const ps = await sbx.commands.list?.();
  console.log('   running commands:', ps?.length ?? 'n/a');

  console.log('5) kill + pause...');
  await handle.kill();
  try {
    await sbx.pause();
    console.log('   paused OK');
  } catch (e) {
    console.log('   pause FAILED:', e.message);
  }

  console.log('6) resume via connect...');
  const sid = sbx.sandboxId ?? sbx.id;
  try {
    const sbx2 = await Sandbox.connect(sid, { apiKey: key, timeoutMs: 5 * 60_000 });
    const check = await sbx2.commands.run('cat /app/test/hello.txt');
    console.log('   resumed, file persisted:', check.stdout.trim());
    const isRunning = await sbx2.isRunning?.();
    console.log('   isRunning:', isRunning);
    console.log('7) snapshot + restore...');
    const snap = await sbx2.createSnapshot();
    console.log('   snapshotId:', snap.snapshotId);
    await sbx2.kill();
    const sbx3 = await Sandbox.create(snap.snapshotId, { apiKey: key, timeoutMs: 5 * 60_000 });
    const check3 = await sbx3.commands.run('cat /app/test/hello.txt');
    console.log('   from snapshot, file persisted:', check3.stdout.trim());
    await sbx3.kill();
  } catch (e) {
    console.log('   resume/snapshot FAILED:', e.message);
    try { await sbx.kill(); } catch {}
  }
  console.log('DONE');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
