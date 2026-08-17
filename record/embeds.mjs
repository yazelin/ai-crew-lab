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
function paste(state, dir) {
  if (!dir || !existsSync(dir)) return 0;
  const slots = state.messages.filter((m) => m.type === 'msg' && (m.kind === 'image' || m.kind === 'sticker'));
  let n = 0;
  for (let i = 0; i < slots.length; i++) {   // 貼圖要 alpha 走 png、照片走 jpg
    const png = dir + '/' + (i + 1) + '.png', jpg = dir + '/' + (i + 1) + '.jpg';
    const f = existsSync(png) ? png : existsSync(jpg) ? jpg : null;
    if (!f) break;
    slots[i].img = 'data:image/' + (f.endsWith('.png') ? 'png' : 'jpeg') + ';base64,'
      + readFileSync(f).toString('base64');
    n++;
  }
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
  const pasted = paste(script, { 'run-fix2.json': 'record/cells-fix2' }[f]);
  await send('Page.navigate', { url: PAGE }, sessionId);
  await new Promise((r) => setTimeout(r, 2000));
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
  if (!sharedStyle) { sharedStyle = style; writeFileSync('data/embeds/_shared.css', style.replace(/^<style>|<\/style>$/g, '').trim()); }
  const name = f.replace(/^run-|\.json$/g, '');
  writeFileSync('data/embeds/' + name + '.html', body);
  console.log('  ' + f.padEnd(16) + (body.length / 1024).toFixed(0).padStart(4) + ' KB'
    + (pasted ? '（含 ' + pasted + ' 張圖）' : '') + (style === sharedStyle ? '　樣式相同' : '　⚠ 樣式不同'));
}
console.log('  共用樣式 ' + (sharedStyle.length / 1024).toFixed(0) + ' KB（只存一份）');
sock.close(); proc.kill(); await new Promise((r) => setTimeout(r, 500));
rmSync(dir, { recursive: true, force: true });
