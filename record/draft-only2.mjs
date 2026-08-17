/* logic-ab.mjs — 加一項「情境合理」到底有沒有用?同一份劇本、兩個版本的評審各跑 N 次。
   為什麼要跑很多次:同一份劇本同一個評審,判決本來就會飄(這正是這次要量的東西)。 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] || 6);
const CASES = JSON.parse(readFileSync(process.env.CASES || 'cases-logic.json', 'utf8'));
const OLD = readFileSync('critic-old.txt', 'utf8'), NEW = readFileSync('draft-check.txt', 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'ab-')); const port = 9590;
const proc = spawn('google-chrome', [`--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
  '--headless=new', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let ws;
for (let i = 0; i < 100 && !ws; i++) { await new Promise((r) => setTimeout(r, 100));
  try { ws = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch {} }
const sock = new WebSocket(ws); await new Promise((r, j) => { sock.onopen = r; sock.onerror = j; });
let id = 0; const w = new Map();
sock.onmessage = (e) => { const m = JSON.parse(e.data); if (w.has(m.id)) w.get(m.id)(m); };
const send = (m, p, s) => new Promise((r, j) => { const n = ++id;
  w.set(n, (x) => x.error ? j(new Error(m + ':' + x.error.message)) : r(x.result));
  sock.send(JSON.stringify({ id: n, method: m, params: p, sessionId: s })); });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Page.navigate', { url: 'https://yazelin.github.io/line-chat-maker/' }, sessionId);
await new Promise((r) => setTimeout(r, 2500));
const ev = (e) => send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true, timeout: 300000 }, sessionId)
  .then((r) => { if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value; });

const judge = (sys, script) => ev(`(async()=>{
  const res=await fetch('https://lcm-ai-proxy.yazelinj303.workers.dev/chat/completions',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({model:'openai/gpt-oss-120b',temperature:0.3,messages:[
      {role:'system',content:${JSON.stringify(sys)}},{role:'user',content:${JSON.stringify(script)}}]})});
  const d=await res.json();
  const t=((d.choices||[])[0]||{}).message ? d.choices[0].message.content : '';
  try{return {__raw:t.slice(0,260), ...(JSON.parse((t.match(/\\{[\\s\\S]*\\}/)||['null'])[0])||{})};}catch(e){return {__raw:t.slice(0,260)};}
})()`);

const out = {};
for (const c of CASES) {
  for (const [tag, sys] of [['專門問一次', NEW]]) {
    const rows = [];
    for (let i = 0; i < N; i++) rows.push(await judge(sys, c.script));
    const okN = rows.filter((v) => v && v.pass).length; void okN;
    const parsed = rows.filter(Boolean).length;
    // 有沒有拿「草稿」這條規則開罰:看 feedback 提不提草稿,以及 real 是不是被壓到 3 以下
    const judged = rows.filter(Boolean);
    const flagged = judged.filter((v) => v.ok === false).length;
    out[c.name + '｜' + tag] = { 判違規: flagged, n: judged.length,
      speaker: judged.map((v) => v.speaker), self: judged.map((v) => v.self) };
    console.log('  ' + (c.name + '｜' + tag).padEnd(30)
      + '判違規 ' + flagged + '／' + N + '　speaker ' + judged.map((v) => v.speaker).join(',')
      + '　判定的自己 ' + [...new Set(judged.map((v) => v.self))].join('/'));
    if (judged[0]) console.log('      原始回覆:' + String(judged[0].__raw).replace(/\s+/g, ' ').slice(0, 180));
  }
}
writeFileSync('logic-ab.json', JSON.stringify(out, null, 1));
sock.close(); proc.kill(); await new Promise((r) => setTimeout(r, 400));
rmSync(dir, { recursive: true, force: true });
