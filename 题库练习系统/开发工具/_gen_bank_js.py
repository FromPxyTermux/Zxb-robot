# -*- coding: utf-8 -*-
"""由 questions.json 生成 bank.js（供网页直接 <script> 引入，file:// 可用）。"""
import io, os, json

# 脚本已归档到“开发工具/”，上级目录即题库文件夹
DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
dst = os.path.join(DIR, u'\u9898\u5e93\u7ec3\u4e60\u7cfb\u7edf', 'bank.js')
with io.open(os.path.join(DIR, 'questions.json'), encoding='utf-8') as f:
    data = json.load(f)
with io.open(dst, 'w', encoding='utf-8') as f:
    f.write(u'/* \u81ea\u52a8\u751f\u6210\uff1a\u9898\u5e93\u6570\u636e\uff08\u7b2c19\u5c4a\u632f\u5174\u676f\u670d\u52a1\u673a\u5668\u4eba\u5e94\u7528\u6280\u672f\u5458\u8d5b\u9879\u5b66\u751f\u7ec4\uff09 */\n')
    f.write(u'window.QBANK = ')
    f.write(json.dumps(data, ensure_ascii=False))
    f.write(u';\n')
print(u'bank.js ->', dst, os.path.getsize(dst), u'bytes')
