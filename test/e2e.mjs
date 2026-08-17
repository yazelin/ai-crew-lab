/* test/e2e.mjs — 真瀏覽器端到端。零相依:spawn Chrome 講 CDP。
   跑法:python3 -m http.server 8877  然後  node test/e2e.mjs
        打線上版:PAGE=https://yazelin.github.io/ai-crew-lab/ node test/e2e.mjs
   驗的是重播真的跑得動:資料載入、評審遊戲會揭曉、執行可以逐步重播、
   格盤按實際格數切開(修好前 2×2、修好後 3×3),以及手機不會橫向溢位。 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(),'crew-'));
const port = 9770;
const proc = spawn('google-chrome',[`--remote-debugging-port=${port}`,`--user-data-dir=${dir}`,
  '--headless=new','--no-first-run','--window-size=1200,900','about:blank'],{stdio:'ignore'});
let ws; for(let i=0;i<100&&!ws;i++){await new Promise(r=>setTimeout(r,100));
  try{ws=(await(await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;}catch{}}
const sock=new WebSocket(ws); await new Promise((r,j)=>{sock.onopen=r;sock.onerror=j;});
let id=0;const w=new Map();
sock.onmessage=e=>{const m=JSON.parse(e.data);if(w.has(m.id))w.get(m.id)(m);};
const send=(m,p,s)=>new Promise((r,j)=>{const n=++id;w.set(n,x=>x.error?j(new Error(m+':'+x.error.message)):r(x.result));sock.send(JSON.stringify({id:n,method:m,params:p,sessionId:s}));});
const {targetId}=await send('Target.createTarget',{url:'about:blank'});
const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
await send('Page.enable',{},sessionId); await send('Runtime.enable',{},sessionId);
const errs=[];
send('Runtime.consoleAPICalled',{},sessionId).catch(()=>{});
sock.addEventListener('message',e=>{const m=JSON.parse(e.data);
  if(m.method==='Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
  if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error') errs.push(m.params.args.map(a=>a.value||a.description).join(' '));});
await send('Page.navigate',{url:process.env.PAGE || 'http://127.0.0.1:8877/'},sessionId);
await new Promise(r=>setTimeout(r,2500));
const ev=e=>send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true,timeout:60000},sessionId)
  .then(r=>{if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;});
let bad=0; const ok=(n,c,x)=>{console.log((c?'  ✓ ':'  ✗ ')+n+(x?'  '+x:''));if(!c)bad++;};
console.log('\n[AI 劇組實驗室]');
ok('資料載入、主題按鈕都在', await ev(`document.querySelectorAll('#pickRun button').length`)>=6,
  String(await ev(`document.querySelectorAll('#pickRun button').length`)));
ok('時間軸畫出來了', await ev(`document.querySelectorAll('#timeline table tr').length`)>3,
  (await ev(`document.querySelectorAll('#timeline table tr').length`))+' 列');
ok('編劇劇本有內容', (await ev(`document.querySelector('#writerBox pre').textContent.length`))>200,
  (await ev(`document.querySelector('#writerBox pre').textContent.length`))+' 字');
ok('評審遊戲四個案例', await ev(`document.querySelectorAll('#criticGame > .card').length`)===4);
// 玩一次評審遊戲
const rev = await ev(`(()=>{const c=document.querySelectorAll('#criticGame > .card')[1];
  c.querySelector('button[data-g="pass"]').click();
  const r=c.querySelector('.reveal');
  return {hidden:r.hidden, verdict:r.querySelector('.verdict').textContent.trim(), bars:r.querySelectorAll('.bar').length,
    danger:!!r.querySelector('.card.danger')}})()`);
ok('猜完會揭曉真評審的判決', !rev.hidden && rev.bars>=6, rev.verdict+'　'+rev.bars+' 條分數');
ok('第二個案例會點出「規則沒被執行」', rev.danger);
// 執行重播
const ag = await ev(`(()=>{const n=document.querySelector('#agNext');
  for(let i=0;i<4;i++) n.click();
  return {steps:document.querySelectorAll('#agList .agstep').length,
    pos:document.querySelector('#agPos').textContent,
    hasMsgs:!!document.querySelector('#agList .m'),
    choices:[...document.querySelectorAll('#agList .tg')].map(e=>e.textContent).join(',')}})()`);
ok('執行可以逐步重播', ag.steps===4, ag.pos+'　'+ag.steps+' 步');
ok('每一步看得到 required／auto', /required/.test(ag.choices)&&/auto/.test(ag.choices), ag.choices);
ok('腳本訊息有被畫出來', ag.hasMsgs);
// 切到有補圖的那一次
const art = await ev(`(async()=>{
  const b=[...document.querySelectorAll('#pickRun button')].find(x=>/有補圖・修好後/.test(x.textContent));
  b.click(); await new Promise(r=>setTimeout(r,300));
  document.querySelector('#btnCut').click(); await new Promise(r=>setTimeout(r,1200));
  return {prompts:document.querySelectorAll('#artBox .card').length,
    cells:document.querySelectorAll('#cutOut canvas').length,
    px:(()=>{const c=document.querySelector('#cutOut canvas');if(!c)return 0;
      const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;
      for(let i=0;i<d.length;i+=4) if(d[i]+d[i+1]+d[i+2]<720) n++; return n;})()}})()`);
ok('美術指導 prompt 顯示出來', art.prompts>=3, art.prompts+' 格');
ok('格盤按實際格數切開（6 格→3×3）', art.cells===9, art.cells+' 格');
// 修好前那一次是 2×2
const art2 = await ev(`(async()=>{
  const b=[...document.querySelectorAll('#pickRun button')].find(x=>/有補圖・修好前/.test(x.textContent));
  b.click(); await new Promise(r=>setTimeout(r,300));
  document.querySelector('#btnCut').click(); await new Promise(r=>setTimeout(r,1200));
  return {cells:document.querySelectorAll('#cutOut canvas').length,
    warn:!!document.querySelector('#artBox .card.danger')}})()`);
ok('修好前那一次是 2×2，而且有標示', art2.cells===4 && art2.warn, art2.cells+' 格，警告 '+art2.warn);
/* 切格要驗三件事:
   1. 切的是「畫面上那一張」(之前 img.src 寫死成 assets/grid.jpg,顯示 A 切 B)
   2. 每邊內縮 8%(cellRect 的 inset) —— 少了它每格都會帶白邊
   3. 貼圖有去背(chromaKeyData) —— 少了它貼圖會頂著一塊純綠
   對照組用同一份 LCM_PURE 算,但來源圖是從畫面上讀的,所以第 1 點還是驗得到。 */
