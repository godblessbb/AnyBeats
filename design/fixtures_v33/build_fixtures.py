"""从主会话的《恋爱循环》rap 版参照里只取 tick，生成 design/fixtures_v33/koi_phrases.json。

用法：python -I design/fixtures_v33/build_fixtures.py
来源（只读，不改）：
  FLOW  = 自动提取的 flow 文件（.anybeats v3，只读 sections[].bars[].words[].tick/len）
  LINES = 主会话识别出的每句开始时间（data.py 里的 L 列表；只用 ast 取第 1 列秒数、第 4 列韵组、第 5 列押几个字，
          **歌词原文一个字都不读进来**）
断句规则和主会话 render.py 一致：第 k 句 = 起点落在 [T(开始秒) − 12, T(下一句开始秒) − 12) 里的字，T(秒) = 秒 × 96（120 BPM）。
另算一份「只看 flow」的启发式断句：前一个字结束到下一个字开始的空白 ≥ 24 tick（半拍）就断。
"""

import ast
import json
import pathlib
from collections import Counter

FLOW = pathlib.Path('/opt/Alphie/data/users/71afba47-29ca-403a-84c5-2ea5d083a11b/cache/generated_files/koi_circulation_rap_flow.anybeats')
LINES = pathlib.Path('/opt/Alphie/temp/koi_rhyme/data.py')
OUT = pathlib.Path(__file__).resolve().parent / 'koi_phrases.json'
MOCK = pathlib.Path(__file__).resolve().parent.parent / 'mockups_v33' / 'koi_ticks.js'
TPB, TPBAR = 48, 192


