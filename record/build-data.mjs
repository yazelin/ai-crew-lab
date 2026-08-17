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
      out.art = { model: m, ms: c.ms, text: t ? t.content : '' };
    } else if (/\/images\/jobs$/.test(c.url)) {
      // 盤面大小不要寫死:prompt 第一行就寫著「一張 N×M 等分網格圖」,直接讀出來
      const g = String((q || {}).prompt || '').match(/一張\s*(\d+)×(\d+)\s*等分網格圖/);
      out.image = { ms: c.ms, status: c.status, job: (j(c.res) || {}).id || '', polls: 0, url: '',
        cols: g ? +g[1] : 0, rows: g ? +g[2] : 0 };
    } else if (/\/images\/jobs\//.test(c.url)) {
      if (out.image) { out.image.polls++; const d = j(c.res);
        if (d && d.status === 'succeeded' && d.images && d.images[0]) out.image.url = d.images[0].url; }
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
  const GRIDS = { 'run-img.json': 'assets/grid.jpg', 'run-fix2.json': 'assets/grid-fixed.jpg' };
  if (GRIDS[f]) r.grid = GRIDS[f];
  if (f === 'run-img.json') r.beforeFix = true;   // 這一次是 imgDesc 修好之前錄的
  // 按鈕上的短標籤:主題直接截斷會有兩次長得一模一樣,使用者分不出來
  const LABEL = {
    'run-1.json': '深夜曖昧', 'run-2.json': '群組修羅場', 'run-812b.json': '情侶吵架和好',
    'run-a85f.json': '家人的日常（評審壞掉）', 'run-work.json': '職場修羅場',
    'run-img.json': '有補圖・修好前', 'run-fix.json': '有描述・修好後', 'run-fix2.json': '有補圖・修好後',
  };
  r.label = LABEL[f] || r.topic;
  /* 成品不用截圖,用 line-chat-maker 內建的「嵌入HTML」——那是自包含的真實元件:
     CSS 內嵌並加了 .lcm-embed 前綴、圖片是 data URI、沒有外部相依,而且可以捲、可以逐則播。
     純文字那幾次只有 13~19 KB,比長截圖(200~300 KB)還小。見 record/embeds.mjs。 */
  const name = f.replace(/^run-|\.json$/g, '');
  r.embed = existsSync('data/embeds/' + name + '.html') ? 'data/embeds/' + name + '.html' : null;
  delete r.shot;   // 錄製當下那張 base64 截圖不要留在 JSON 裡(它本身也是壞的,見 reshoot.mjs 註解)
  runs.push(r);
  console.log('  ' + f.padEnd(16) + r.topic.padEnd(20)
    + '編劇 ' + (r.critic[0] ? r.critic[0].writerMs : '?') + 'ms'
    + '　評審 ' + r.critic.length + ' 輪'
    + '　執行 ' + r.agent.length + ' 步'
    + '　工具 ' + r.agent.reduce((a, s) => a + s.calls.length, 0) + ' 次'
    + (r.art ? '　美術指導 ✓' : '') + (r.image ? '　生圖 ' + r.image.polls + ' 次輪詢' : '')
    + (r.shot ? '　有成品圖' : ''));
}
const bench = JSON.parse(readFileSync('record/critic-bench.json', 'utf8'));
writeFileSync('data/runs.json', JSON.stringify({ runs, bench }, null, 1));
console.log('\n→ data/runs.json  ' + (JSON.stringify({ runs, bench }).length / 1024).toFixed(0) + ' KB');
