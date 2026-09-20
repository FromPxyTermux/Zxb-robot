# -*- coding: utf-8 -*-
"""从合并后的题库 docx 解析出结构化题库 JSON，并导出 考试宝/Anki 友好的 txt。"""
import sys, io, os, re, json, docx

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
# 脚本已归档到“开发工具/”，上级目录即题库文件夹
DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(DIR, u"\u7b2c\u5341\u4e5d\u5c4a\u201c\u632f\u5174\u676f\u201d\u8d5b\u9879\u7406\u8bba\u9898\u5e93-\u5b66\u751f\u7ec4\uff08\u542b\u53c2\u8003\u7b54\u6848\uff09.docx")

doc = docx.Document(SRC)
ps = [p.text.strip() for p in doc.paragraphs]

RE_Q = re.compile(u'^(\\d{1,3})[.\uff0e\u3001]\\s*(\\S.*)$')
RE_ANS = re.compile(u'^\u3010\u7b54\u6848\u3011(.+)$')
RE_MARK = re.compile(u'([A-D])[.\uff0e\u3001]')

section = None
items = []
i = 0
n = len(ps)
problems = []

while i < n:
    t = ps[i]
    if not t:
        i += 1
        continue
    if u'\u5355\u9009\u9898' in t and u'\u4e00\u3001' in t:
        section = 'single'; i += 1; continue
    if u'\u5224\u65ad\u9898' in t and u'\u4e8c\u3001' in t:
        section = 'judge'; i += 1; continue
    m = RE_Q.match(t)
    if section and m and int(m.group(1)) <= (600 if section == 'single' else 400):
        num = int(m.group(1))
        stem = m.group(2).strip()
        opts_text, ans = None, None
        j = i + 1
        while j < n:
            t2 = ps[j]
            if not t2:
                j += 1; continue
            a = RE_ANS.match(t2)
            if a:
                ans = a.group(1).strip(); j += 1; break
            if RE_Q.match(t2) or u'\u5355\u9009\u9898' in t2 or u'\u5224\u65ad\u9898' in t2:
                break
            opts_text = t2 if opts_text is None else opts_text + ' ' + t2
            j += 1
        if ans is None:
            problems.append((section, num, u'缺答案'))
            i = j; continue
        item = {'id': u'%s-%d' % ('S' if section == 'single' else 'J', num), 'no': num,
                'type': 'single' if section == 'single' else 'judge', 'q': stem}
        if section == 'single':
            text = opts_text or ''
            marks = list(RE_MARK.finditer(text))
            labels = [mk.group(1) for mk in marks]
            if labels != ['A', 'B', 'C', 'D']:
                problems.append((section, num, u'选项解析异常: %s' % text[:60]))
                i = j; continue
            opts = []
            for k, mk in enumerate(marks):
                start = mk.end()
                end = marks[k + 1].start() if k + 1 < len(marks) else len(text)
                opts.append(text[start:end].strip())
            item['options'] = opts
            item['answer'] = u'ABCD'.index(ans) if ans in u'ABCD' else -1
            if item['answer'] < 0:
                problems.append((section, num, u'答案异常 %s' % ans)); i = j; continue
        else:
            if ans not in (u'\u221a', u'\u00d7', u'\u2713', u'\u2717'):
                problems.append((section, num, u'判断题答案异常 %s' % ans)); i = j; continue
            item['answer'] = 0 if ans in (u'\u221a', u'\u2713') else 1
        items.append(item)
        i = j
        continue
    i += 1

s = [x for x in items if x['type'] == 'single']
j_ = [x for x in items if x['type'] == 'judge']
print(u"解析: 单选 %d, 判断 %d, 合计 %d" % (len(s), len(j_), len(items)))
print(u"异常记录: %d" % len(problems))
for p in problems[:20]:
    print(u"  ", p)

# 校验题号连续
assert [x['no'] for x in s] == list(range(1, 601)), u'单选题号不连续'
assert [x['no'] for x in j_] == list(range(1, 401)), u'判断题号不连续'
print(u"题号连续性校验通过")

out_json = os.path.join(DIR, 'questions.json')
with io.open(out_json, 'w', encoding='utf-8') as f:
    f.write(json.dumps({'title': u'\u7b2c19\u5c4a\u201c\u632f\u5174\u676f\u201d\u670d\u52a1\u673a\u5668\u4eba\u5e94\u7528\u6280\u672f\u5458\u8d5b\u9879\uff08\u5b66\u751f\u7ec4\uff09',
                        'items': items}, ensure_ascii=False, indent=1))
print(u"JSON ->", out_json)

# 考试宝/Anki 友好的纯文本（题干 / 选项 / 答案）
out_txt = os.path.join(DIR, u'\u9898\u5e93-\u53ef\u5bfc\u5165\u6587\u672c.txt')
lines = []
for x in items:
    lines.append(u'%d. %s' % (x['no'], x['q']))
    if x['type'] == 'single':
        for k, o in enumerate(x['options']):
            lines.append(u'%s.%s' % (u'ABCD'[k], o))
        lines.append(u'\u7b54\u6848\uff1a%s' % u'ABCD'[x['answer']])
    else:
        lines.append(u'\u7b54\u6848\uff1a%s' % (u'\u221a' if x['answer'] == 0 else u'\u00d7'))
    lines.append(u'')
with io.open(out_txt, 'w', encoding='utf-8-sig') as f:
    f.write(u'\r\n'.join(lines))
print(u"TXT  ->", out_txt)
