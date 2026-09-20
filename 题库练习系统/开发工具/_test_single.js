/* 对真实生成的单文件 HTML 做冒烟测试（从磁盘直接加载） */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('D:/juice/tools/jsdom-test/node_modules/jsdom');

const FILE = path.join(__dirname, '..', '..', '服务机器人练习题库.html');
let passes = 0, fails = 0;
const ok = (c, m) => { c ? passes++ : (fails++, console.log('  ✗ ' + m)); };
const eq = (a, b, m) => ok(a === b, m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async function () {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/not implemented/i.test(e.message)) errs.push(e.message); });
  vc.on('error', (...a) => errs.push(a.join(' ')));

  const html = fs.readFileSync(FILE, 'utf8');
  ok(html.indexOf('<script src=') < 0, '单文件版不含外部脚本引用');
  ok(html.length > 100000, '单文件内含题库数据');

  const dom = new JSDOM(html, { url: 'https://qb.local/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
  const win = dom.window, doc = win.document;
  win.confirm = () => true; win.scrollTo = () => {};
  const API = win.__QBAPP;
  const $ = s => doc.querySelector(s);
  const $$ = s => Array.prototype.slice.call(doc.querySelectorAll(s));
  const click = el => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));

  ok(!!API, '单文件版应用启动');
  eq(API.app.bank.items.length, 1000, '单文件版内置 1000 题');
  ok(doc.body.textContent.indexOf('题库练习系统') >= 0, '首页渲染');

  API.app.settings.autoNext = false;
  click(doc.querySelector('[data-act="start"][data-mode="order"]'));
  eq(API.ui.view, 'quiz', '可进入练习');
  const it = API.quiz.paper[0];
  click($$('.opt')[it.answerPos]);
  ok(!!$('.fb.ok'), '答题判分正常');
  eq(Object.keys(API.app.progress).length, 1, '进度写入');

  // 模拟考试全流程
  API.startQuiz('exam');
  eq(API.quiz.paper.length, 100, '考试 100 题');
  const i0 = API.quiz.paper.findIndex(q => q.type === 'single');
  API.quiz.idx = i0; API.render();
  click($$('.opt')[API.quiz.paper[i0].answerPos]);
  click(doc.querySelector('[data-act="submit"]'));
  eq(API.ui.view, 'result', '交卷进入成绩页');
  eq(API.quiz.result.correct, 1, '判卷正确 1 题');

  // 导入 → 恢复
  API.ui.view = 'import'; API.render();
  const ta = $('#import-text');
  ta.value = '1. 甲？\nA.一\nB.二\n答案：B';
  ta.dispatchEvent(new win.Event('input', { bubbles: true }));
  click(doc.querySelector('[data-act="parse"]'));
  click(doc.querySelector('[data-act="apply-import"]'));
  eq(API.app.bank.items.length, 1, '导入 1 题生效');
  API.ui.view = 'import'; API.render();          // 导入后应用会回到首页，这里切回导入页
  click(doc.querySelector('[data-act="restore-builtin"]'));
  eq(API.app.bank.items.length, 1000, '恢复内置题库');

  eq(errs.length, 0, '无 JS 错误：' + JSON.stringify(errs.slice(0, 2)));
  console.log('\n单文件版：通过 ' + passes + ' 项，失败 ' + fails + ' 项');
  win.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('崩溃：', e); process.exit(2); });
