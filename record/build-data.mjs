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
      out.image = { ms: c.ms, status: c.status, job: (j(c.res) || {}).id || '', polls: 0, url: '' };
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
  if (r.shot) { // 截圖不塞進 JSON:存成獨立 PNG,再由 shrink-assets.mjs 轉成小 jpg
    mkdirSync('assets', { recursive: true });
    const png = 'assets/' + f.replace(/^run-|\.json$/g, '') + '.png';
    if (!existsSync(png.replace('.png', '.jpg'))) writeFileSync(png, Buffer.from(r.shot.split(',')[1], 'base64'));
    r.shot = png.replace('.png', '.jpg');
  }
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
