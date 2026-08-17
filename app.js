/* app.js — 這頁沒有任何即時 API 呼叫,全部是重播 data/runs.json 裡預錄的真實跑程。
   資料怎麼來的:record/record.mjs 攔截 fetch,把每一次對代理的請求與回應原樣存下來,
   再由 record/build-data.mjs 整理成這裡要用的形狀。 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const secs = (ms) => (ms / 1000).toFixed(1) + ' 秒';
  const DIMS = [['arc', '劇情弧'], ['voice', '角色聲音'], ['form', '形式運用'], ['pacing', '節奏'], ['real', '真實感'], ['share', '傳播力']];

  let DATA = null, run = null;

  fetch('data/runs.json').then((r) => r.json()).then((d) => { DATA = d; boot(); })
    .catch((e) => { $('timeline').textContent = '載入預錄資料失敗:' + e.message; });

  function boot() {
    const bar = $('pickRun');
    DATA.runs.forEach((r, i) => {
      const b = el('button', i === 0 ? 'primary' : '', esc(r.label || r.topic));
      b.title = r.topic;
      b.addEventListener('click', () => {
        [...bar.children].forEach((c) => c.classList.remove('primary'));
        b.classList.add('primary');
        show(r);
      });
      bar.appendChild(b);
    });
    show(DATA.runs[0]);
    buildCriticGame();
  }

  function show(r) {
    run = r;
    const tools = r.agent.reduce((a, s) => a + s.calls.length, 0);
    const total = (r.critic[0] ? r.critic[0].writerMs : 0) + r.critic.reduce((a, c) => a + (c.ms || 0), 0)
      + r.agent.reduce((a, s) => a + s.ms, 0) + (r.art ? r.art.ms : 0) + (r.image ? r.image.polls * 5000 : 0);
    $('runNote').innerHTML = '這一次：主題「<b>' + esc(r.topic) + '</b>」，'
      + '編劇 ' + r.critic.length + ' 稿、執行 ' + r.agent.length + ' 步、工具呼叫 ' + tools + ' 次'
      + (r.art ? '、補圖 1 次生圖呼叫' : '') + '，整條產線約 ' + Math.round(total / 1000) + ' 秒。';
    renderTimeline(r);
    renderWriter(r);
    renderAgent(r);
    renderArt(r);
  }

  // ── 產線時間軸 ──
  function renderTimeline(r) {
    const box = $('timeline'); box.innerHTML = '';
    const t = el('div', 'tscroll');
    const rows = [];
    const first = r.critic[0] || {};
    rows.push(['①', '編劇', first.writerModel || '—', first.writerMs || 0, '把一句主題寫成完整劇本（' + (r.screenplay || '').length + ' 字）']);
    r.critic.forEach((c, i) => {
      const v = c.verdict;
      rows.push(['②', '評審' + (r.critic.length > 1 ? '（第 ' + (i + 1) + ' 輪）' : ''), c.model || '—', c.ms || 0,
        v ? (v.pass ? '<b class="ok">通過 ' : '<b class="dead">退件 ') + v.total + '/60</b>　'
          + DIMS.map(([k, n]) => n + ' ' + (v.scores ? v.scores[k] : '?')).join('　')
          : '<b class="dead">回覆解析失敗</b>，程式採用目前劇本放行']);
    });
    const toolNames = {};
    r.agent.forEach((s) => s.calls.forEach((c) => { toolNames[c.name] = (toolNames[c.name] || 0) + 1; }));
    rows.push(['③', '執行', r.agent[0] ? '(見下方逐步重播)' : '—',
      r.agent.reduce((a, s) => a + s.ms, 0),
      r.agent.length + ' 步　' + Object.entries(toolNames).map(([n, c]) => '<code>' + n + '</code>×' + c).join('　')]);
    if (r.art) rows.push(['④', '美術指導', r.art.model, r.art.ms, '為每一格寫繪圖 prompt']);
    if (r.image) rows.push(['⑤', '生圖', 'codex-image', r.image.polls * 5000,
      '<b>1 次</b>生圖呼叫（2×2 格盤），輪詢 ' + r.image.polls + ' 次等它畫完']);
    t.innerHTML = '<table><tr><th></th><th>角色</th><th>模型</th><th class="num">耗時</th><th>做了什麼</th></tr>'
      + rows.map((x) => '<tr><td><b>' + x[0] + '</b></td><td><b>' + esc(x[1]) + '</b></td>'
        + '<td><code>' + esc(x[2]) + '</code></td><td class="num">' + secs(x[3]) + '</td><td>' + x[4] + '</td></tr>').join('')
      + '</table>';
    box.appendChild(t);
    if (r.shot) {
      const f = el('figure', 'shot');
      f.innerHTML = '<div class="shotbox"><img src="' + r.shot + '" alt="這次跑出來的成品" loading="lazy"></div>'
        + '<figcaption><b>這一次跑出來的成品</b>（完整長截圖，框內可以往下捲）。上面那幾個角色接力，最後就是為了這張圖。'
        + (r.art ? '' : '　圖片與貼圖是灰框，因為這一次沒有按「AI 補圖」——那正是第四、五個角色的工作。') + '</figcaption>';
      box.appendChild(f);
    }
  }

  // ── 編劇的實際輸出 ──
  function renderWriter(r) {
    const box = $('writerBox'); box.innerHTML = '';
    const c = r.critic[0] || {};
    const d = el('details', 'v1box');
    d.innerHTML = '<summary>看這一次編劇實際寫出來的劇本（' + (r.screenplay || '').length + ' 字，'
      + esc(c.writerModel || '') + '，花了 ' + secs(c.writerMs || 0) + '）</summary>'
      + '<pre class="script">' + esc(r.screenplay || '(這次沒錄到)') + '</pre>';
    box.appendChild(d);
  }

  // ── 自己當評審 ──
  function buildCriticGame() {
    const box = $('criticGame'); box.innerHTML = '';
    DATA.bench.cases.forEach((c, i) => {
      const v = c.verdict || {};
      const card = el('div', 'card');
      const short = c.script.length > 420 ? c.script.slice(0, 420) + '…' : c.script;
      card.innerHTML = '<p><b>' + esc(c.name) + '</b></p>'
        + '<details class="v1box"><summary>看這份劇本</summary><pre class="script">' + esc(c.script) + '</pre></details>'
        + '<pre class="script peek">' + esc(short) + '</pre>'
        + '<div class="row"><span class="hint">你覺得評審會——</span>'
        + '<button data-g="pass">判它通過</button><button data-g="fail">判它退件</button></div>'
        + '<div class="reveal" hidden></div>';
      const rev = card.querySelector('.reveal');
      card.querySelectorAll('button[data-g]').forEach((b) => b.addEventListener('click', () => {
        const guessPass = b.dataset.g === 'pass';
        const right = guessPass === !!v.pass;
        card.querySelectorAll('button[data-g]').forEach((x) => { x.disabled = true; });
        rev.hidden = false;
        rev.innerHTML = '<div class="verdict ' + (v.pass ? 'yes' : 'no') + '">真評審：'
          + (v.pass ? '通過' : '退件') + '　' + v.total + '/60　'
          + '<span style="font-size:.8rem;font-weight:600">（你' + (right ? '猜對了' : '猜錯了') + '）</span></div>'
          + '<div class="bars">' + DIMS.map(([k, n]) => {
            const s = v.scores ? v.scores[k] : 0;
            return '<div class="bar"><span>' + n + '</span>'
              + '<i style="width:' + (s * 10) + '%;background:' + (s >= 6 ? 'var(--accent)' : 'var(--bad)') + '"></i>'
              + '<b>' + s + '</b></div>';
          }).join('') + '</div>'
          + '<p class="hint">通過條件是<b>總分 ≥ 48 而且每項 ≥ 6</b>，紅色那幾條就是沒過的項目。</p>'
          + '<p><b>陷阱：</b>' + esc(c.trap) + '</p>'
          + '<details class="v1box"><summary>看真評審給的修改意見</summary><pre class="script">'
          + esc(v.feedback || c.raw || '') + '</pre></details>';
        if (i === 1) rev.insertAdjacentHTML('beforeend',
          '<div class="card danger"><p><b>這一份最值得看。</b>評審在意見裡把問題講得一清二楚，'
          + '但它自己 prompt 裡寫的是「real 不得超過 3 且 pass=false」——實際給了 <b>real = '
          + (v.scores ? v.scores.real : '?') + '</b>。<b>規則寫進 prompt，不代表規則會被執行。</b></p></div>');
      }));
      box.appendChild(card);
    });
  }

  // ── 執行 agent 逐步重播 ──
  let step = 0;
  function renderAgent(r) {
    const box = $('agentBox'); box.innerHTML = '';
    step = 0;
    box.appendChild(el('div', 'row', '<button class="primary" id="agPrev">← 上一步</button>'
      + '<button class="primary" id="agNext">下一步 →</button>'
      + '<button id="agAll">全部展開</button>'
      + '<span class="hint" id="agPos"></span>'));
    const list = el('div', '', ''); list.id = 'agList';
    box.appendChild(list);
    box.appendChild(el('p', 'hint', '<b>「累計訊息」那一欄是重點</b>：執行 AI 一次只填幾則，靠好幾輪把整份腳本堆出來。這就是編劇為什麼被限制在 40 則以內。'));
    $('agNext').addEventListener('click', () => { step = Math.min(r.agent.length, step + 1); paint(r); });
    $('agPrev').addEventListener('click', () => { step = Math.max(0, step - 1); paint(r); });
    $('agAll').addEventListener('click', () => { step = r.agent.length; paint(r); });
    paint(r);
  }

  function paint(r) {
    const list = $('agList'); list.innerHTML = '';
    $('agPos').textContent = step + ' / ' + r.agent.length + ' 步';
    let acc = 0;
    const names = {}; // personId → 名字:人物是第一步才建立的,後面每一步都要查得到
    r.agent.forEach((s) => s.calls.forEach((c) => (c.people || []).forEach((p) => { names[p.id] = p.name; })));
    const KIND = { sticker: '貼圖', image: '圖片', voice: '語音', file: '檔案' };
    r.agent.slice(0, Math.max(1, step)).forEach((s, i) => {
      const added = s.calls.reduce((a, c) => a + (c.messages ? c.messages.length : 0), 0);
      acc += added;
      const row = el('div', 'agstep' + (i === step - 1 ? ' now' : ''));
      const badge = s.choice === 'required'
        ? '<b class="tg do">required</b><span class="hint">不准講話，只能動手</span>'
        : '<b class="tg lab">auto</b><span class="hint">可以講話——這一步是自審</span>';
      let body = '';
      if (s.calls.length) {
        body = s.calls.map((c) => {
          let d = '<div class="callname"><code>' + esc(c.name) + '</code>'
            + '<span class="hint">參數 ' + c.bytes + ' 位元組</span></div>';
          if (c.settings) d += '<div class="hint">設定：' + esc(JSON.stringify(c.settings)) + '</div>';
          if (c.people && c.people.length) d += '<div class="hint">人物：' + c.people.map((p) => esc(p.name)).join('、') + '</div>';
          if (c.messages && c.messages.length) {
            d += '<div class="msgs">' + c.messages.map((m) => {
              if (m.type === 'date') return '<div class="m date">' + esc(m.text) + '</div>';
              if (m.type === 'skip') return '<div class="m date">⋯（略）⋯</div>';
              const who = m.side === 'right' ? '自己' : (names[m.personId] || m.personId || '對方');
              const what = m.kind && m.kind !== 'text'
                ? '［' + (KIND[m.kind] || m.kind)
                  + (m.imgDesc ? '：' + m.imgDesc : m.dur ? ' ' + m.dur : m.fname ? '：' + m.fname : '<b class="dead">：沒有描述</b>') + '］'
                : m.text;
              return '<div class="m ' + (m.side === 'right' ? 'r' : 'l') + '">'
                + '<span class="who">' + esc(who) + '</span>' + (m.kind && m.kind !== 'text' ? what : esc(what))
                + '<span class="t">' + esc(m.time || '') + (m.read ? '・' + esc(m.read) : '') + '</span></div>';
            }).join('') + '</div>';
          }
          return d;
        }).join('');
      } else {
        body = '<div class="hint">沒有呼叫工具，只回了文字：</div><pre class="script">' + esc(s.text || '(空)') + '</pre>';
      }
      row.innerHTML = '<div class="aghead"><b>第 ' + (i + 1) + ' 步</b>' + badge
        + '<span class="hint">' + secs(s.ms) + '</span>'
        + '<span class="hint acc">累計訊息 ' + acc + ' 則' + (added ? '（+' + added + '）' : '') + '</span></div>' + body;
      list.appendChild(row);
    });
  }

  // ── 美術指導 + 格盤切圖 ──
  function renderArt(r) {
    const box = $('artBox'); box.innerHTML = '';
    if (!r.art) {
      box.appendChild(el('p', 'hint', '這一次的劇本沒有需要補的圖，所以美術指導與生圖沒有出場。換上面「同事之間的日常吐槽」那一次可以看到。'));
      return;
    }
    let cells = [];
    try { cells = JSON.parse((r.art.text.match(/\[[\s\S]*\]/) || ['[]'])[0]); } catch (e) {}
    const two = el('div', 'two');
    const left = el('div');
    left.innerHTML = '<h3>美術指導寫的 prompt</h3><p class="hint">' + esc(r.art.model) + '，' + secs(r.art.ms)
      + '。規定每格 ≤80 字，因為那是要餵給生圖模型的。</p>'
      + (r.beforeFix
        ? '<div class="card danger"><p><b>這一次是 bug 修好之前錄的。</b>劇本裡明明寫著柴犬迷因圖、被 P 上柴犬臉的銀行截圖，'
          + '美術指導卻只能自己編出雪人和貓咪——因為它拿到的描述是空字串。往下看原因。</p></div>'
        : '<div class="card"><p><b>這一次是修好之後錄的。</b>對照左邊每一格跟劇本的描述，逐字對得上。</p></div>')
      + cells.map((c) => '<div class="card"><b>第 ' + c.cell + ' 格</b><br>' + esc(c.prompt) + '</div>').join('');
    const right = el('div');
    const gridSrc = r.grid || 'assets/grid.jpg';
    const cols = cells.length > 4 ? 3 : 2;
    right.innerHTML = '<h3>一次呼叫換回來的格盤</h3>'
      + '<figure><img src="' + gridSrc + '" alt="格盤原圖" loading="lazy">'
      + '<figcaption>生圖模型只被呼叫<b>一次</b>，回來的是這一張（' + cols + '×' + cols + ' 格，這次用到 '
      + cells.length + ' 格，其餘空著）。</figcaption></figure>'
      + '<div class="row"><button class="primary" id="btnCut">用程式碼切開它</button></div>'
      + '<div class="grid" id="cutOut"></div>';
    two.appendChild(left); two.appendChild(right);
    box.appendChild(two);
    $('btnCut').addEventListener('click', () => cut(cells, gridSrc, cols));
  }

  function cut(cells, src, cols) {
    const out = $('cutOut'); out.innerHTML = '';
    const img = new Image();
    img.onload = () => {
      const half = img.width / cols;
      for (let i = 0; i < cols * cols; i++) {
        const c = document.createElement('canvas');
        c.width = c.height = half;
        c.getContext('2d').drawImage(img, (i % cols) * half, ((i / cols) | 0) * half, half, half, 0, 0, half, half);
        const f = el('figure');
        f.appendChild(c);
        const spec = cells.find((x) => x.cell === i + 1);
        f.appendChild(el('figcaption', '', spec
          ? '<b>第 ' + (i + 1) + ' 格</b>　回填到劇本裡那一則訊息'
          : '<b>第 ' + (i + 1) + ' 格</b>　沒有用到'));
        out.appendChild(f);
      }
      out.insertAdjacentHTML('afterend', out.dataset.done ? '' : '');
      out.dataset.done = '1';
    };
    img.src = 'assets/grid.jpg';
  }
})();
