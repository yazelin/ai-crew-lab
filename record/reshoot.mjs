/* reshoot.mjs — 重新拍成品圖。不用再呼叫 AI:錄到的工具呼叫裡就有完整腳本,
   把它組回來、用 #s= 分享連結灌進頁面、再正確截一次。

   第一版錯在哪(三個錯疊在一起,所以上下都被切):
     1. clip 用了 getBoundingClientRect() 的視窗座標,但 CDP 的 clip 吃的是頁面座標;
        又先 scrollIntoView(),於是整個擷取範圍偏掉一個捲動距離
     2. 沒開 captureBeyondViewport,手機比視窗高就抓不到
     3. 對話本身是捲動容器(.phone.fixedh .line-chat overflow-y:auto),
        擷到的只是當下捲到的那一段,前面的訊息根本不在畫面上
   這一版:頁面座標、captureBeyondViewport、拿掉 fixedh 讓整段對話展開。 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 把錄到的工具呼叫重播成最終腳本
function rebuild(raw) {
  const state = { settings: {}, people: [], messages: [] };
  for (const c of raw.rec) {
    let m; try { m = JSON.parse(c.res).choices[0].message; } catch (e) { continue; }
    for (const tc of m.tool_calls || []) {
      let a; try { a = JSON.parse(tc.function.arguments); } catch (e) { continue; }
      const n = tc.function.name;
      if (n === 'apply_script') {
        if (a.settings) Object.assign(state.settings, a.settings);
        if (a.people) state.people = a.people;
        if (a.messages) state.messages = a.messages;
      } else if (n === 'append_messages' && Array.isArray(a.messages)) {
        state.messages.push(...a.messages);
      }
    }
  }
  // 手機高度改成自動:預設是 fixed(固定高、對話變成捲動容器),那樣只拍得到一段。
  // 這個開關在 settings.height,不能用改 class 的方式 —— render() 每次都會重建 class。
  state.settings.height = 'auto';
  state.settings.aiFab = false;   // 右下角那顆 AI 浮動鈕是操作介面,不屬於成品,拍照時關掉
  // avatar 是 "@img0" 這種佔位符:它指向當時瀏覽器 session 裡的暫存表,灌回來只會變破圖
  state.people.forEach((p) => { if (!/^data:image/.test(p.avatar || '')) p.avatar = null; });
  return state;
}

/* 把補圖生成的格子貼回訊息。
   只做 run-fix2 —— 它的待補圖清單(照片,貼圖,照片,貼圖,貼圖,照片)跟訊息順序完全吻合,對得起來。
   修好前那一次(run-img)清單是 3 格、訊息卻有 7 則非文字,對應關係無法確定,寧可不貼也不要猜。 */
function paste(state, dir) {
  if (!dir || !existsSync(dir)) return 0;
  const slots = state.messages.filter((m) => m.type === 'msg' && (m.kind === 'image' || m.kind === 'sticker'));
  let n = 0;
  for (let i = 0; i < slots.length; i++) {
    const f = dir + '/' + (i + 1) + '.png';
    if (!existsSync(f)) break;
    slots[i].img = 'data:image/png;base64,' + readFileSync(f).toString('base64');
    n++;
  }
  return n;
}
const b64url = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

const dir = mkdtempSync(join(tmpdir(), 'lcm-shot-'));
const port = 9680;
const proc = spawn('google-chrome', [`--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
  '--headless=new', '--no-first-run', '--window-size=900,1400', 'about:blank'], { stdio: 'ignore' });
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
const ev = (e) => send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true, timeout: 60000 }, sessionId)
  .then((r) => { if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; });

const PAGE = 'https://yazelin.github.io/line-chat-maker/';
const WANT = process.argv.slice(2);
for (const f of readdirSync('record').filter((x) => /^run-.*\.json$/.test(x)).sort()) {
  if (WANT.length && !WANT.includes(f)) continue;
  const raw = JSON.parse(readFileSync('record/' + f, 'utf8'));
  const script = rebuild(raw);
  if (!script.messages.length) { console.log('  ' + f.padEnd(16) + '跳過（沒有腳本）'); continue; }
  const CELLS = { 'run-fix2.json': 'record/cells-fix2' };
  const pasted = paste(script, CELLS[f]);
  /* 灌入走 localStorage 的 lcm-state 收件匣(app.js 開頁時會讀它),不走 #s= 分享連結 ——
     貼了圖之後 JSON 有好幾百 KB,塞進網址會爆長度上限,頁面根本載不起來。 */
  await send('Page.navigate', { url: PAGE }, sessionId);
  await new Promise((r) => setTimeout(r, 2000));
  await ev('localStorage.setItem("lcm-state", ' + JSON.stringify(JSON.stringify(script)) + '), 1');
  await send('Page.navigate', { url: PAGE }, sessionId);
  await new Promise((r) => setTimeout(r, 3000));
  // 拿掉 fixedh:整段對話展開,不然只拍得到捲軸目前那一段。順便關掉浮動提示與背光。
  const box = await ev(`(()=>{
    const p=document.querySelector('#phone');
    document.querySelectorAll('.toast,#toast,.phone-backlight').forEach(e=>e.style.display='none');
    window.scrollTo(0,0);
    const r=p.getBoundingClientRect();
    return {x:Math.round(r.x+scrollX), y:Math.round(r.y+scrollY),
      width:Math.round(r.width), height:Math.round(r.height),
      msgs:document.querySelectorAll('#chat > *').length};})()`);
  await new Promise((r) => setTimeout(r, 600));
  const shot = await send('Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: true, clip: { ...box, scale: 2 } }, sessionId);
  const out = 'assets/' + f.replace(/^run-|\.json$/g, '') + '.png';
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('  ' + f.padEnd(16) + box.width + '×' + box.height + '　' + box.msgs + ' 則'
    + (pasted ? '　貼回 ' + pasted + ' 張圖' : '') + '　→ ' + out);
}
sock.close(); proc.kill(); await new Promise((r) => setTimeout(r, 500));
rmSync(dir, { recursive: true, force: true });
