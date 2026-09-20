/* core.js 单测：node _test_core.js */
const fs = require('fs');
const path = require('path');
const Core = require(path.join(__dirname, '..', 'core.js'));

let fails = 0, passes = 0;
function ok(cond, msg) {
  if (cond) { passes++; } else { fails++; console.log('  ✗ ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

const SYS = path.join(__dirname, '..');        // 题库练习系统/
const DIR = path.join(SYS, '..');              // 题库文件夹
const bank = JSON.parse(fs.readFileSync(path.join(DIR, 'questions.json'), 'utf8'));
const items = bank.items;
console.log('题库:', items.length, '题');

// 1. 题库完整性
const c = Core.countByType(items);
eq(c.single, 600, '单选题 600'); eq(c.judge, 400, '判断题 400');
ok(items.every(x => x.type === 'single' ? (x.options.length === 4 && x.answer >= 0 && x.answer <= 3) : (x.answer === 0 || x.answer === 1)), '每题选项/答案合法');
ok(items.every(x => x.q && x.q.length > 2), '题干非空');
ok(items.every(x => x.type !== 'single' || x.options.every(o => o.length > 0)), '选项文本非空');

// 2. prepareItem：打乱选项后答案位置正确
const rand = Core.mulberry32(42);
const one = items[0];
const p = Core.prepareItem(one, rand, true);
eq(p.options.length, 4, '打乱后仍有 4 个选项');
eq(p.options[p.answerPos].text, one.options[one.answer], '打乱后 answerPos 指向正确文本');
eq(p.options.filter(o => o.correct).length, 1, '恰好一个正确项');
ok(Core.isCorrect(p, p.answerPos), '选正确答案判对');
ok(!Core.isCorrect(p, (p.answerPos + 1) % 4), '选错误答案判错');

// 3. 判断题
const j = items.find(x => x.type === 'judge');
const pj = Core.prepareItem(j, null, false);
eq(pj.options.length, 2, '判断题两个选项');
eq(pj.options[0].text, '正确', '判断题选项1');
eq(pj.options[1].text, '错误', '判断题选项2');
ok(Core.isCorrect(pj, j.answer), '判断题答案判定正确');
ok(!Core.isCorrect(pj, 1 - j.answer), '判断题反选判错');

// 4. gradePaper 计分
const paper = Core.preparePaper(items.slice(0, 10), { rand: Core.mulberry32(7), shuffleItems: false, shuffleOptions: false });
const answers = {};
paper.forEach((it, i) => { answers[it.id] = i < 6 ? it.answerPos : (it.answerPos + 1) % it.options.length; });
const g = Core.gradePaper(paper, answers);
eq(g.total, 10, '总题数'); eq(g.correct, 6, '正确 6'); eq(g.wrong, 4, '错误 4'); eq(g.blank, 0, '未答 0'); eq(g.score, 60, '得分 60');
const g2 = Core.gradePaper(paper.slice(0, 4), {});
eq(g2.blank, 4, '未答 4'); eq(g2.score, 0, '0 分');

// 5. 多选
const multiPaper = [{ id: 'M1', type: 'multi', q: 'x', options: [{ text: 'a' }, { text: 'b' }, { text: 'c' }], answerPositions: [0, 2].sort((a, b) => a - b) }];
ok(Core.isCorrect(multiPaper[0], [0, 2]), '多选全对');
ok(Core.isCorrect(multiPaper[0], [2, 0]), '多选顺序无关');
ok(!Core.isCorrect(multiPaper[0], [0]), '多选少选判错');
ok(!Core.isCorrect(multiPaper[0], [0, 1, 2]), '多选多选判错');
const gm = Core.gradePaper(multiPaper, { M1: [] });
eq(gm.blank, 1, '多选空选算未答');

// 6. 打乱/随机稳定性
const s1 = Core.shuffle([1, 2, 3, 4, 5, 6, 7, 8], Core.mulberry32(99));
const s2 = Core.shuffle([1, 2, 3, 4, 5, 6, 7, 8], Core.mulberry32(99));
ok(JSON.stringify(s1) === JSON.stringify(s2), '同种子洗牌结果一致');
ok(s1.slice().sort((a, b) => a - b).join() === '1,2,3,4,5,6,7,8', '洗牌不丢元素');
ok(Core.mulberry32(1)() !== Core.mulberry32(2)(), '不同种子不同序列');

// 7. 文本导入：本文库导出的 txt 往返
const txt = Core.toText(items.slice(0, 50));
const parsed = Core.parseImport(txt);
eq(parsed.errors.length, 0, '往返导入无错误: ' + JSON.stringify(parsed.errors.slice(0, 3)));
eq(parsed.items.length, 50, '往返导入 50 题');
let same = true;
for (let i = 0; i < 50; i++) {
  if (parsed.items[i].q !== items[i].q) { same = false; console.log('   题干不一致', i, parsed.items[i].q, items[i].q); break; }
  if (parsed.items[i].type !== items[i].type) { same = false; console.log('   题型不一致', i); break; }
  if (parsed.items[i].answer !== items[i].answer) { same = false; console.log('   答案不一致', i, parsed.items[i].answer, items[i].answer); break; }
  if (parsed.items[i].options.join('|') !== items[i].options.join('|')) { same = false; console.log('   选项不一致', i, parsed.items[i].options, items[i].options); break; }
}
ok(same, '往返内容完全一致（题干/选项/答案/题型）');

// 8. 导入各种常见格式
const t1 = ['1. 中国的首都是？', 'A.北京 B.上海 C.广州 D.深圳', '答案：A', '',
  '2、地球是圆的（）', '答案：√', '',
  '3. 以下哪些是编程语言？', 'A.JS', 'B.Python', 'C.HTML', 'D.C++', '正确答案：ABD'].join('\n');
const r1 = Core.parseImport(t1);
eq(r1.items.length, 3, '格式1 解析 3 题: ' + JSON.stringify(r1.errors));
eq(r1.items[0].type, 'single', '格式1 第1题单选'); eq(r1.items[0].answer, 0, '格式1 第1题答案A');
eq(r1.items[1].type, 'judge', '格式1 第2题判断'); eq(r1.items[1].answer, 0, '格式1 第2题√');
eq(r1.items[2].type, 'multi', '格式1 第3题多选'); eq(JSON.stringify(r1.items[2].answerSet), '[0,1,3]', '格式1 第3题 ABD');

const t2 = ['题干不带编号？', 'A.甲', 'B.乙', '答案：B', '', '第二题？', 'A.甲', 'B.乙', '答案：A'].join('\n');
const r2 = Core.parseImport(t2);
eq(r2.items.length, 2, '格式2 无编号 2 题: ' + JSON.stringify(r2.errors));
eq(r2.items[1].answer, 0, '格式2 第2题答案');

const t3 = JSON.stringify({ items: items.slice(0, 5) });
const r3 = Core.parseImport(t3);
eq(r3.items.length, 5, 'JSON 导入 5 题');
eq(r3.items[0].answer, items[0].answer, 'JSON 导入答案一致');

const t4 = ['1. 缺答案的题？', 'A.甲', 'B.乙'].join('\n');
const r4 = Core.parseImport(t4);
eq(r4.items.length, 0, '缺答案被跳过');
ok(r4.errors.length === 1, '缺答案报错 1 条');

console.log('\n通过 ' + passes + ' 项，失败 ' + fails + ' 项');
process.exit(fails ? 1 : 0);
