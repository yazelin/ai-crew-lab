/* build-data.mjs — 把錄到的原始 API 往返整理成網站用的重播資料。
   原始檔留在 record/ 不進網站(太大而且含完整 prompt);網站只拿重播需要的部分。 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';

const j = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };
const msg = (c) => { const d = j(c.res); return d && d.choices && d.choices[0] && d.choices[0].message || null; };
const sys = (c) => { const q = j(c.req); return q && q.messages && q.messages[0] && q.messages[0].content || ''; };
const model = (c) => (j(c.req) || {}).model || '';

function parseRun(raw) {
  const rec = raw.rec.filter((c) => /chat\/completions|images/.test(c.url));
  const out = { topic: raw.topic, screenplay: raw.screenplay, shot: raw.shot || null,
    writer: null, critic: [], agent: [], art: null, image: null };
  let pendingWriter = null;
  for (const c of rec) {
    const s = sys(c), m = model(c), q = j(c.req) || {};
    if (/^你是資深編劇/.test(s)) {
      const t = msg(c);
      pendingWriter = { model: m, ms: c.ms, text: t ? t.content : '',
        round: (out.critic.length + 1), rewrite: q.messages.length > 2 };
      if (!out.writer) out.writer = pendingWriter; else out.critic.push({ rewrite: pendingWriter });
    } else if (/^你是嚴格的/.test(s)) {
      const t = msg(c), v = t ? j((String(t.content).match(/\{[\s\S]*\}/) || ['null'])[0]) : null;
      out.critic.push({ model: m, ms: c.ms, verdict: v, raw: t ? String(t.content).slice(0, 2000) : '',
        writerText: pendingWriter ? pendingWriter.text : '', writerMs: pendingWriter ? pendingWriter.ms : 0,
        writerModel: pendingWriter ? pendingWriter.model : '' });
    } else if (/^你是美術指導/.test(s)) {
      const t = msg(c);
      /* 每一格「本來是什麼」要留下來:去背只能對貼圖做。
         不能看顏色決定 —— 照片背景剛好是草地的話,四角一樣是綠的。 */
      const list = String((q.messages || [])[1] && q.messages[1].content || '');
      const slots = [...list.matchAll(/格(\d+)\((照片|貼圖|頭像)\)/g)]
        .map((x) => ({ n: +x[1], type: { 照片: 'image', 貼圖: 'sticker', 頭像: 'avatar' }[x[2]] }));
      out.art = { model: m, ms: c.ms, text: t ? t.content : '', slots };
    } else if (/\/images\/jobs$/.test(c.url)) {
      // 盤面大小不要寫死:prompt 第一行就寫著「一張 N×M 等分網格圖」,直接讀出來
      const g = String((q || {}).prompt || '').match(/一張\s*(\d+)×(\d+)\s*等分網格圖/);
      /* 不要存 job id 與圖片網址:那是自架服務(內部網域)的位址,
         這份 JSON 會上公開頁面。頁面要的格盤圖在 assets/,不需要原始網址。 */
      out.image = { ms: c.ms, status: c.status, polls: 0, cols: g ? +g[1] : 0, rows: g ? +g[2] : 0 };
    } else if (/\/images\/jobs\//.test(c.url)) {
      if (out.image) out.image.polls++;
    } else if (q.tools) {                                   // 執行 agent 的每一步
      const t = msg(c) || {};
      out.agent.push({ ms: c.ms, choice: q.tool_choice ? (typeof q.tool_choice === 'string' ? q.tool_choice : 'required') : 'auto',
        text: typeof t.content === 'string' ? t.content.slice(0, 600) : '',
        calls: (t.tool_calls || []).map((tc) => {
          const a = j(tc.function.arguments) || {};
          return { name: tc.function.name,
            settings: a.settings || null,
            people: (a.people || []).map((p) => ({ id: p.id, name: p.name })),
            messages: (a.messages || []).map((mm) => ({ type: mm.type, kind: mm.kind, side: mm.side,
              text: mm.text, personId: mm.personId, time: mm.time, read: mm.read,
              imgDesc: mm.imgDesc, dur: mm.dur, fname: mm.fname })),
            bytes: (tc.function.arguments || '').length };
        }) });
    }
  }
  return out;
}

