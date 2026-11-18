// 生成 pinyin_v4.json：v4 样例里每个汉字单独送进 pinyin-pro 得到的无调拼音。
// App 判押韵时就是一个字一个字取韵母（src/core/rhymeRules.ts finalOfChar → analyze(单字)），所以这里也逐字取，不带上下文。
// 用法：node design/fixtures_v34/gen_pinyin.mjs <pinyin-pro 包目录> design/fixtures_v34
// 本仓库这一次用的是 pinyin-pro 3.29.5（package.json 里锁的版本）。
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const [pkg, dir] = process.argv.slice(2);
const { pinyin } = require(pkg);
const version = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version;
const doc = JSON.parse(fs.readFileSync(path.join(dir, 'koi_zh_lyrics_v4_nopickup.anybeats'), 'utf8'));
const chars = new Set();
for (const s of doc.sections) for (const b of s.bars) for (const w of b.words) for (const c of Array.from(w.text)) chars.add(c);
for (const c of '摇愿远弯完忘月略云用翁儿日心星人东') chars.add(c);
const table = {};
for (const c of [...chars].sort()) table[c] = pinyin(c, { toneType: 'none', type: 'array' })[0];
fs.writeFileSync(path.join(dir, 'pinyin_v4.json'), JSON.stringify({ source: `pinyin-pro ${version}，逐字、无调`, table }, null, 0) + '\n');
console.log(`${Object.keys(table).length} 个字 · pinyin-pro ${version}`);
