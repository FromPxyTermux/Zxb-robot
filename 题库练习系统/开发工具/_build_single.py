# -*- coding: utf-8 -*-
"""把 题库练习系统/ 下的 index.html + core.js + bank.js + app.js 打成单文件 HTML。"""
import io, os, re

# 脚本已归档到“开发工具/”，上级目录即题库文件夹
DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SYS = os.path.join(DIR, u'\u9898\u5e93\u7ec3\u4e60\u7cfb\u7edf')
OUT = os.path.join(DIR, u'\u670d\u52a1\u673a\u5668\u4eba\u7ec3\u4e60\u9898\u5e93.html')


def read(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()


html = read(os.path.join(SYS, 'index.html'))
for name in ('core.js', 'bank.js', 'app.js'):
    code = read(os.path.join(SYS, name)).replace(u'</script', u'<\\/script')
    tag = u'<script src="%s"></script>' % name
    assert tag in html, u'未找到脚本标签: ' + name
    html = html.replace(tag, u'<script>\n' + code + u'\n</script>')

assert u'<script src=' not in html, u'仍有外部脚本引用'
with io.open(OUT, 'w', encoding='utf-8') as f:
    f.write(html)
print(u'单文件版 ->', OUT)
print(u'大小: %.1f KB' % (os.path.getsize(OUT) / 1024.0))
