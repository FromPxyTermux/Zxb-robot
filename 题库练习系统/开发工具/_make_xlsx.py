# -*- coding: utf-8 -*-
"""由 questions.json 生成通用题库导入表 Excel（多数刷题平台/考试宝都能吃这种列结构）。"""
import io, os, json

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(BASE, u'\u9898\u5e93\u5bfc\u5165\u8868.xlsx')

import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill
from openpyxl.utils import get_column_letter

with io.open(os.path.join(BASE, 'questions.json'), encoding='utf-8') as f:
    data = json.load(f)
items = data['items']

wb = openpyxl.Workbook()
ws = wb.active
ws.title = u'\u9898\u5e93'
head = [u'\u5e8f\u53f7', u'\u9898\u578b', u'\u9898\u5e72', u'A', u'B', u'C', u'D', u'\u7b54\u6848']
ws.append(head)
fill = PatternFill('solid', fgColor='DDEBF7')
for c in range(1, len(head) + 1):
    cell = ws.cell(row=1, column=c)
    cell.font = Font(bold=True)
    cell.fill = fill
    cell.alignment = Alignment(horizontal='center', vertical='center')

TYPE_CN = {'single': u'\u5355\u9009\u9898', 'multi': u'\u591a\u9009\u9898', 'judge': u'\u5224\u65ad\u9898'}
L = 'ABCD'
for it in items:
    if it['type'] == 'judge':
        opts = [u'\u6b63\u786e', u'\u9519\u8bef']
        ans = u'\u6b63\u786e' if it['answer'] == 0 else u'\u9519\u8bef'
    else:
        opts = it['options']
        ans = L[it['answer']]
    row = [it['no'], TYPE_CN.get(it['type'], it['type']), it['q']] + (opts + [u'', u'', u'', u''])[:4] + [ans]
    while len(row) < len(head):
        row.append(u'')
    ws.append(row)

widths = [6, 8, 62, 22, 22, 22, 22, 8]
for i, w in enumerate(widths, start=1):
    ws.column_dimensions[get_column_letter(i)].width = w
for r in range(2, ws.max_row + 1):
    ws.cell(row=r, column=3).alignment = Alignment(wrap_text=True, vertical='top')
    ws.cell(row=r, column=1).alignment = Alignment(horizontal='center')
    ws.cell(row=r, column=2).alignment = Alignment(horizontal='center')
    ws.cell(row=r, column=8).alignment = Alignment(horizontal='center')
ws.freeze_panes = 'A2'

# 第二张表：答案速查（50 题一行，便于打印/人工核对）
ws2 = wb.create_sheet(u'\u7b54\u6848\u901f\u67e5')
ws2.append([u'\u5355\u9009\u9898\u7b54\u6848\uff08\u7b2c\u4e00\u884c\u4e3a\u9898\u53f7\uff09'])
ws2.append([u'\u9898\u53f7'] + [x['no'] for x in items if x['type'] == 'single'])
ws2.append([u'\u7b54\u6848'] + [L[x['answer']] for x in items if x['type'] == 'single'])
ws2.append([])
ws2.append([u'\u5224\u65ad\u9898\u7b54\u6848'])
ws2.append([u'\u9898\u53f7'] + [x['no'] for x in items if x['type'] == 'judge'])
ws2.append([u'\u7b54\u6848'] + [(u'\u221a' if x['answer'] == 0 else u'\u00d7') for x in items if x['type'] == 'judge'])
ws2.column_dimensions['A'].width = 8
for c in range(2, 602):
    ws2.column_dimensions[get_column_letter(c)].width = 3.6
ws2['A1'].font = Font(bold=True)
ws2['A5'].font = Font(bold=True)
for r in (2, 3, 6, 7):
    ws2.cell(row=r, column=1).font = Font(bold=True)

wb.save(OUT)
print(u'Excel ->', OUT)
print(u'题量:', len(items))
