/* record.mjs — 錄一次真實的 line-chat-maker AI 跑程。
   做法:攔截 fetch(在頁面腳本執行之前注入),把每一次對代理的請求與回應原樣存下來。
   不改 line-chat-maker 一行程式碼 —— 錄到的就是使用者真的會遇到的東西。
   跑法:node record.mjs "劇情主題" 輸出檔名 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOPIC = process.argv[2] || '情侶吵架和好';
const OUT = process.argv[3] || 'run.json';
const PAGE = 'https://yazelin.github.io/line-chat-maker/';

const dir = mkdtempSync(join(tmpdir(), 'lcm-rec-'));
const port = 9900 + Math.floor(performance.now() % 90);
const proc = spawn('google-chrome', [`--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let ws;
for (let i = 0; i < 100 && !ws; i++) { await new Promise((r) => setTimeout(r, 100));
  try { ws = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch {} }
const sock = new WebSocket(ws);
await new Promise((r, j) => { sock.onopen = r; sock.onerror = j; });
let id = 0; const w = new Map();
sock.onmessage = (e) => { const m = JSON.parse(e.data); if (w.has(m.id)) w.get(m.id)(m); };
const send = (m, p, s) => new Promise((r, j) => {
  const n = ++id; w.set(n, (x) => x.error ? j(new Error(m + ':' + x.error.message)) : r(x.result));
  sock.send(JSON.stringify({ id: n, method: m, params: p, sessionId: s }));
});
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);

// 在頁面任何腳本之前掛上 fetch 攔截器
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__rec = [];
  const _f = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const started = performance.now();
    const body = init && init.body ? String(init.body) : null;
    const res = await _f.apply(this, arguments);
    if (/lcm-ai-proxy|generativelanguage|\\/chat\\/completions|\\/images\\//.test(url)) {
      try {
        const clone = res.clone();
        const text = await clone.text();
        window.__rec.push({ url, method: (init && init.method) || 'GET', status: res.status,
          ms: Math.round(performance.now() - started), req: body, res: text.slice(0, 400000) });
      } catch (e) { window.__rec.push({ url, err: String(e) }); }
    }
    return res;
  };
  // 頁面上的 log 也一起錄:那是使用者真的看到的字
  window.__logs = [];
` }, sessionId);

await send('Page.navigate', { url: PAGE }, sessionId);
await new Promise((r) => setTimeout(r, 3500));
const ev = (e) => send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true, timeout: 900000 }, sessionId)
  .then((r) => { if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; });

// 觀察 #ai-log 的變化,把使用者看得到的每一行也錄下來
await ev(`(()=>{const box=document.querySelector('#ai-log');
  new MutationObserver(()=>{window.__logs=[...box.querySelectorAll('*')].map(e=>e.className+'|'+e.textContent).slice(-400);})
    .observe(box,{childList:true,subtree:true,characterData:true});return 1})()`);

console.log('主題：' + TOPIC);
// 從空白草稿開始:不然人物會沿用示範草稿的頭像,補圖就不會生大頭貼
if (process.env.FRESH === '1') {
  await ev(`(async()=>{const b=document.querySelector('#ai-new-draft');
    if(b){b.click(); await new Promise(r=>setTimeout(r,1200));} return 1})()`);
  console.log('（已開新草稿）');
}
await ev(`(()=>{document.querySelector('#ai-prompt').value=${JSON.stringify(TOPIC)};
  document.querySelector('#ai-screenplay-text').value='';return 1})()`);

console.log('▶ 劇本強化（編劇 → 評審迴圈）…');
const t0 = Date.now();
await ev(`(async()=>{document.querySelector('#ai-enhance').click();
  for(let i=0;i<180;i++){await new Promise(r=>setTimeout(r,1000));
    if(!document.querySelector('#ai-enhance').disabled) return 1}
  return 0})()`);
console.log('  完成，' + ((Date.now() - t0) / 1000).toFixed(0) + ' 秒');

console.log('▶ 開始製作（執行 agent 迴圈）…');
const t1 = Date.now();
await ev(`(async()=>{document.querySelector('#ai-run').click();
  for(let i=0;i<600;i++){await new Promise(r=>setTimeout(r,1000));
    if(!document.querySelector('#ai-run').disabled) return 1}
  return 0})()`);
console.log('  完成，' + ((Date.now() - t1) / 1000).toFixed(0) + ' 秒');

// 補圖(美術指導 → 一次生一張格盤圖 → 程式切格)。每天只有 2 次,用 IMG=1 才跑
if (process.env.IMG === '1') {
  console.log('▶ AI 補圖（美術指導 + 生圖）…');
  const t2 = Date.now();
  const r = await ev(`(async()=>{
    const b=document.querySelector('#ai-images');
    if(!b||b.disabled) return 'button-unavailable';
    b.click();
    for(let i=0;i<900;i++){await new Promise(r=>setTimeout(r,1000));
      if(!b.disabled) return 'done'}
    return 'timeout'})()`);
  console.log('  ' + r + '，' + ((Date.now() - t2) / 1000).toFixed(0) + ' 秒');
  // 格盤原圖只留在記憶體(lastGridUrl),按「下載格盤」才拿得到;這裡直接抓那個變數的 blob
  const grid = await ev(`(async()=>{
    const b=document.querySelector('#ai-grid-dl');
    if(!b||b.hidden) return null;
    return null;})()`).catch(() => null);
}

// 成品:直接截 #phone 這一塊(畫面是 DOM 不是 canvas)
let shot = null;
try {
  const box = await ev(`(()=>{const e=document.querySelector('#phone');e.scrollIntoView();
    const r=e.getBoundingClientRect();
    return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}})()`);
  if (box && box.width > 10) {
    const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 2 } }, sessionId);
    shot = 'data:image/png;base64,' + s.data;
  }
} catch (e) { console.log('  截圖失敗:' + e.message); }
const out = await ev(`(()=>{
  return {topic:${JSON.stringify(TOPIC)}, rec:window.__rec, logs:window.__logs,
    screenplay:document.querySelector('#ai-screenplay-text').value};})()`);
out.shot = shot;
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('攔截到 ' + out.rec.length + ' 次 API 呼叫，log ' + out.logs.length + ' 行 → ' + OUT);
sock.close(); proc.kill(); await new Promise((r) => setTimeout(r, 600));
rmSync(dir, { recursive: true, force: true });