const px = await ev(`(async()=>{
  const grab=(label,idx)=>new Promise(async res=>{
    const b=[...document.querySelectorAll('#pickRun button')].find(x=>x.textContent===label);
    b.click(); await new Promise(r=>setTimeout(r,400));
    const src=document.querySelector('#artBox figure img').getAttribute('src');
    document.querySelector('#btnCut').click(); await new Promise(r=>setTimeout(r,1500));
    const cs=document.querySelectorAll('#cutOut canvas');
    const c=cs[idx];
    const avg=(d)=>{let r=0,g=0,b=0,n=0;for(let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2];n++;}return [r/n|0,g/n|0,b/n|0];};
    const d=c.getContext('2d').getImageData(0,0,c.width,c.height);
    let trans=0; for(let k=3;k<d.data.length;k+=4) if(d.data[k]<250) trans++;
    // 對照:用同一份 pure.js 從畫面上那張圖切同一格
    const im=new Image(); im.src=src; await im.decode();
    const cols=Math.round(Math.sqrt(cs.length));
    const r=LCM_PURE.cellRect(im.width,im.height,{cols,rows:cols},idx);
    const cv=document.createElement('canvas'); cv.width=Math.round(r.sw); cv.height=Math.round(r.sh);
    const x=cv.getContext('2d');
    x.drawImage(im,r.sx,r.sy,r.sw,r.sh,0,0,cv.width,cv.height);
    const e=x.getImageData(0,0,cv.width,cv.height);
    LCM_PURE.chromaKeyData(e.data,cv.width,cv.height);
    x.putImageData(e,0,0);
    const e2=x.getImageData(0,0,cv.width,cv.height);
    res({cut:avg(d.data), ref:avg(e2.data), img:src, cells:cs.length,
      w:c.width, expectW:Math.round(im.width/cols*0.84), trans:Math.round(trans/(d.data.length/4)*100)});
  });
  return {after: await grab('有補圖・修好後',1), before: await grab('有補圖・修好前',0)};
})()`);
for (const [k, v] of Object.entries(px)) {
  const diff = Math.max(...v.cut.map((c, i) => Math.abs(c - v.ref[i])));
  ok('切的是畫面上那一張、位置也對（' + k + '）', diff < 6,
    v.img + ' 切=' + v.cut.join(',') + ' 對照=' + v.ref.join(',') + ' 差 ' + diff);
  ok('每邊內縮 8%，白色分隔線沒被切進來（' + k + '）', Math.abs(v.w - v.expectW) <= 2,
    '格寬 ' + v.w + '，應為 ' + v.expectW);
}
ok('貼圖那一格真的去背了', px.after.trans > 20, px.after.trans + '% 的像素是透明的');
ok('切出來的圖有內容（非空白）', art.px>1000, art.px+' 個非白像素');
const of = await ev(`({docW:document.documentElement.clientWidth,scrollW:document.documentElement.scrollWidth})`);
ok('桌機不會橫向溢位', of.scrollW<=of.docW+2, of.scrollW+' vs '+of.docW);
// 手機
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:3,mobile:true},sessionId);
await new Promise(r=>setTimeout(r,800));
const m = await ev(`({docW:document.documentElement.clientWidth,scrollW:document.documentElement.scrollWidth})`);
ok('手機 390 不會橫向溢位', m.scrollW<=m.docW+2, m.scrollW+' vs '+m.docW);
if(errs.length) console.log('\n  主控台錯誤：\n   '+errs.slice(0,5).join('\n   '));
ok('沒有 JS 錯誤', errs.length===0, errs.length+' 個');
const s=await send('Page.captureScreenshot',{format:'png'},sessionId);
writeFileSync('/tmp/claude-1000/-home-ct/ef503ff9-029a-481e-96ad-e2f0f494a512/scratchpad/crew-m.png',Buffer.from(s.data,'base64'));
sock.close();proc.kill();await new Promise(r=>setTimeout(r,500));rmSync(dir,{recursive:true,force:true});
console.log(bad?`\n${bad} 項有問題`:'\n全部通過');
