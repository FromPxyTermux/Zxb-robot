/* QCore —— 纯逻辑层（无 DOM），可在 node 中单测 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.QCore = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var LETTERS = 'ABCDEFGH';

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, rand) {
    var r = rand || Math.random;
    var a = (list || []).slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function typeName(t) {
    return t === 'single' ? '单选题' : t === 'multi' ? '多选题' : '判断题';
  }

  /* 单题 -> 展示用题目（可打乱选项） */
  function prepareItem(item, rand, shuffleOptions) {
    var out = {
      id: item.id, no: item.no, type: item.type, q: item.q,
      answer: item.answer, answerSet: (item.answerSet || []).slice()
    };
    if (item.type === 'single' || item.type === 'multi') {
      var order = item.options.map(function (_, k) { return k; });
      if (shuffleOptions) order = shuffle(order, rand);
      out.options = order.map(function (k) { return { text: item.options[k], correct: k === item.answer }; });
      out.answerPos = order.indexOf(item.answer);
      out.answerPositions = out.answerSet.map(function (k) { return order.indexOf(k); })
        .sort(function (a, b) { return a - b; });
      if (item.type === 'multi' && out.answerPositions.length === 0) out.answerPositions = [out.answerPos];
    } else {
      out.options = [{ text: '正确', correct: item.answer === 0 }, { text: '错误', correct: item.answer === 1 }];
      out.answerPos = item.answer;
      out.answerPositions = [item.answer];
    }
    return out;
  }

  function preparePaper(items, opts) {
    opts = opts || {};
    var rand = opts.rand || null;
    var list = opts.shuffleItems ? shuffle(items, rand) : items.slice();
    return list.map(function (it) { return prepareItem(it, rand, opts.shuffleOptions); });
  }

  function isCorrect(item, picked) {
    if (item.type === 'multi') {
      var p = (picked || []).slice().sort(function (a, b) { return a - b; });
      var a = item.answerPositions.slice().sort(function (x, y) { return x - y; });
      return p.length === a.length && p.every(function (v, i) { return v === a[i]; });
    }
    return picked === item.answerPos;
  }

  function gradePaper(paper, answers) {
    var correct = 0, wrong = 0, blank = 0, details = [];
    paper.forEach(function (it) {
      var picked = answers[it.id];
      var answered;
      if (picked === undefined || picked === null) answered = false;
      else if (it.type === 'multi') answered = Array.isArray(picked) && picked.length > 0;
      else answered = typeof picked === 'number';
      var ok = answered && isCorrect(it, picked);
      if (!answered) blank++; else if (ok) correct++; else wrong++;
      details.push({ id: it.id, no: it.no, type: it.type, ok: !!ok, answered: !!answered, picked: picked });
    });
    var total = paper.length;
    var score = total ? Math.round((correct / total) * 1000) / 10 : 0;
    return { total: total, correct: correct, wrong: wrong, blank: blank, score: score, details: details };
  }

  /* ---------------- 文本导入解析 ---------------- */
  var RE_NUM = /^\s*(?:第\s*)?(\d{1,4})\s*(?:题)?\s*[.、．)）:：]\s*(.*)$/;
  var RE_OPT = /^\s*([A-H])\s*[.、．)）:：]\s*(\S.*)$/;
  var RE_ANS = /^\s*(?:【\s*答案\s*】|\[\s*答案\s*\]|正确答案|参考答案|答案|answer|ans)\s*[:：]?\s*([A-Ha-h√✓×✗✘对错正确误TFtf]{1,8})\s*$/;
  var RE_JUDGE_INLINE = /[（(]\s*([√✓×✗✘对错TFtf正确误]{1,2})\s*[)）]\s*$/;

  function splitOptions(line) {
    var s = String(line).replace(/\s+$/, '');
    var parts = s.split(/\s{1,}(?=[A-H]\s*[.、．)）:：])/);
    var out = [];
    parts.forEach(function (p) {
      var m = p.match(RE_OPT);
      if (m) out.push({ label: m[1].toUpperCase(), text: m[2].trim() });
    });
    return out;
  }

  function judgeValue(s) {
    s = String(s || '').trim();
    if (/^[√✓对Tt]|正确/.test(s)) return 0;
    if (/^[×✗✘错Ff]|错误|误/.test(s)) return 1;
    return null;
  }

  function parseImport(text) {
    var raw = String(text || '').replace(/\r\n?/g, '\n');
    var errors = [], items = [];
    var trimmed = raw.trim();

    // JSON 输入
    if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
      try {
        var obj = JSON.parse(trimmed);
        var arr = Array.isArray(obj) ? obj : (obj.items || []);
        var okList = [];
        arr.forEach(function (x, i) {
          var it = normalizeItem(x, i + 1);
          if (it) okList.push(it); else errors.push('第 ' + (i + 1) + ' 条 JSON 记录无法识别');
        });
        return { items: okList, errors: errors, format: 'json' };
      } catch (e) {
        errors.push('JSON 解析失败：' + e.message);
        return { items: [], errors: errors, format: 'json' };
      }
    }

    // 纯文本
    var lines = raw.split('\n');
    var cur = null, seq = 0;

    function flush() {
      if (!cur) return;
      cur.q = (cur.q || '').trim();
      if (!cur.q) { cur = null; return; }
      if (cur.options.length === 0) {
        if (cur.answer === null) { errors.push('「' + cur.q.slice(0, 20) + '…」缺少答案，已跳过'); cur = null; return; }
        var inline = cur.q.match(RE_JUDGE_INLINE);
        cur.type = 'judge';
        if (inline) { cur.q = cur.q.replace(RE_JUDGE_INLINE, '（  ）'); }
      } else if (cur.options.length < 2) {
        errors.push('「' + cur.q.slice(0, 20) + '…」选项不足 2 个，已跳过'); cur = null; return;
      } else {
        cur.type = cur.multi ? 'multi' : 'single';
      }
      if (cur.answer === null || cur.answer === undefined) {
        errors.push('「' + cur.q.slice(0, 20) + '…」缺少答案，已跳过'); cur = null; return;
      }
      seq++;
      cur.no = cur.no || seq;
      cur.id = cur.id || ((cur.type === 'judge' ? 'J' : cur.type === 'multi' ? 'M' : 'S') + '-' + seq + '-' + Math.random().toString(36).slice(2, 6));
      items.push(cur);
      cur = null;
    }

    function newItem(num, stem) {
      return { id: null, no: num || null, type: null, q: stem || '', options: [], answer: null, answerSet: [], multi: false };
    }

    lines.forEach(function (rawLine) {
      var line = rawLine.replace(/\u3000/g, ' ').replace(/\s+$/, '');
      if (!line.trim()) return;
      var mAns = line.match(RE_ANS);
      if (mAns && cur) {
        var val = mAns[1].toUpperCase();
        if (/^[A-H]+$/.test(val)) {
          var picks = val.split('').map(function (c) { return LETTERS.indexOf(c); });
          cur.answerSet = picks;
          cur.answer = picks[0];
          cur.multi = picks.length > 1;
        } else {
          var jv = judgeValue(mAns[1]);
          if (jv === null) { errors.push('答案无法识别：' + line.trim()); } else { cur.answer = jv; }
        }
        return;
      }
      var mNum = line.match(RE_NUM);
      var mOpt = line.match(RE_OPT);
      if (mOpt) {
        if (!cur) cur = newItem(null, '');
        splitOptions(line).forEach(function (o) { cur.options.push(o.text); });
        return;
      }
      if (mNum && mNum[2]) {
        flush();
        cur = newItem(parseInt(mNum[1], 10), mNum[2]);
        var inlineAns = mNum[2].match(RE_JUDGE_INLINE);
        if (inlineAns) {
          var jv2 = judgeValue(inlineAns[1]);
          if (jv2 !== null) cur.answer = jv2;
        }
        return;
      }
      // 无编号题干 / 题干续行
      if (cur && (cur.options.length >= 2 || cur.answer !== null)) {
        flush();
        cur = newItem(null, line.trim());
      } else if (cur) {
        cur.q = (cur.q ? cur.q + ' ' : '') + line.trim();
      } else {
        cur = newItem(null, line.trim());
      }
    });
    flush();

    // 重编题号（按题型分别从 1 开始）
    var counters = { single: 0, multi: 0, judge: 0 };
    items.forEach(function (it) {
      counters[it.type]++;
      it.no = counters[it.type];
    });
    return { items: items, errors: errors, format: 'text' };
  }

  function normalizeItem(x, n) {
    if (!x || typeof x !== 'object') return null;
    var q = String(x.q || x.question || x.stem || x.title || '').trim();
    if (!q) return null;
    var type = x.type;
    var options = x.options || x.opts || [];
    if (Array.isArray(options) && options.length && typeof options[0] === 'object') {
      options = options.map(function (o) { return String(o.text || o.label || ''); });
    } else {
      options = (options || []).map(function (o) { return String(o); });
    }
    var ans = x.answer;
    var answerSet = [];
    if (Array.isArray(ans)) answerSet = ans.map(Number);
    else if (typeof ans === 'string') {
      var s = ans.toUpperCase().trim();
      if (/^[A-H]+$/.test(s)) answerSet = s.split('').map(function (c) { return LETTERS.indexOf(c); });
      else { var jv = judgeValue(ans); if (jv !== null) answerSet = [jv]; }
    } else if (typeof ans === 'number') answerSet = [ans];
    if (!type) type = options.length ? (answerSet.length > 1 ? 'multi' : 'single') : 'judge';
    if (!options.length) type = 'judge';
    if (!answerSet.length) return null;
    return {
      id: String(x.id || ('X-' + n)), no: x.no || n, type: type, q: q,
      options: options, answer: answerSet[0], answerSet: answerSet
    };
  }

  function toText(items) {
    var lines = [];
    items.forEach(function (x) {
      lines.push(x.no + '. ' + x.q);
      if (x.type === 'single' || x.type === 'multi') {
        x.options.forEach(function (o, k) { lines.push(LETTERS[k] + '.' + o); });
        lines.push('答案：' + (x.answerSet && x.answerSet.length > 1
          ? x.answerSet.map(function (k) { return LETTERS[k]; }).join('')
          : LETTERS[x.answer]));
      } else {
        lines.push('答案：' + (x.answer === 0 ? '√' : '×'));
      }
      lines.push('');
    });
    return lines.join('\r\n');
  }

  function countByType(items) {
    var c = { single: 0, multi: 0, judge: 0 };
    (items || []).forEach(function (x) { c[x.type] = (c[x.type] || 0) + 1; });
    return c;
  }

  return {
    LETTERS: LETTERS, mulberry32: mulberry32, shuffle: shuffle, typeName: typeName,
    prepareItem: prepareItem, preparePaper: preparePaper, isCorrect: isCorrect,
    gradePaper: gradePaper, parseImport: parseImport, normalizeItem: normalizeItem,
    toText: toText, countByType: countByType
  };
});
