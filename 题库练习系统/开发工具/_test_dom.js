/* DOM 端到端测试：用 jsdom 加载真实页面，模拟点击/键盘，校验状态与渲染 */
const fs = require('fs');
const path = require('path');
const JSDOM_PATH = 'D:/juice/tools/jsdom-test/node_modules/jsdom';
const { JSDOM, VirtualConsole } = require(JSDOM_PATH);

const SYS = path.join(__dirname, '..');        // 题库练习系统/
const DIR = path.join(SYS, '..');              // 题库文件夹
let passes = 0, fails = 0;
function ok(cond, msg) { if (cond) { passes++; } else { fails++; console.log('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 内联三个脚本，得到单文件等价页面（同时验证单文件构建方案）
function buildHtml() {
  let html = fs.readFileSync(path.join(SYS, 'index.html'), 'utf8');
  ['core.js', 'bank.js', 'app.js'].forEach(f => {
    const code = fs.readFileSync(path.join(SYS, f), 'utf8');
    html = html.replace('<script src="' + f + '"></script>', '<script>\n' + code + '\n</script>');
  });
  if (/<script src=/.test(html)) throw new Error('脚本内联失败');
  return html;
}

(async function main() {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/not implemented/i.test(e.message)) errs.push('jsdomError: ' + e.message); });
  vc.on('error', (...a) => errs.push('console.error: ' + a.join(' ')));

  const html = buildHtml();
  const dom = new JSDOM(html, {
    url: 'https://qb.local/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc
  });
  const win = dom.window, doc = win.document;
  win.confirm = () => true;               // 自动确认所有弹窗
  win.scrollTo = () => {};
  const $ = sel => doc.querySelector(sel);
  const $$ = sel => Array.prototype.slice.call(doc.querySelectorAll(sel));
  const body = () => doc.body.textContent;
  const click = el => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })); };
  const byAct = (act, root) => (root || doc).querySelector('[data-act="' + act + '"]');
  const allAct = act => $$('[data-act="' + act + '"]');
  const key = k => doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true }));

  const API = win.__QBAPP;
  ok(!!API, '应用已初始化（window.__QBAPP 存在）');
  const app = API.app, CORE = win.QCore, BANK = win.QBANK;

  /* ---------- 1. 首页 ---------- */
  eq(body().indexOf('题库练习系统') >= 0, true, '首页标题渲染');
  eq(body().indexOf('共 1000 题') >= 0, true, '首页显示题库总量 1000 题');
  eq(allAct('start').length, 7, '首页 7 个练习入口');
  eq(app.bank.items.length, 1000, '内置题库 1000 题');

  /* ---------- 2. 顺序练习 ---------- */
  app.settings.autoNext = false;   // 关掉自动跳题，便于断言
  click(byAct('start'));
  eq(API.ui.view, 'quiz', '进入练习页');
  const it0 = app.bank.items[0];
  eq($('.stem').textContent.indexOf(it0.q) >= 0, true, '第 1 题题干正确');
  eq($$('.opt').length, 4, '单选题渲染 4 个选项');
  eq($$('.opt')[0].textContent.indexOf(it0.options[0]) >= 0, true, '选项文本正确');
  eq($$('.opt')[0].querySelector('.k').textContent, 'A', '选项标号 A');

  /* ---------- 3. 答对 ---------- */
  click($$('.opt')[it0.answer]);
  eq(!!$('.fb.ok'), true, '答对显示绿色反馈');
  eq($('.fb.ok').textContent.indexOf('回答正确') >= 0, true, '反馈文案=回答正确');
  eq(app.progress[it0.id].ok, 1, '答对写入进度记录');
  eq(app.stats.total, 1, '累计作答 +1');
  eq(Object.keys(app.wrong).length, 0, '答对不进错题本');

  /* ---------- 4. 答错 + 错题本 ---------- */
  click(byAct('next'));
  const it1 = API.quiz.paper[API.quiz.idx];
  const wrongIdx = (it1.answerPos + 1) % it1.options.length;
  click($$('.opt')[wrongIdx]);
  eq(!!$('.fb.bad'), true, '答错显示红色反馈');
  eq($('.fb.bad').textContent.indexOf('正确答案') >= 0, true, '答错展示正确答案');
  eq(app.wrong[it1.id], 1, '答错进错题本');
  eq(app.progress[it1.id].ok, 0, '答错记录为错');

  /* ---------- 5. 答题卡 ---------- */
  click(byAct('sheet'));
  eq(!!$('.mask'), true, '答题卡弹出');
  const nums = $$('.nums button');
  eq(nums.length, 1000, '答题卡 1000 个题号');
  eq(nums.filter(n => n.classList.contains('ok')).length, 1, '答题卡标绿 1 题');
  eq(nums.filter(n => n.classList.contains('bad')).length, 1, '答题卡标红 1 题');
  click(nums[7]);
  eq(API.quiz.idx, 7, '答题卡跳转到第 8 题');
  eq(!!$('.mask'), false, '跳转后答题卡关闭');
  click(byAct('sheet')); click($('.sheet'));
  eq(!!$('.mask'), true, '点击面板内部不关闭答题卡');
  click($('.mask'));
  eq(!!$('.mask'), false, '点击遮罩关闭答题卡');

  /* ---------- 6. 键盘快捷键 ---------- */
  API.quiz.idx = 10;
  key('a');
  const it10 = API.quiz.paper[10];
  ok(it10.type === 'judge' ? true : API.quiz.answers[it10.id] === 0, '键盘 A 选中第 1 项');
  API.quiz.idx = 20; win.__QBAPP.render();
  key('ArrowRight');
  eq(API.quiz.idx, 21, '键盘 → 下一题');
  key('ArrowLeft');
  eq(API.quiz.idx, 20, '键盘 ← 上一题');

  /* ---------- 7. 收藏 / 查看答案 ---------- */
  const cur = API.quiz.paper[API.quiz.idx];
  click(byAct('fav'));
  eq(app.fav[cur.id], 1, '收藏成功');
  click(byAct('reveal'));
  eq(!!$('.fb.neutral'), true, '查看答案显示中立提示');
  eq(API.quiz.checked[cur.id], undefined, '查看答案不计入作答');
  eq(app.progress[cur.id], undefined, '查看答案不写进度');

  /* ---------- 8. 背题模式 ---------- */
  API.ui.view = 'home'; API.render();
  click(allAct('start').find(b => b.getAttribute('data-mode') === 'recite'));
  eq(API.ui.view, 'quiz', '进入背题模式');
  eq(!!$('.fb.neutral'), true, '背题模式直接显示答案');
  const before = Object.keys(app.progress).length;
  click(byAct('recite-ok'));
  eq(Object.keys(app.progress).length, before + 1, '「我记住了」写入进度');
  eq(API.quiz.idx, 1, '背题模式自动下一题');
  click(byAct('recite-bad'));
  eq(Object.keys(app.wrong).length >= 1, true, '「没记住」进错题本');

  /* ---------- 9. 错题本模式 + 答对移出 ---------- */
  API.ui.view = 'home'; API.render();
  click(allAct('start').find(b => b.getAttribute('data-mode') === 'wrong'));
  eq(API.quiz.paper.length, Object.keys(app.wrong).length, '错题本抽题数 = 错题数');
  const wid = API.quiz.paper[0];
  const wrongKeyCount = Object.keys(app.wrong).length;
  click($$('.opt')[wid.answerPos]);
  eq(Object.keys(app.wrong).length, wrongKeyCount - 1, '错题本内答对即移出错题本');

  /* ---------- 10. 模拟考试 ---------- */
  API.ui.view = 'home'; API.render();
  click(allAct('start').find(b => b.getAttribute('data-mode') === 'exam'));
  eq(API.quiz.paper.length, 100, '模拟考试默认 100 题');
  eq(!!$('#timer'), true, '考试页显示计时器');
  const types = { single: 0, multi: 0, judge: 0 };
  API.quiz.paper.forEach(x => types[x.type]++);
  eq(types.single, 80, '考卷单选 80 题');
  eq(types.judge, 20, '考卷判断 20 题');
  const statsBefore = app.stats.total;
  const examIdxs = [];
  API.quiz.paper.forEach((q, i) => { if (q.type === 'single' && examIdxs.length < 5) examIdxs.push(i); });
  examIdxs.forEach(i => {                              // 故意答对 5 道单选题
    API.quiz.idx = i; API.render();
    click($$('.opt')[API.quiz.paper[i].answerPos]);
  });
  eq(API.quiz.checked[API.quiz.paper[0].id], undefined, '考试模式不即时判分');
  click(byAct('submit'));
  eq(API.ui.view, 'result', '交卷后进入成绩页');
  eq(API.quiz.result.correct, 5, '判卷答对 5 题');
  eq(API.quiz.result.blank, 95, '判卷未答 95 题');
  eq(API.quiz.result.total, 100, '判卷总题数 100');
  eq(API.quiz.result.score, 5, '得分 5 分');
  eq($('.score b').textContent, '5', '成绩页显示得分');
  eq(body().indexOf('错题回顾（95）') >= 0, true, '成绩页列出 95 道错题');
  eq(app.stats.total, statsBefore + 5, '交卷后累计作答按实际答题数增加');

  /* ---------- 11. 统计页 ---------- */
  API.ui.view = 'home'; API.render();
  click(allAct('nav').find(b => b.getAttribute('data-view') === 'stats'));
  eq(body().indexOf('学习统计') >= 0, true, '统计页渲染');
  eq(body().indexOf('分题型掌握情况') >= 0, true, '统计页有分题型统计');

  /* ---------- 12. 设置与持久化 ---------- */
  API.ui.view = 'home'; API.render();
  click(allAct('nav').find(b => b.getAttribute('data-view') === 'settings'));
  click(doc.querySelector('[data-act="toggle"][data-key="night"]'));
  eq(doc.body.className.indexOf('night') >= 0, true, '夜间模式切换生效');
  const raw = win.localStorage.getItem('qbapp.state.v1');
  ok(!!raw, '状态已写入 localStorage');
  const savedState = JSON.parse(raw);
  eq(savedState.settings.night, true, '设置持久化（night=true）');
  ok(Object.keys(savedState.progress).length > 0, '进度持久化');
  eq(savedState.wrong && Object.keys(savedState.wrong).length > 0, true, '错题本持久化');
  click(doc.querySelector('[data-act="toggle"][data-key="night"]'));
  eq(doc.body.className.indexOf('night') < 0, true, '夜间模式可关闭');
  const fontInput = $('#set-font');
  fontInput.value = '20';
  fontInput.dispatchEvent(new win.Event('change', { bubbles: true }));
  eq(app.settings.fontSize, 20, '字号设置生效');

  /* ---------- 13. 导入题库（粘贴文本） ---------- */
  API.ui.view = 'home'; API.render();
  click(allAct('nav').find(b => b.getAttribute('data-view') === 'import'));
  const ta = $('#import-text');
  ok(!!ta, '导入页有文本框');
  ta.value = ['1. 中国的首都是？', 'A.北京 B.上海 C.广州 D.深圳', '答案：A', '',
    '2. 地球是圆的（）', '答案：√', '',
    '3. 以下哪些是编程语言？', 'A.JS', 'B.Python', 'C.HTML', 'D.C++', '正确答案：ABD'].join('\n');
  ta.dispatchEvent(new win.Event('input', { bubbles: true }));
  ok(byAct('apply-import').hasAttribute('disabled'), '未解析前「确认导入」不可点');
  click(byAct('parse'));
  eq(body().indexOf('解析到 3 题') >= 0, true, '解析预览显示 3 题');
  ok(!byAct('apply-import').hasAttribute('disabled'), '解析后「确认导入」可点');
  eq($('#import-text').value.indexOf('中国的首都') >= 0, true, '重渲染后文本框内容保留');
  click(byAct('apply-import'));
  eq(app.bank.items.length, 3, '导入后题库替换为 3 题');
  eq(win.localStorage.getItem('qbapp.bank.v1') !== null, true, '导入题库已持久化');
  eq(API.ui.view, 'home', '导入后回到首页');
  eq(body().indexOf('共 3 题') >= 0, true, '首页显示新题库题量');

  /* ---------- 14. 文件导入 ---------- */
  click(allAct('nav').find(b => b.getAttribute('data-view') === 'import'));
  const f = new win.File(['1. 测试题？\nA.甲\nB.乙\n答案：B'], 't.txt', { type: 'text/plain' });
  const input = $('#import-file');
  Object.defineProperty(input, 'files', { value: [f], configurable: true });
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
  await sleep(60);
  eq(API.ui.importPreview.items.length, 1, '文件导入解析 1 题');
  eq(API.ui.importPreview.items[0].answer, 1, '文件导入答案 B 正确');

  /* ---------- 15. 恢复内置题库 ---------- */
  click(byAct('restore-builtin'));
  eq(app.bank.items.length, 1000, '恢复内置题库 1000 题');
  eq(API.ui.view, 'import', '恢复后仍停留在导入页');

  /* ---------- 16. 全量渲染冒烟（1000 题逐题渲染） ---------- */
  let renderBad = 0, firstBad = '';
  API.quiz = null;
  API.startQuiz('order');
  const paper = API.quiz.paper;
  eq(paper.length, 1000, '顺序练习队列 1000 题');
  for (let i = 0; i < paper.length; i++) {
    API.quiz.idx = i;
    API.render();
    const stem = $('.stem').textContent;
    const opts = $$('.opt');
    const it = paper[i];
    const wantOpts = it.options.length;
    if (stem.indexOf(it.q) < 0 || opts.length !== wantOpts) {
      renderBad++; if (!firstBad) firstBad = '第 ' + (i + 1) + ' 题 题干/选项数异常（' + opts.length + ' vs ' + wantOpts + '）';
    }
  }
  eq(renderBad, 0, '1000 题全部渲染正常 ' + firstBad);

  /* ---------- 17. 无脚本错误 ---------- */
  eq(errs.length, 0, '无 JS 错误：' + JSON.stringify(errs.slice(0, 3)));

  console.log('\n通过 ' + passes + ' 项，失败 ' + fails + ' 项');
  win.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('测试崩溃：', e); process.exit(2); });