def main() -> None:
    proj = json.loads(FLOW.read_text(encoding='utf-8'))
    notes, sections, g = [], [], 0
    for s in proj['sections']:
        sections.append({'label': s['label'], 'firstBar': g, 'bars': len(s['bars'])})
        for b in s['bars']:
            for w in b['words']:
                notes.append([g * TPBAR + w['tick'], w['len']])
            g += 1
    notes.sort()
    nbars = g

    tree = ast.parse(LINES.read_text(encoding='utf-8'))
    rows = None
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, 'id', '') == 'L' for t in node.targets):
            rows = node.value.elts
    assert rows is not None, 'data.py 里没有 L'
    starts, groups = [], {}
    for r in rows:
        sec = ast.literal_eval(r.elts[0])
        grp = r.elts[3]
        grp = None if isinstance(grp, ast.Name) else ast.literal_eval(grp)
        n = ast.literal_eval(r.elts[4])
        if grp is not None and grp not in groups:
            groups[grp] = f'r{len(groups) + 1}'     # 韵组只留匿名编号
        starts.append((sec, groups.get(grp), n))

    T = lambda sec: sec * 96
    lyric = []
    for k, (st, grp, n) in enumerate(starts):
        nxt = T(starts[k + 1][0]) if k + 1 < len(starts) else nbars * TPBAR
        idx = [i for i, x in enumerate(notes) if T(st) - 12 <= x[0] < nxt - 12]
        if not idx:
            continue
        a, z = notes[idx[0]], notes[idx[-1]]
        lyric.append({'start': a[0], 'end': z[0] + z[1], 'last': z[0], 'notes': len(idx), 'rhymeGroup': grp, 'rhymeCount': n if grp else 0})

    gap = []
    cur = [notes[0]]
    for a, b in zip(notes, notes[1:]):
        if b[0] - (a[0] + a[1]) >= TPB // 2:
            gap.append(cur)
            cur = [b]
        else:
            cur.append(b)
    gap.append(cur)
    gap = [{'start': L[0][0], 'end': L[-1][0] + L[-1][1], 'last': L[-1][0], 'notes': len(L)} for L in gap]

    def end_beat(s):  # 这一句最后一个字的起点落在小节里第几拍（1–4）
        return (s['last'] % TPBAR) // TPB + 1

    lyric_ends = set(s['end'] for s in lyric)
    gap_ends = set(s['end'] for s in gap)
    stats = {
        'lyricSentences': len(lyric),
        'gapSentences': len(gap),
        'lyricEndBeat': {str(k): v for k, v in sorted(Counter(end_beat(s) for s in lyric).items())},
        # 主会话参照用的口径：最后一个字的起点四舍五入到半拍（4.75 拍算 5 = 下一小节第 1 拍之前，记进第 4 拍组）
        'lyricEndHalfBeat': {str(k): v for k, v in sorted(Counter(round(((s['last'] % TPBAR) / TPB + 1) * 2) / 2 for s in lyric).items())},
        'lyricEndsFoundByGap': len(lyric_ends & gap_ends),
        'lyricEndsMissedByGap': len(lyric_ends - gap_ends),
    }
    # 最长一段「只看 flow 一个断点都没有」的小节数
    longest = max(gap, key=lambda s: s['end'] - s['start'])
    stats['longestGapRun'] = {'startBar': longest['start'] // TPBAR, 'endBar': (longest['end'] - 1) // TPBAR,
                              'lyricSentencesInside': sum(1 for s in lyric if longest['start'] <= s['start'] < longest['end'])}
    # 「只看 flow」的建议断点（设计稿第 4 节 (b) 的规则）：空白 ≥ 半拍，或下一个字已经是下一段落；最后一个字也算
    sec_starts = {x['firstBar'] * TPBAR for x in sections}
    guess = []
    for i, (t, ln) in enumerate(notes):
        nxt = notes[i + 1] if i + 1 < len(notes) else None
        if nxt is None or nxt[0] - (t + ln) >= TPB // 2 or any(t < b <= nxt[0] for b in sec_starts):
            guess.append(t)
    lyric_last = set(s['last'] for s in lyric)
    hit = len(set(guess) & lyric_last)
    stats['heuristic'] = {'rule': 'gap>=24 or section boundary', 'suggested': len(guess), 'hit': hit,
                          'precision': round(hit / len(guess), 3), 'recall': round(hit / len(lyric_last), 3)}
    # 连续 ≥ 4 小节没有一处建议断点的地方（界面要提示「可能漏断」）
    runs, prev_end = [], notes[0][0]
    for t in guess:
        i = next(k for k, x in enumerate(notes) if x[0] == t)
        end = t + notes[i][1]
        if end - prev_end >= 4 * TPBAR:
            runs.append({'start': prev_end, 'end': end, 'bars': round((end - prev_end) / TPBAR, 2),
                         'lyricEndsInside': sum(1 for s in lyric if prev_end < s['end'] < end)})
        nxt = next((x[0] for x in notes if x[0] > t), None)
        prev_end = nxt if nxt is not None else end
    stats['longRuns'] = runs
    # 「按格子算韵脚」（v3：押句尾那一格里最后 n 个字）会出错的句子：句尾那一格里后面还有下一句的字
    starts = [x[0] for x in notes]
    wrong = [s for s in lyric if any(s['last'] < t < (s['last'] // TPB + 1) * TPB for t in starts)]
    idx = {t: i for i, t in enumerate(starts)}
    span2 = [s for s in lyric if s['notes'] >= 2 and starts[idx[s['last']] - 1] // TPB != s['last'] // TPB]
    stats['cellRule'] = {'nextSentenceInEndCell': len(wrong), 'lastTwoWordsInDifferentCells': len(span2)}
    out = {
        'about': '《恋爱循环》rap 版 flow 的断句参照：只有 tick，没有歌词。tick 是全曲绝对位置（每拍 48、每小节 192，第 0 小节是 Intro）。'
                 'lyricSentences = 按识别歌词断的句子；gapSentences = 只看 flow、空白 ≥ 半拍就断。start/end 是这一句第一个字的起点 / 最后一个字的结束，last 是最后一个字的起点。',
        'bpm': proj['bpm'], 'ticksPerBeat': TPB, 'bars': nbars, 'sections': sections,
        'notes': notes, 'lyricSentences': lyric, 'gapSentences': gap, 'guessEnds': guess, 'stats': stats,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    # 视觉稿用的同一份 tick（file:// 下浏览器不让 fetch JSON，所以另写一份 JS）
    js = {'sections': sections, 'notes': notes, 'ends': [s['last'] for s in lyric], 'guess': guess,
          'rhyme': [[s['last'], s['rhymeGroup'], s['rhymeCount']] for s in lyric if s['rhymeGroup']]}
    MOCK.write_text('/* 由 design/fixtures_v33/build_fixtures.py 生成，只有 tick，没有歌词。小节从 0 数（第 0 小节 = Intro）；界面行头从 1 数。 */\n'
                    'window.KOI = ' + json.dumps(js, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    print(json.dumps(stats, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
