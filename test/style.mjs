/* test/style.mjs — 擋掉會上線的文字裡的老毛病。
   跑法:node test/style.mjs

   為什麼有這支:同一種毛病被指正過五次了 ——
     「管不住的事」「沒量到代價」「每一刀」「不是 X，是 Y」「量出來的、對自己不利的事」
   共通點是為了語氣而寫,不是為了傳達資訊:把腦子裡的比喻直接當詞用、
   用假對比製造洞見感、或替一個中性的東西加上戲劇性的形容。
   人記不住(已經證明五次了),所以改成每次跑測試就掃一遍。

   規則要能被推翻:確定某一處是必要的,在那一行後面加 <!-- style-ok --> 或 // style-ok。 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SKIP = new Set(['record', 'node_modules', '.git', 'test', 'vendor', 'data', 'assets']);

const RULES = [
  [/[^。！？\n]{0,26}不是[^。！？\n]{0,24}[，,][^。！？\n]{0,4}(?:是|而是)[^。！？\n]{0,20}/g,
    '「不是 X，是 Y」的假對比句型 —— 直接把 Y 講出來就好'],
  [/對自己不利/g, '沒有人要害誰。想講的是「實測發現的問題」'],
  [/管不住/g, '不是平常會講的話 —— 改「分辨不出來」之類的白話'],
  [/沒量到代價/g, '自造詞 —— 直接寫「擔心的那幾件事量完都沒發生」'],
  [/[每這那]一刀/g, '把比喻當詞用 —— 改「每一個分工」'],
  [/最漂亮的一(?:刀|招)/g, '同上'],
  [/(?:真正|其實)的[^。，、\n]{2,10}(?:不在|不是)/g, '同樣是假對比的變體'],
];

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(html|md)$/.test(name)) files.push(p);
  }
})(ROOT);

let bad = 0;
for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  const lines = raw.split('\n');
  const text = raw.replace(/<[^>]+>/g, '');       // 標籤不算文字
  for (const [re, why] of RULES) {
    for (const m of text.matchAll(re)) {
      const snippet = m[0].trim();
      if (!snippet) continue;
      // 找出它在第幾行,順便看那一行有沒有標「這裡是刻意的」
      const li = lines.findIndex((l) => l.replace(/<[^>]+>/g, '').includes(snippet.slice(0, 12)));
      if (li >= 0 && /style-ok/.test(lines[li])) continue;
      bad++;
      console.log('  ✗ ' + f.replace(ROOT + '/', '') + (li >= 0 ? ':' + (li + 1) : '')
        + '\n      ' + snippet.slice(0, 56) + '\n      → ' + why);
    }
  }
}
console.log('\n掃了 ' + files.length + ' 個會上線的檔案');
console.log(bad ? bad + ' 處要改' : '沒有踩到已知的老毛病。');
process.exit(bad ? 1 : 0);
