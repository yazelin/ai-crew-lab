/* embeds.mjs — 用 line-chat-maker 內建的「嵌入HTML」產生真正可互動的成品,取代長截圖。
   嵌入碼是自包含的:CSS 內嵌並加了 .lcm-embed 前綴、圖片是 data URI、沒有外部相依。
   做法跟 reshoot.mjs 一樣把腳本灌回頁面,然後攔截 clipboard 拿到那段 HTML。 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PAGE = 'https://yazelin.github.io/line-chat-maker/';
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
      } else if (n === 'append_messages' && Array.isArray(a.messages)) state.messages.push(...a.messages);
    }
  }
  state.settings.height = 'fixed';        // 嵌入用固定高:那才是手機該有的樣子,捲動交給嵌入碼
  state.settings.aiFab = false;
  state.settings.embedAutoplay = false;   // 播放由這頁自己的按鈕控制,不要捲到就自己動
  state.people.forEach((p) => { if (!/^data:image/.test(p.avatar || '')) p.avatar = null; });
  return state;
}
/* 把格盤切開貼回訊息。切格與去背一律用 line-chat-maker 自己的 LCM_PURE —— 
   cellRect 每邊內縮 8%(閃開生圖時要求的白色分隔線),chromaKeyData 四角取綠中位數再羽化。
   自己重寫一套的下場:白邊沒切掉、位置偏一點點,而且跟工具本人的結果對不起來。 */
async function cutCells(ev, gridDataUrl, cols, rows, n) {
  return ev(`(async()=>{
    const im=new Image(); im.src=${JSON.stringify(gridDataUrl)}; await im.decode();
    const grid={cols:${cols},rows:${rows}};
    const out=[];
    for(let i=0;i<${n};i++){
      const r=LCM_PURE.cellRect(im.width,im.height,grid,i);
      const c=document.createElement('canvas'); c.width=Math.round(r.sw); c.height=Math.round(r.sh);
      const x=c.getContext('2d');
      x.drawImage(im,r.sx,r.sy,r.sw,r.sh,0,0,c.width,c.height);
      const d=x.getImageData(0,0,c.width,c.height);
      LCM_PURE.chromaKeyData(d.data,c.width,c.height);   // 不是綠幕的話它自己會整張保留
      let keyed=false;
      for(let k=3;k<d.data.length;k+=4) if(d.data[k]<250){keyed=true;break;}
      x.putImageData(d,0,0);
      // 縮到 300px 再輸出:data URI 要進 HTML,原尺寸一格就好幾百 KB
      const s=Math.min(1,300/Math.max(c.width,c.height));
      const o=document.createElement('canvas'); o.width=Math.round(c.width*s); o.height=Math.round(c.height*s);
      o.getContext('2d').drawImage(c,0,0,o.width,o.height);
      // 貼圖要 alpha:用 WebP(有 alpha 又比 PNG 小一個數量級);照片走 JPEG
      out.push(keyed ? o.toDataURL('image/webp', 0.85) : o.toDataURL('image/jpeg', 0.8));
    }
    return out;})()`);
}
/* 貼回去的順序要跟 ai.js 的 buildSlots 一致:先所有沒圖的 image/sticker 訊息(依訊息順序),
   再所有沒頭像的人物。大頭貼跟訊息裡的圖是同一張格盤切出來的 —— 那正是這一刀的重點。 */
function pasteUrls(state, urls) {
  const msgSlots = state.messages.filter((m) => m.type === 'msg' && (m.kind === 'image' || m.kind === 'sticker') && !m.img);
  const avaSlots = state.people.filter((p) => !p.avatar);
  let n = 0;
  for (const m of msgSlots) { if (n >= urls.length) break; m.img = urls[n++]; }
  for (const p of avaSlots) { if (n >= urls.length) break; p.avatar = urls[n++]; }
  return n;
}

const dir = mkdtempSync(join(tmpdir(), 'lcm-emb-'));
const port = 9660;
const proc = spawn('google-chrome', [`--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
  '--headless=new', '--no-first-run', '--window-size=900,1200', 'about:blank'], { stdio: 'ignore' });
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

mkdirSync('data/embeds', { recursive: true });
let sharedStyle = null;
for (const f of readdirSync('record').filter((x) => /^run-.*\.json$/.test(x)).sort()) {
  const raw = JSON.parse(readFileSync('record/' + f, 'utf8'));
  const script = rebuild(raw);
  if (!script.messages.length) continue;
  await send('Page.navigate', { url: PAGE }, sessionId);
  await new Promise((r) => setTimeout(r, 2000));
  // 有補圖的那幾次:把格盤切開貼回去(切格/去背都走頁面裡的 LCM_PURE)
  const GRID = {
    'run-fix2.json': ['record/grid-fixed.png', 3, 3, 6],
    'run-av.json': ['record/grid-av.png', 3, 3, 6],   // 第 6 格是大頭貼
  };
  let pasted = 0;
  if (GRID[f]) {
    const [gf, cols, rows, n] = GRID[f];
    const url = 'data:image/png;base64,' + readFileSync(gf).toString('base64');
    pasted = pasteUrls(script, await cutCells(ev, url, cols, rows, n));
  }
  await ev('localStorage.setItem("lcm-state", ' + JSON.stringify(JSON.stringify(script)) + '), 1');
  await send('Page.navigate', { url: PAGE }, sessionId);
  await new Promise((r) => setTimeout(r, 2500));
  // 攔截剪貼簿:嵌入碼是用 clipboard.writeText 交出來的
  const html = await ev(`(async()=>{
    let grabbed=null;
    const orig=navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText=async(t)=>{grabbed=t;};
    window.alert=()=>{};
    document.querySelector('#export-html').click();
    for(let i=0;i<60 && grabbed===null;i++) await new Promise(r=>setTimeout(r,200));
    navigator.clipboard.writeText=orig;
    return grabbed;})()`);
  if (!html) { console.log('  ' + f.padEnd(16) + '拿不到嵌入碼'); continue; }
  const i = html.indexOf('<style>');
  const body = html.slice(0, i).trim();
  const style = html.slice(i);
  if (!sharedStyle) { sharedStyle = style; writeFileSync('data/embeds/shared.css', style.replace(/^<style>|<\/style>$/g, '').trim()); }
  const name = f.replace(/^run-|\.json$/g, '');
  writeFileSync('data/embeds/' + name + '.html', body);
  console.log('  ' + f.padEnd(16) + (body.length / 1024).toFixed(0).padStart(4) + ' KB'
    + (pasted ? '（含 ' + pasted + ' 張圖）' : '') + (style === sharedStyle ? '　樣式相同' : '　⚠ 樣式不同'));
}
console.log('  共用樣式 ' + (sharedStyle.length / 1024).toFixed(0) + ' KB（只存一份）');
sock.close(); proc.kill(); await new Promise((r) => setTimeout(r, 500));
rmSync(dir, { recursive: true, force: true });