const runs = [];
for (const f of readdirSync('record').filter((f) => /^run-.*\.json$/.test(f)).sort()) {
  const raw = JSON.parse(readFileSync('record/' + f, 'utf8'));
  const r = parseRun(raw);
  r.file = f;
  // 格盤原圖是從生圖服務抓回來另存的(見 README),用檔名對應
  const GRIDS = { 'run-img.json': 'assets/grid.jpg', 'run-fix2.json': 'assets/grid-fixed.jpg',
    'run-av.json': 'assets/grid-av.jpg', 'run-buy.json': 'assets/grid-buy.jpg' };
  if (GRIDS[f]) r.grid = GRIDS[f];
  if (f === 'run-img.json') r.beforeFix = true;   // 這一次是 imgDesc 修好之前錄的
  /* 只留「看得到某件事」的那幾次。其餘只是換主題,或是除錯過程留下的,
     擺上去只會讓人不知道該點哪一個。錄製檔全部留在 record/,要加回來隨時可以。 */
  const KEEP = {
    'run-n-plain.json': { label: '一般情況', why: '一切順利的樣子：編劇一稿過關 62/70，執行填完腳本。先看這個當基準。這一次跑在七項評審上，分數行有「合理」那一欄。' },
    'run-a85f.json': { label: '評審壞掉時', why: '評審回的東西 JSON 解析失敗，程式印出「採用目前劇本」就放行——那一次等於沒有評審。用語言模型當裁判，就得先想好它壞掉的時候怎麼辦。' },
    'run-buy.json': { label: '有補圖的完整一輪', why: '走完五個角色，而且是唯一一次評審真的退件、編劇拿著意見整份重寫（45/60 → 51/60）。劇情是一個人在店裡、一個人在外縣市，每張照片都有非傳不可的理由。' },
  };
  if (!KEEP[f]) { r.__drop = true; } else { r.label = KEEP[f].label; r.why = KEEP[f].why; }
  /* 成品不用截圖,用 line-chat-maker 內建的「嵌入HTML」——那是自包含的真實元件:
     CSS 內嵌並加了 .lcm-embed 前綴、圖片是 data URI、沒有外部相依,而且可以捲、可以逐則播。
     純文字那幾次只有 13~19 KB,比長截圖(200~300 KB)還小。見 record/embeds.mjs。 */
  const name = f.replace(/^run-|\.json$/g, '');
  r.embed = existsSync('data/embeds/' + name + '.html') ? 'data/embeds/' + name + '.html' : null;
  delete r.shot;   // 錄製當下那張 base64 截圖不要留在 JSON 裡(它本身也是壞的,見 reshoot.mjs 註解)
  if (r.__drop) { console.log('  ' + f.padEnd(16) + '（未收錄：只是換主題／除錯用）'); continue; }
  runs.push(r);
  console.log('  ' + f.padEnd(16) + r.topic.padEnd(20)
    + '編劇 ' + (r.critic[0] ? r.critic[0].writerMs : '?') + 'ms'
    + '　評審 ' + r.critic.length + ' 輪'
    + '　執行 ' + r.agent.length + ' 步'
    + '　工具 ' + r.agent.reduce((a, s) => a + s.calls.length, 0) + ' 次'
    + (r.art ? '　美術指導 ✓' : '') + (r.image ? '　生圖 ' + r.image.polls + ' 次輪詢' : '')
    + (r.shot ? '　有成品圖' : ''));
}
// 順序照教學動線(先看正常的,再看兩種例外),不要照檔名
const ORDER = ['一般情況', '評審壞掉時', '有補圖的完整一輪'];
runs.sort((a, b) => ORDER.indexOf(a.label) - ORDER.indexOf(b.label));
const bench = JSON.parse(readFileSync('record/critic-bench.json', 'utf8'));
writeFileSync('data/runs.json', JSON.stringify({ runs, bench }, null, 1));
console.log('\n→ data/runs.json  ' + (JSON.stringify({ runs, bench }).length / 1024).toFixed(0) + ' KB');
