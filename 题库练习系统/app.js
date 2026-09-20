/* 题库练习系统 —— 界面层（离线可用，无外部依赖） */
(function () {
  'use strict';
  var Core = window.QCore;
  var BUILTIN = window.QBANK || { title: '题库', items: [] };
  var KEY_STATE = 'qbapp.state.v1';
  var KEY_BANK = 'qbapp.bank.v1';
  var root = document.getElementById('app');

  /* ---------- 存储 ---------- */
  var store;
  try {
    window.localStorage.setItem('__t', '1');
    window.localStorage.removeItem('__t');
    store = window.localStorage;
  } catch (e) {
    var mem = {};
    store = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; }
    };
  }

  function defaultState() {
    return {
      progress: {}, wrong: {}, fav: {},
      settings: {
        shuffleOptions: false, night: false, autoNext: true, fontSize: 16,
        examSingle: 80, examJudge: 20, examMinutes: 100, removeOnCorrect: true
      },
      stats: { total: 0, correct: 0 },
      last: null
    };
  }
  function loadJson(key, dft) {
    var raw = store.getItem(key);
    if (!raw) return dft;
    try { var o = JSON.parse(raw); return (o && typeof o === 'object') ? o : dft; } catch (e) { return dft; }
  }
  function saveState() { try { store.setItem(KEY_STATE, JSON.stringify(app)); } catch (e) {} }
  function saveBank() { try { store.setItem(KEY_BANK, JSON.stringify({ title: app.bank.title, items: app.bank.items, source: app.bank.source })); } catch (e) {} }

  /* ---------- 状态 ---------- */
  var bankStore = loadJson(KEY_BANK, null);
  var app = defaultState();
  var saved = loadJson(KEY_STATE, null);
  if (saved) {
    app.progress = saved.progress || {};
    app.wrong = saved.wrong || {};
    app.fav = saved.fav || {};
    app.stats = saved.stats || app.stats;
    app.last = saved.last || null;
    var st = saved.settings || {};
    for (var k in app.settings) { if (st[k] !== undefined) app.settings[k] = st[k]; }
  }
  app.bank = (bankStore && bankStore.items && bankStore.items.length)
    ? { title: bankStore.title || '导入题库', items: bankStore.items, source: bankStore.source || 'import' }
    : { title: BUILTIN.title || '题库', items: (BUILTIN.items || []).slice(), source: 'builtin' };

  var ui = { view: 'home', sheet: false, toast: '', toastTimer: null, importText: '', importPreview: null, renderedQi: -1 };
  var quiz = null;

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg) {
    ui.toast = msg;
    if (ui.toastTimer) clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(function () { ui.toast = ''; render(); }, 2000);
  }
  function types() { return Core.countByType(app.bank.items); }
  function idsByType(t) { return app.bank.items.filter(function (x) { return x.type === t; }); }
  function byId(id) {
    for (var i = 0; i < app.bank.items.length; i++) { if (app.bank.items[i].id === id) return app.bank.items[i]; }
    return null;
  }
  function pct(a, b) { return b ? Math.round(a / b * 1000) / 10 : 0; }
  function fmtTime(ms) {
    if (ms < 0) ms = 0;
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
    s = s % 60; m = m % 60;
    function p(x) { return (x < 10 ? '0' : '') + x; }
    return (h > 0 ? p(h) + ':' : '') + p(m) + ':' + p(s);
  }
  function answerText(it, picked) {
    if (it.type === 'multi') {
      var arr = (picked || []).slice().sort(function (a, b) { return a - b; });
      if (!arr.length) return '（未作答）';
      return arr.map(function (i) { return Core.LETTERS[i] + '．' + it.options[i].text; }).join('；');
    }
    if (picked === undefined || picked === null) return '（未作答）';
    return Core.LETTERS[picked] + '．' + it.options[picked].text;
  }
  function rightAnswerText(it) {
    var arr = it.type === 'multi' ? it.answerPositions : [it.answerPos];
    return arr.map(function (i) { return Core.LETTERS[i] + '．' + it.options[i].text; }).join('；');
  }
  function isAnswered(it, picked) {
    if (picked === undefined || picked === null) return false;
    if (it.type === 'multi') return Array.isArray(picked) && picked.length > 0;
    return typeof picked === 'number';
  }
  function todayCount() {
    var d = new Date(); d.setHours(0, 0, 0, 0);
    var t0 = d.getTime(), n = 0;
    for (var id in app.progress) { if ((app.progress[id].t || 0) >= t0) n++; }
    return n;
  }

  /* ---------- 建立练习会话 ---------- */
  function poolFor(mode) {
    var items = app.bank.items;
    if (mode === 'wrong') return items.filter(function (x) { return app.wrong[x.id]; });
    if (mode === 'fav') return items.filter(function (x) { return app.fav[x.id]; });
    if (mode === 'unanswered') return items.filter(function (x) { return !app.progress[x.id]; });
    if (mode === 'random') return items.slice();
    return items.slice();
  }
  function startQuiz(mode) {
    var rand = Core.mulberry32((Date.now() % 2147483647) ^ (Math.random() * 1e9 | 0));
    var pool, paper, exam = mode === 'exam';
    if (exam) {
      var s = app.settings.examSingle | 0, j = app.settings.examJudge | 0, m = app.settings.examMulti | 0;
      var sin = Core.shuffle(idsByType('single'), rand).slice(0, s || 0);
      var jud = Core.shuffle(idsByType('judge'), rand).slice(0, j || 0);
      var mul = Core.shuffle(idsByType('multi'), rand).slice(0, m || 0);
      paper = Core.preparePaper(sin.concat(mul, jud), { rand: rand, shuffleItems: true, shuffleOptions: app.settings.shuffleOptions });
      if (!paper.length) { toast('题库为空，无法生成试卷'); return; }
    } else {
      pool = poolFor(mode);
      if (!pool.length) {
        toast(mode === 'wrong' ? '错题本是空的，先去练习吧' : mode === 'fav' ? '还没有收藏题目' :
          mode === 'unanswered' ? '所有题目都做过了' : '题库为空');
        return;
      }
      paper = Core.preparePaper(pool, {
        rand: rand, shuffleItems: mode === 'random' || mode === 'recite',
        shuffleOptions: app.settings.shuffleOptions
      });
    }
    quiz = {
      mode: mode, paper: paper, answers: {}, checked: {}, revealed: {},
      idx: 0, startTs: Date.now(), submitted: false, result: null,
      endTs: (exam && (app.settings.examMinutes | 0) > 0) ? Date.now() + (app.settings.examMinutes | 0) * 60000 : 0
    };
    ui.view = 'quiz';
    ui.renderedQi = -1;
    ui.sheet = false;
    render();
    window.scrollTo(0, 0);
  }

  function countDone() {
    if (!quiz) return 0;
    var n = 0;
    quiz.paper.forEach(function (it) { if (isAnswered(it, quiz.answers[it.id])) n++; });
    return n;
  }
  function countGraded() {
    if (!quiz) return 0;
    var n = 0;
    quiz.paper.forEach(function (it) { if (quiz.checked[it.id]) n++; });
    return n;
  }

  function recordAnswer(it, picked) {
    var ok = Core.isCorrect(it, picked);
    app.progress[it.id] = { c: picked, ok: ok ? 1 : 0, t: Date.now() };
    app.stats.total++;
    if (ok) {
      app.stats.correct++;
      if (quiz.mode === 'wrong' && app.settings.removeOnCorrect && app.wrong[it.id]) {
        delete app.wrong[it.id];
        toast('答对了，已从错题本移出');
      }
    } else {
      app.wrong[it.id] = 1;
    }
    saveState();
    return ok;
  }

  function pickOption(i) {
    if (!quiz) return;
    var it = quiz.paper[quiz.idx];
    if (quiz.mode === 'recite') return;
    var graded = quiz.mode !== 'exam' && quiz.checked[it.id];
    if (graded) return;
    if (it.type === 'multi') {
      var cur = (quiz.answers[it.id] || []).slice();
      var at = cur.indexOf(i);
      if (at >= 0) cur.splice(at, 1); else cur.push(i);
      quiz.answers[it.id] = cur;
      if (quiz.mode !== 'exam' && app.settings.instantMulti === false) { /* noop */ }
      render();
      return;
    }
    quiz.answers[it.id] = i;
    if (quiz.mode !== 'exam') {
      quiz.checked[it.id] = true;
      recordAnswer(it, i);
      render();
      maybeAutoNext();
    } else {
      render();
    }
  }

  function confirmMulti() {
    var it = quiz.paper[quiz.idx];
    var picked = quiz.answers[it.id];
    if (!picked || !picked.length) { toast('请先选择答案'); return; }
    quiz.checked[it.id] = true;
    recordAnswer(it, picked);
    render();
    maybeAutoNext();
  }

  function maybeAutoNext() {
    if (!app.settings.autoNext || !quiz || quiz.mode === 'exam') return;
    setTimeout(function () {
      if (!quiz || quiz.mode === 'exam') return;
      if (quiz.idx < quiz.paper.length - 1) {
        quiz.idx++;
        saveLastPos();
        render();
        window.scrollTo(0, 0);
      } else {
        render();
      }
    }, 650);
  }

  function saveLastPos() {
    if (!quiz) return;
    app.last = { mode: quiz.mode, idx: quiz.idx, ts: Date.now(), title: app.bank.title };
    saveState();
  }

  function go(delta) {
    if (!quiz) return;
    var n = quiz.idx + delta;
    if (n < 0) { toast('已经是第一题'); return; }
    if (n >= quiz.paper.length) { toast('已经是最后一题'); if (quiz.mode === 'exam') { /* keep */ } return; }
    quiz.idx = n;
    saveLastPos();
    ui.renderedQi = -1;
    render();
    window.scrollTo(0, 0);
  }

  function submitExam(auto) {
    if (!quiz || quiz.submitted) return;
    quiz.result = Core.gradePaper(quiz.paper, quiz.answers);
    quiz.submitted = true;
    quiz.paper.forEach(function (it) {
      var picked = quiz.answers[it.id];
      if (!isAnswered(it, picked)) return;
      app.progress[it.id] = { c: picked, ok: Core.isCorrect(it, picked) ? 1 : 0, t: Date.now() };
      app.stats.total++;
      if (Core.isCorrect(it, picked)) app.stats.correct++;
      else app.wrong[it.id] = 1;
    });
    saveState();
    ui.view = 'result';
    render();
    window.scrollTo(0, 0);
    if (auto) toast('时间到，已自动交卷');
  }

  /* ---------- 视图 ---------- */
  function topbarNav(active) {
    function b(label, view) {
      return '<button class="pill" data-act="nav" data-view="' + view + '"' + (active === view ? ' style="color:var(--brand);font-weight:600"' : '') + '>' + label + '</button>';
    }
    return '<div class="topbar spread">' +
      '<div class="row" style="flex-wrap:wrap">' + b('首页', 'home') + b('统计', 'stats') + b('导入题库', 'import') + b('设置', 'settings') + '</div>' +
      '</div>';
  }

  function viewHome() {
    var t = types(), total = app.bank.items.length;
    var done = Object.keys(app.progress).length;
    var acc = app.stats.total ? pct(app.stats.correct, app.stats.total) : 0;
    var html = '';
    html += '<div class="hero"><h1>题库练习系统</h1><p class="sub">' + esc(app.bank.title) + '</p>' +
      '<p class="sub" style="margin-top:6px">共 ' + total + ' 题' +
      (t.single ? ' · 单选 ' + t.single : '') + (t.multi ? ' · 多选 ' + t.multi : '') + (t.judge ? ' · 判断 ' + t.judge : '') +
      '</p></div>';
    html += '<div class="grid">' +
      modeCard('order', '顺序练习', '按题号逐题练习') +
      modeCard('random', '随机练习', '打乱顺序，随时抽题') +
      modeCard('recite', '背题模式', '直接看答案，快速过题') +
      modeCard('exam', '模拟考试', '限时抽题，交卷评分') +
      modeCard('wrong', '错题本', '答错的题集中重做', Object.keys(app.wrong).length) +
      modeCard('fav', '我的收藏', '收藏的重点题', Object.keys(app.fav).length) +
      modeCard('unanswered', '未做题目', '优先做没做过的题', Math.max(total - done, 0)) +
      '</div>';
    html += '<div class="card"><div class="kv">' +
      '<div class="kvi"><b>' + done + '</b><span>已练题目 / ' + total + '</span></div>' +
      '<div class="kvi"><b>' + acc + '%</b><span>正确率（' + app.stats.correct + '/' + app.stats.total + '）</span></div>' +
      '<div class="kvi"><b>' + todayCount() + '</b><span>今日作答</span></div>' +
      '<div class="kvi"><b>' + Object.keys(app.wrong).length + '</b><span>错题</span></div>' +
      '</div>';
    if (app.last) {
      html += '<div style="margin-top:12px" class="row spread">' +
        '<span class="sub">上次：' + esc(modeName(app.last.mode)) + ' 第 ' + ((app.last.idx | 0) + 1) + ' 题</span>' +
        '<button class="btn mini" data-act="resume">继续练习</button></div>';
    }
    html += '</div>';
    html += topbarNav('home');
    return html;
  }
  function modeName(m) {
    return { order: '顺序练习', random: '随机练习', recite: '背题模式', exam: '模拟考试', wrong: '错题本', fav: '我的收藏', unanswered: '未做题目' }[m] || m;
  }
  function modeCard(mode, title, desc, badge) {
    return '<button class="mode" data-act="start" data-mode="' + mode + '">' +
      (badge ? '<span class="badge">' + badge + '</span>' : '') +
      '<span class="t">' + title + '</span><span class="d">' + desc + '</span></button>';
  }

  function viewQuiz() {
    var it = quiz.paper[quiz.idx];
    var total = quiz.paper.length;
    var picked = quiz.answers[it.id];
    var graded = quiz.mode !== 'exam' && !!quiz.checked[it.id];
    var reveal = quiz.mode === 'recite' || !!quiz.revealed[it.id];
    var showAns = graded || reveal;
    var done = countDone();
    var html = '';

    html += '<div class="topbar">' +
      '<button class="pill" data-act="quit">← 首页</button>' +
      '<span class="pill">' + Core.typeName(it.type) + ' · <b>' + (quiz.idx + 1) + '/' + total + '</b></span>' +
      (quiz.mode === 'exam' ? '<span class="pill" id="timer">' + (quiz.endTs ? fmtTime(quiz.endTs - Date.now()) : fmtTime(Date.now() - quiz.startTs)) + '</span>' : '') +
      '<span class="pill">' + modeName(quiz.mode) + '</span>' +
      '<span style="flex:1"></span>' +
      '<button class="pill" data-act="fav">' + (app.fav[it.id] ? '★ 已收藏' : '☆ 收藏') + '</button>' +
      '<button class="pill" data-act="sheet">答题卡 ' + done + '/' + total + '</button>' +
      '</div>';
    html += '<div class="bar"><i style="width:' + (total ? done / total * 100 : 0) + '%"></i></div>';

    html += '<div class="card">';
    html += '<div class="stem"><span class="no">' + it.no + '.</span>' + esc(it.q) + '</div>';
    html += '<div class="opts">';
    it.options.forEach(function (o, k) {
      var cls = 'opt';
      var isPick = it.type === 'multi' ? (picked || []).indexOf(k) >= 0 : picked === k;
      if (showAns) {
        if (o.correct) cls += ' right';
        else if (isPick) cls += ' wrong';
      } else if (isPick) cls += ' sel';
      var mark = '';
      if (showAns && o.correct) mark = '<span class="mark">✔ 正确</span>';
      else if (showAns && isPick) mark = '<span class="mark" style="color:var(--bad)">✘ 你的选择</span>';
      html += '<button class="' + cls + '" data-act="pick" data-i="' + k + '">' +
        (it.type === 'judge' ? '' : '<span class="k">' + Core.LETTERS[k] + '</span>') +
        '<span class="t">' + esc(o.text) + '</span>' + mark + '</button>';
    });
    html += '</div>';

    if (it.type === 'multi' && quiz.mode !== 'exam' && !showAns) {
      html += '<div class="row" style="margin-top:12px"><button class="btn" data-act="confirm-multi">确定</button>' +
        '<span class="note">多选题：选完后点「确定」判分</span></div>';
    }
    if (graded) {
      var ok = Core.isCorrect(it, picked);
      html += '<div class="fb ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '✔ 回答正确' : '✘ 回答错误') +
        '<br>正确答案：<b>' + esc(rightAnswerText(it)) + '</b>' +
        (ok ? '' : '<br>你的答案：' + esc(answerText(it, picked))) + '</div>';
    } else if (quiz.mode === 'recite') {
      html += '<div class="fb neutral">背题模式：正确答案 <b>' + esc(rightAnswerText(it)) + '</b>（用「我记住了 / 没记住」记录掌握情况）</div>';
    } else if (reveal) {
      html += '<div class="fb neutral">正确答案：<b>' + esc(rightAnswerText(it)) + '</b></div>';
    }
    html += '</div>';

    // 底部操作栏
    html += '<div class="footbar"><div class="inner">';
    html += '<button class="btn plain" data-act="prev"' + (quiz.idx === 0 ? ' disabled' : '') + '>上一题</button>';
    if (quiz.mode === 'recite') {
      html += '<button class="btn ghost" data-act="recite-bad">没记住</button>';
      html += '<button class="btn" data-act="recite-ok">我记住了</button>';
    } else if (quiz.mode === 'exam') {
      html += '<button class="btn" data-act="submit">交卷</button>';
    } else if (!showAns) {
      html += '<button class="btn ghost" data-act="reveal">查看答案</button>';
    }
    html += '<button class="btn plain" data-act="next"' + (quiz.idx >= quiz.paper.length - 1 ? ' disabled' : '') + '>下一题</button>';
    html += '</div></div>';
    return html;
  }

  function sheetHtml() {
    var html = '<div class="mask" data-act="sheet-close"><div class="sheet" data-stop="1">';
    html += '<div class="row spread" style="margin-bottom:10px"><b>答题卡</b>' +
      '<button class="btn mini plain" data-act="sheet-close">关闭</button></div>';
    html += '<div class="legend">' +
      '<span><i style="background:var(--ok-soft)"></i>答对</span>' +
      '<span><i style="background:var(--bad-soft)"></i>答错</span>' +
      '<span><i style="background:var(--brand-soft)"></i>已选</span>' +
      '<span><i style="background:var(--bg);border:1px solid var(--line)"></i>未做</span></div>';
    html += '<div class="nums">';
    quiz.paper.forEach(function (it, k) {
      var cls = '';
      var picked = quiz.answers[it.id];
      if (quiz.checked[it.id]) cls = Core.isCorrect(it, picked) ? 'ok' : 'bad';
      else if (isAnswered(it, picked)) cls = 'done';
      if (k === quiz.idx) cls += ' cur';
      html += '<button class="' + cls + '" data-act="jump" data-i="' + k + '">' + (k + 1) + '</button>';
    });
    html += '</div>';
    if (quiz.mode === 'exam') {
      html += '<div style="margin-top:14px"><button class="btn" data-act="submit">交卷（已答 ' + countDone() + '/' + quiz.paper.length + '）</button></div>';
    }
    html += '</div></div>';
    return html;
  }

  function viewResult() {
    var r = quiz.result;
    var html = '';
    html += '<div class="card"><div class="score"><b>' + r.score + '</b><em> 分</em>' +
      '<div class="sub" style="margin-top:6px">共 ' + r.total + ' 题 · 答对 ' + r.correct + ' · 答错 ' + r.wrong + ' · 未答 ' + r.blank + '</div></div>';
    html += '<div class="row" style="margin-top:14px;justify-content:center">' +
      '<button class="btn" data-act="redo-wrong"' + (r.wrong + r.blank ? '' : ' disabled') + '>重做错题</button>' +
      '<button class="btn plain" data-act="start" data-mode="exam">再考一次</button>' +
      '<button class="btn plain" data-act="quit">返回首页</button></div></div>';

    var wrongs = quiz.paper.filter(function (it) { return !Core.isCorrect(it, quiz.answers[it.id]); });
    if (wrongs.length) {
      html += '<div class="card wronglist"><h2>错题回顾（' + wrongs.length + '）</h2>';
      wrongs.forEach(function (it) {
        var picked = quiz.answers[it.id];
        html += '<div class="item"><div class="q"><span class="tag">' + Core.typeName(it.type) + '</span>' + it.no + '. ' + esc(it.q) + '</div>';
        it.options.forEach(function (o, k) {
          var cls = 'opt';
          if (o.correct) cls += ' right';
          else if (it.type === 'multi' ? (picked || []).indexOf(k) >= 0 : picked === k) cls += ' wrong';
          html += '<button class="' + cls + '" style="margin-bottom:6px" data-act="noop">' +
            (it.type === 'judge' ? '' : '<span class="k">' + Core.LETTERS[k] + '</span>') + '<span class="t">' + esc(o.text) + '</span></button>';
        });
        html += '<div class="note">你的答案：' + esc(answerText(it, picked)) + '　正确答案：<b>' + esc(rightAnswerText(it)) + '</b></div>';
        html += '<div style="margin-top:6px"><button class="btn mini ghost" data-act="fav-id" data-id="' + esc(it.id) + '">' +
          (app.fav[it.id] ? '★ 取消收藏' : '☆ 收藏此题') + '</button></div>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += topbarNav('home');
    return html;
  }

  function viewStats() {
    var total = app.bank.items.length;
    var done = Object.keys(app.progress).length;
    var acc = app.stats.total ? pct(app.stats.correct, app.stats.total) : 0;
    var html = '';
    html += '<div class="card"><h2>学习统计</h2><div class="kv">' +
      '<div class="kvi"><b>' + done + '</b><span>已练题目（覆盖 ' + pct(done, total) + '%）</span></div>' +
      '<div class="kvi"><b>' + app.stats.total + '</b><span>累计作答次数</span></div>' +
      '<div class="kvi"><b>' + acc + '%</b><span>总正确率</span></div>' +
      '<div class="kvi"><b>' + Object.keys(app.wrong).length + '</b><span>错题本（未掌握）</span></div>' +
      '<div class="kvi"><b>' + Object.keys(app.fav).length + '</b><span>收藏</span></div>' +
      '<div class="kvi"><b>' + todayCount() + '</b><span>今日作答</span></div>' +
      '</div></div>';

    html += '<div class="card"><h2>分题型掌握情况</h2>';
    ['single', 'multi', 'judge'].forEach(function (t) {
      var arr = idsByType(t);
      if (!arr.length) return;
      var practiced = 0, right = 0, tries = 0;
      arr.forEach(function (x) {
        var p = app.progress[x.id];
        if (p) { practiced++; tries++; if (p.ok) right++; }
      });
      html += '<div style="margin-bottom:12px"><div class="row spread"><span>' + Core.typeName(t) + '</span>' +
        '<span class="sub">已练 ' + practiced + '/' + arr.length + ' · 正确率 ' + (tries ? pct(right, tries) : 0) + '%</span></div>' +
        '<div class="bar"><i style="width:' + (arr.length ? practiced / arr.length * 100 : 0) + '%"></i></div></div>';
    });
    html += '</div>';

    html += '<div class="card"><h2>数据管理</h2><div class="row" style="flex-wrap:wrap;gap:8px">' +
      '<button class="btn mini plain" data-act="export-bank-txt">导出题库(txt)</button>' +
      '<button class="btn mini plain" data-act="export-bank-json">导出题库(json)</button>' +
      '<button class="btn mini plain" data-act="export-progress">导出学习记录</button>' +
      '<button class="btn mini plain" data-act="clear-progress">清空作答记录</button>' +
      '<button class="btn mini plain" data-act="clear-wrong">清空错题本</button>' +
      '<button class="btn mini plain" data-act="clear-fav">清空收藏</button></div></div>';
    html += topbarNav('stats');
    return html;
  }

  function viewImport() {
    var html = '';
    html += '<div class="card"><h2>导入题库</h2>' +
      '<p class="note">支持粘贴文本或选择 <code>.txt/.json</code> 文件。文本格式：每题一行题干（可带题号），选项一行或每行一个（A. / B. 开头），然后一行答案；判断题只写题干 + 答案。</p>' +
      '<p class="note" style="margin-top:8px">示例：<br>' +
      '<code>1. ROS 属于？</code><br><code>A.数据库 B.中间件 C.内核 D.语言</code><br><code>答案：B</code><br>' +
      '<code>2. 锂电池严禁过充过放（）</code><br><code>答案：√</code><br>' +
      '<code>3. 下列属于编程语言的有？</code>（多选答案写多个字母 <code>答案：ABD</code>）</p>' +
      '<textarea id="import-text" placeholder="把题库文本粘贴到这里…">' + esc(ui.importText) + '</textarea>' +
      '<div class="row" style="margin-top:10px;flex-wrap:wrap;gap:8px">' +
      '<input type="file" id="import-file" accept=".txt,.json,.csv" style="max-width:230px;padding:6px">' +
      '<button class="btn" data-act="parse">解析预览</button>' +
      '<button class="btn ghost" data-act="apply-import" id="apply-btn"' + (ui.importPreview && ui.importPreview.items.length ? '' : ' disabled') + '>确认导入</button>' +
      '<button class="btn plain" data-act="restore-builtin">恢复内置题库</button>' +
      '</div>';
    if (ui.importPreview) {
      var p = ui.importPreview;
      var c = Core.countByType(p.items);
      html += '<div class="fb ' + (p.items.length ? 'ok' : 'bad') + '" style="margin-top:12px">' +
        '解析到 <b>' + p.items.length + '</b> 题（单选 ' + (c.single || 0) + ' / 多选 ' + (c.multi || 0) + ' / 判断 ' + (c.judge || 0) + '）' +
        (p.errors.length ? '，跳过 ' + p.errors.length + ' 条：' + esc(p.errors.slice(0, 3).join('；')) : '') + '</div>';
      if (p.items.length) {
        var s = p.items[0];
        html += '<div class="note" style="margin-top:8px">首题预览：' + esc(s.q) + '　→　' +
          esc(s.type === 'judge' ? (s.answer === 0 ? '正确' : '错误') : Core.LETTERS[s.answer] + '．' + s.options[s.answer]) + '</div>';
      }
    }
    html += '</div>';
    html += topbarNav('import');
    return html;
  }

  function viewSettings() {
    var s = app.settings;
    function sw(key, label, hint) {
      return '<label class="field"><span>' + label + (hint ? '<br><span class="note">' + hint + '</span>' : '') + '</span>' +
        '<span class="switch' + (s[key] ? ' on' : '') + '" data-act="toggle" data-key="' + key + '"><i></i></span></label>';
    }
    var html = '<div class="card"><h2>设置</h2>' +
      sw('shuffleOptions', '选项乱序', '打乱选项顺序，避免只背“答案在第几个”') +
      sw('autoNext', '答对自动下一题', '练习模式下答对后自动跳到下一题') +
      sw('removeOnCorrect', '错题答对后移出错题本', '在错题本里答对即视为已掌握') +
      sw('night', '夜间模式', '') +
      '<label class="field"><span>字号</span><input type="number" id="set-font" value="' + s.fontSize + '" min="12" max="24"></label>' +
      '<label class="field"><span>模拟考试 · 单选数</span><input type="number" id="set-es" value="' + s.examSingle + '" min="0"></label>' +
      '<label class="field"><span>模拟考试 · 判断数</span><input type="number" id="set-ej" value="' + s.examJudge + '" min="0"></label>' +
      '<label class="field"><span>模拟考试 · 时长（分钟，0=不限时）</span><input type="number" id="set-em" value="' + s.examMinutes + '" min="0"></label>' +
      '</div>';
    html += '<div class="card"><h2>题库信息</h2><p class="note">' + esc(app.bank.title) + '<br>共 ' + app.bank.items.length +
      ' 题 · 来源：' + (app.bank.source === 'builtin' ? '内置题库' : '导入题库') + '</p></div>';
    html += topbarNav('settings');
    return html;
  }

  function render() {
    if (!root) return;
    document.body.className = app.settings.night ? 'night' : '';
    document.documentElement.style.fontSize = app.settings.fontSize + 'px';
    var html;
    if (ui.view === 'quiz' && quiz) html = viewQuiz();
    else if (ui.view === 'result' && quiz && quiz.result) html = viewResult();
    else if (ui.view === 'stats') html = viewStats();
    else if (ui.view === 'import') html = viewImport();
    else if (ui.view === 'settings') html = viewSettings();
    else { ui.view = 'home'; html = viewHome(); }
    root.innerHTML = html + (ui.sheet && quiz ? sheetHtml() : '') +
      (ui.toast ? '<div class="toast">' + esc(ui.toast) + '</div>' : '');
  }

  /* ---------- 交互 ---------- */
  function download(name, text, mime) {
    try {
      var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
      toast('已导出：' + name);
    } catch (e) { toast('导出失败：' + e.message); }
  }

  function handleClick(ev) {
    var el = ev.target;
    while (el && el !== document) {
      if (el.getAttribute && el.getAttribute('data-stop')) return;
      if (el.getAttribute && el.getAttribute('data-act')) break;
      el = el.parentNode;
    }
    if (!el || el === document) return;
    var act = el.getAttribute('data-act');
    ev.preventDefault();

    if (act === 'noop' || act === 'sheet-close') {
      if (act === 'sheet-close') { ui.sheet = false; render(); }
      return;
    }
    if (act === 'nav') {
      var v = el.getAttribute('data-view');
      ui.view = v; ui.sheet = false; render(); window.scrollTo(0, 0); return;
    }
    if (act === 'start') { startQuiz(el.getAttribute('data-mode')); return; }
    if (act === 'resume') {
      if (app.last && app.last.mode) { startQuiz(app.last.mode); }
      return;
    }
    if (act === 'quit') { ui.view = 'home'; ui.sheet = false; render(); window.scrollTo(0, 0); return; }
    if (act === 'pick') { pickOption(parseInt(el.getAttribute('data-i'), 10)); return; }
    if (act === 'confirm-multi') { confirmMulti(); return; }
    if (act === 'prev') { go(-1); return; }
    if (act === 'next') { go(1); return; }
    if (act === 'reveal') { quiz.revealed[quiz.paper[quiz.idx].id] = true; render(); return; }
    if (act === 'fav') {
      var id = quiz.paper[quiz.idx].id;
      if (app.fav[id]) delete app.fav[id]; else app.fav[id] = 1;
      saveState(); render();
      toast(app.fav[id] ? '已收藏' : '已取消收藏');
      return;
    }
    if (act === 'fav-id') {
      var id2 = el.getAttribute('data-id');
      if (app.fav[id2]) delete app.fav[id2]; else app.fav[id2] = 1;
      saveState(); render(); return;
    }
    if (act === 'sheet') { ui.sheet = true; render(); return; }
    if (act === 'jump') {
      quiz.idx = parseInt(el.getAttribute('data-i'), 10);
      ui.sheet = false; ui.renderedQi = -1; saveLastPos(); render(); window.scrollTo(0, 0); return;
    }
    if (act === 'recite-ok' || act === 'recite-bad') {
      var it = quiz.paper[quiz.idx];
      var okFlag = act === 'recite-ok';
      app.progress[it.id] = { c: null, ok: okFlag ? 1 : 0, t: Date.now() };
      app.stats.total++;
      if (okFlag) app.stats.correct++; else app.wrong[it.id] = 1;
      saveState();
      if (quiz.idx < quiz.paper.length - 1) { quiz.idx++; saveLastPos(); render(); window.scrollTo(0, 0); }
      else { toast('已完成最后一题'); render(); }
      return;
    }
    if (act === 'submit') {
      var blankLeft = quiz.paper.length - countDone();
      if (window.confirm && !window.__noConfirm && blankLeft > 0) {
        if (!window.confirm('还有 ' + blankLeft + ' 题未作答，确定交卷吗？')) return;
      }
      submitExam(false); return;
    }
    if (act === 'redo-wrong') {
      var wrongItems = quiz.paper.filter(function (it) { return !Core.isCorrect(it, quiz.answers[it.id]); });
      if (!wrongItems.length) { toast('没有错题'); return; }
      startQuizWithItems(wrongItems, 'random', 'order');
      return;
    }
    if (act === 'toggle') {
      var key = el.getAttribute('data-key');
      app.settings[key] = !app.settings[key];
      saveState(); render(); return;
    }
    if (act === 'parse') { doParse(); return; }
    if (act === 'apply-import') { applyImport(); return; }
    if (act === 'restore-builtin') {
      if (window.confirm && !window.confirm('恢复内置题库将替换当前题库，练习记录保留，继续？')) return;
      app.bank = { title: BUILTIN.title || '题库', items: (BUILTIN.items || []).slice(), source: 'builtin' };
      store.removeItem(KEY_BANK);
      ui.importPreview = null;
      toast('已恢复内置题库'); render(); return;
    }
    if (act === 'export-bank-txt') { download('题库.txt', '\ufeff' + Core.toText(app.bank.items)); return; }
    if (act === 'export-bank-json') { download('题库.json', JSON.stringify({ title: app.bank.title, items: app.bank.items }, null, 1), 'application/json'); return; }
    if (act === 'export-progress') {
      download('学习记录.json', JSON.stringify({ bank: app.bank.title, progress: app.progress, wrong: app.wrong, fav: app.fav, stats: app.stats }, null, 1), 'application/json');
      return;
    }
    if (act === 'clear-progress') {
      if (window.confirm && !window.confirm('清空所有作答记录？错题本与收藏不受影响。')) return;
      app.progress = {}; app.stats = { total: 0, correct: 0 }; app.last = null;
      saveState(); toast('已清空作答记录'); render(); return;
    }
    if (act === 'clear-wrong') {
      if (window.confirm && !window.confirm('清空错题本？')) return;
      app.wrong = {}; saveState(); toast('已清空错题本'); render(); return;
    }
    if (act === 'clear-fav') {
      if (window.confirm && !window.confirm('清空收藏？')) return;
      app.fav = {}; saveState(); toast('已清空收藏'); render(); return;
    }
  }

  function startQuizWithItems(items, mode, kind) {
    var rand = Core.mulberry32((Date.now() % 2147483647) ^ (Math.random() * 1e9 | 0));
    quiz = {
      mode: 'random', paper: Core.preparePaper(items, { rand: rand, shuffleItems: true, shuffleOptions: app.settings.shuffleOptions }),
      answers: {}, checked: {}, revealed: {}, idx: 0, startTs: Date.now(), submitted: false, result: null, endTs: 0
    };
    ui.view = 'quiz'; ui.renderedQi = -1; ui.sheet = false;
    render(); window.scrollTo(0, 0);
  }

  function doParse() {
    var ta = document.getElementById('import-text');
    var text = ta ? ta.value : ui.importText;
    ui.importText = text;
    if (!text.trim()) { toast('请先粘贴或选择题库文本'); return; }
    ui.importPreview = Core.parseImport(text);
    var btn = document.getElementById('apply-btn');
    render();
    if (ui.importPreview.items.length) toast('解析到 ' + ui.importPreview.items.length + ' 题');
    else toast('没有解析到题目，请检查格式');
  }

  function applyImport() {
    var p = ui.importPreview;
    if (!p || !p.items.length) { toast('请先解析预览'); return; }
    if (window.confirm && !window.confirm('导入将替换当前题库，并清空作答记录/错题本/收藏，继续？')) return;
    app.bank = { title: '导入题库（' + p.items.length + ' 题）', items: p.items, source: 'import' };
    app.progress = {}; app.wrong = {}; app.fav = {};
    app.stats = { total: 0, correct: 0 }; app.last = null;
    saveBank(); saveState();
    ui.importPreview = null; ui.importText = '';
    toast('导入成功：' + p.items.length + ' 题');
    ui.view = 'home';
    render();
  }

  function handleChange(ev) {
    var id = ev.target && ev.target.id;
    if (!id) return;
    if (id === 'import-file') {
      var f = ev.target.files && ev.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        ui.importText = String(reader.result || '');
        ui.importPreview = Core.parseImport(ui.importText);
        render();
        toast('已读取文件：解析到 ' + ui.importPreview.items.length + ' 题');
      };
      reader.onerror = function () { toast('文件读取失败'); };
      reader.readAsText(f, 'utf-8');
      return;
    }
    var v = parseInt(ev.target.value, 10);
    if (isNaN(v)) return;
    if (id === 'set-font') { app.settings.fontSize = Math.min(24, Math.max(12, v)); }
    else if (id === 'set-es') { app.settings.examSingle = Math.max(0, v); }
    else if (id === 'set-ej') { app.settings.examJudge = Math.max(0, v); }
    else if (id === 'set-em') { app.settings.examMinutes = Math.max(0, v); }
    else return;
    saveState(); render();
  }

  function handleKey(ev) {
    if (ui.view !== 'quiz' || !quiz) return;
    var tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    var k = ev.key;
    if (k === 'ArrowLeft') { go(-1); return; }
    if (k === 'ArrowRight' || k === 'Enter') { go(1); return; }
    var i = -1;
    if (/^[a-hA-H]$/.test(k)) i = Core.LETTERS.indexOf(k.toUpperCase());
    else if (/^[1-8]$/.test(k)) i = parseInt(k, 10) - 1;
    if (i >= 0 && quiz && i < quiz.paper[quiz.idx].options.length) { pickOption(i); }
  }

  function tick() {
    if (ui.view !== 'quiz' || !quiz || quiz.mode !== 'exam') return;
    if (quiz.endTs) {
      var left = quiz.endTs - Date.now();
      var node = document.getElementById('timer');
      if (node) node.textContent = fmtTime(left);
      if (left <= 0) submitExam(true);
    } else {
      var node2 = document.getElementById('timer');
      if (node2) node2.textContent = fmtTime(Date.now() - quiz.startTs);
    }
  }

  window.__QBAPP = {
    get app() { return app; },
    get quiz() { return quiz; },
    get ui() { return ui; },
    startQuiz: startQuiz, pickOption: pickOption, go: go, submitExam: submitExam,
    render: render, parseImport: Core.parseImport, toggleKey: function (k) { return Core.LETTERS.indexOf(k.toUpperCase()); }
  };

  document.addEventListener('click', function (ev) {
    try { handleClick(ev); } catch (e) { console.error(e); toast('出错了：' + e.message); }
  }, false);
  document.addEventListener('change', function (ev) { try { handleChange(ev); } catch (e) { console.error(e); } }, false);
  document.addEventListener('input', function (ev) {
    if (ev.target && ev.target.id === 'import-text') ui.importText = ev.target.value;
  }, false);
  document.addEventListener('keydown', function (ev) { try { handleKey(ev); } catch (e) { console.error(e); } }, false);

  render();
  setInterval(tick, 1000);
})();
