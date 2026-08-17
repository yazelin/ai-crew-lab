/* critic-bench.mjs — 拿同一個真評審(CRITIC_SYSTEM + 同一個模型)去評幾份好壞不同的劇本。
   CRITIC_SYSTEM 直接從線上的 ai.js 抽出來,不手抄,人家改了這裡跟著變。
   在頁面裡呼叫,才過得了代理的 Origin 檢查。 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CASES = JSON.parse(readFileSync(process.env.CASES || 'cases.json', 'utf8'));
const dir = mkdtempSync(join(tmpdir(), 'lcm-cb-'));
const port = 9950 + Math.floor(performance.now() % 40);
const proc = spawn('google-chrome', [`--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
  '--headless=new', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let ws;
for (let i = 0; i < 100 && !ws; i++) { await new Promise((r) => setTimeout(r, 100));
  try { ws = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch {} }
const sock = new WebSocket(ws);
await new Promise((r, j) => { sock.onopen = r; sock.onerror = j; });
let id = 0; const w = new Map();
sock.onmessage = (e) => { const m = JSON.parse(e.data); if (w.has(m.id)) w.get(m.id)(m); };
const send = (m, p, s) => new Promise((r, j) => { const n = ++id;
  w.set(n, (x) => x.error ? j(new Error(m + ':' + x.error.message)) : r(x.result));
  sock.send(JSON.stringify({ id: n, method: m, params: p, sessionId: s })); });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Page.navigate', { url: 'https://yazelin.github.io/line-chat-maker/' }, sessionId);
await new Promise((r) => setTimeout(r, 3000));
const ev = (e) => send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true, timeout: 600000 }, sessionId)
  .then((r) => { if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; });

// 從線上 ai.js 抽出真正的 CRITIC_SYSTEM
const CRITIC = await ev(`(async()=>{
  const src = await (await fetch('ai.js')).text();
  const i = src.indexOf('const CRITIC_SYSTEM = \\u0060');
  const j = src.indexOf('\\u0060;', i);
  return src.slice(i + 'const CRITIC_SYSTEM = \\u0060'.length, j);
})()`);
// 想試新版評審:CRITIC_FILE 指到本機檔案,直接覆蓋線上抓來的那份
const OVERRIDE = process.env.CRITIC_FILE ? readFileSync(process.env.CRITIC_FILE, 'utf8') : null;
console.log((OVERRIDE ? '用本機的新版評審，' + OVERRIDE.length : '抓到線上評審 system prompt，' + CRITIC.length) + ' 字\n');

const out = [];
for (const c of CASES) {
  process.stdout.write('  ' + c.name.padEnd(22));
  const r = await ev(`(async()=>{
    const t0 = performance.now();
    const res = await fetch('https://lcm-ai-proxy.yazelinj303.workers.dev/chat/completions', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ model:'openai/gpt-oss-120b', temperature:0.3, messages:[
        {role:'system',content:${JSON.stringify(OVERRIDE || CRITIC)}},
        {role:'user',content:${JSON.stringify(c.script)}}]})});
    const d = await res.json();
    const text = ((d.choices||[])[0]||{}).message ? d.choices[0].message.content : JSON.stringify(d).slice(0,400);
    return { ms: Math.round(performance.now()-t0), status: res.status, text };
  })()`);
  let verdict = null;
  try { verdict = JSON.parse((r.text.match(/\{[\s\S]*\}/) || ['{}'])[0]); } catch (e) {}
  out.push({ ...c, raw: r.text, verdict, ms: r.ms });
  const s = verdict && verdict.scores || {};
  const keys = verdict && verdict.scores ? Object.keys(verdict.scores) : [];
  console.log((verdict ? (verdict.pass ? '通過 ' : '退件 ') + verdict.total + '  ' +
    keys.map(k=>k+' '+s[k]).join(' ') : '解析失敗') + '  ' + r.ms + 'ms');
}
writeFileSync(process.env.OUT || 'critic-bench.json', JSON.stringify({ critic: CRITIC, cases: out }, null, 1));
console.log('\n→ critic-bench.json');
sock.close(); proc.kill(); await new Promise((r) => setTimeout(r, 500));
rmSync(dir, { recursive: true, force: true });
