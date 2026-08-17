/* test/no-leak.mjs — 會上線的檔案裡不准有只該留在內部的東西。
   跑法:node test/no-leak.mjs

   為什麼有這支:這個 repo 的內容是從「錄下來的原始 API 往返」和「別人的原始碼註解」
   直接整理出來的,那裡面本來就混著不該對外的東西。已經犯過兩次:

     1. 「站在誰的肩膀上」寫了「參考來源是 zerotype-agent」——那是程式碼註解裡的
        內部備忘,讀者查不到,還會誤以為這套設計是抄某個產品的
     2. data/runs.json 帶著自架生圖服務的網址(內部 DDNS 網域)

   共同的錯是同一個:把內部的東西原封不動搬到對外的頁面上。
   人記不住,所以改成每次跑測試都掃一遍。 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
// 只掃「會被 GitHub Pages 送出去」的東西;record/ 是原始錄製檔,留在 repo 但不上線
const SKIP = new Set(['record', 'node_modules', '.git', 'test']);

const RULES = [
  [/ching-tech|ddns\.net/i, '自架服務的內部網域'],
  [/\b192\.168\.\d+\.\d+\b/, '內網 IP'],
  [/\/home\/[a-z]+\//i, '本機絕對路徑'],
  [/\bzerotype\b/i, '只有內部看得懂的出處(讀者查不到)'],
  [/\bBearer\s+[A-Za-z0-9._-]{12,}/, '存活的 token'],
  [/\bsk-[A-Za-z0-9]{16,}\b/, 'OpenAI 形式的金鑰'],
  [/\bAIza[A-Za-z0-9_-]{20,}\b/, 'Google 形式的金鑰'],
  [/\bimg_[0-9a-f]{20,}\b/, '生圖服務的 job id'],
];

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(html|js|mjs|css|json|md|txt)$/.test(name)) files.push(p);
  }
})(ROOT);

let bad = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const [re, why] of RULES) {
    const m = text.match(re);
    if (!m) continue;
    bad++;
    console.log('  ✗ ' + f.replace(ROOT + '/', '') + '　' + why + '　→ ' + JSON.stringify(m[0].slice(0, 60)));
  }
}
console.log('\n掃了 ' + files.length + ' 個會上線的檔案');
console.log(bad ? bad + ' 處要清掉' : '沒有內部資訊外流。');
process.exit(bad ? 1 : 0);
