"""
初始化韵脚词库向量数据库

使用说明：
1. 确保已安装依赖: pip install -r requirements.txt
2. 运行此脚本: python scripts/init_db.py
3. 首次运行会下载词嵌入模型（约400MB）
"""

import os
import sys
import json
from collections import defaultdict

# 添加父目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import jieba
import jieba.posseg as pseg
from pypinyin import pinyin, Style
from sentence_transformers import SentenceTransformer
import chromadb
from tqdm import tqdm

# 路径配置
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "rhyme_db")
DATA_PATH = os.path.join(BASE_DIR, "data")

# 韵母映射表（将完整韵母映射到押韵类别）
RHYME_MAP = {
    # a 韵
    'a': 'a', 'ia': 'ia', 'ua': 'ua',
    # ai 韵
    'ai': 'ai', 'uai': 'ai',
    # an 韵
    'an': 'an', 'ian': 'ian', 'uan': 'uan', 'van': 'uan',
    # ang 韵
    'ang': 'ang', 'iang': 'iang', 'uang': 'uang',
    # ao 韵
    'ao': 'ao', 'iao': 'iao',
    # e 韵
    'e': 'e', 'o': 'o', 'uo': 'uo',
    # ei 韵
    'ei': 'ei', 'ui': 'ui', 'uei': 'ui',
    # en 韵
    'en': 'en', 'in': 'in', 'un': 'un', 'vn': 'un',
    # eng 韵
    'eng': 'eng', 'ing': 'ing', 'ong': 'ong', 'iong': 'ong',
    # i 韵
    'i': 'i', 'er': 'e', 'ii': 'i', 'iii': 'i',
    # ie 韵
    'ie': 'ie', 've': 'ue', 'ue': 'ue',
    # iu 韵
    'iu': 'iu', 'ou': 'ou', 'iou': 'iu',
    # u 韵
    'u': 'u', 'v': 'v',
}

# 词性映射
POS_MAP = {
    'n': '名词', 'nr': '名词', 'ns': '名词', 'nt': '名词', 'nz': '名词',
    'v': '动词', 'vd': '动词', 'vn': '动词',
    'a': '形容词', 'ad': '形容词', 'an': '形容词',
    'd': '副词',
    'i': '成语', 'l': '习语',
    'm': '数词', 'q': '量词',
    'r': '代词', 'p': '介词', 'c': '连词',
    'u': '助词', 'xc': '其他', 'w': '标点',
    'x': '其他', 'eng': '其他',
}


def get_rhyme(word: str) -> str:
    """获取词语最后一个字的韵母"""
    try:
        # 获取最后一个字的拼音
        py = pinyin(word[-1], style=Style.FINALS, strict=False)
        if py and py[0]:
            final = py[0][0].lower()
            # 映射到押韵类别
            return RHYME_MAP.get(final, final)
    except:
        pass
    return ""


def get_pinyin_str(word: str) -> str:
    """获取词语的完整拼音"""
    try:
        py = pinyin(word, style=Style.TONE)
        return ' '.join([p[0] for p in py])
    except:
        return ""


def get_pos(word: str) -> str:
    """获取词性"""
    words = pseg.cut(word)
    for w, flag in words:
        if w == word:
            return POS_MAP.get(flag, '其他')
    return '其他'


def load_jieba_dict() -> set:
    """从jieba词典加载词汇"""
    words = set()

    # jieba自带词典路径
    dict_path = os.path.join(os.path.dirname(jieba.__file__), 'dict.txt')

    print(f"正在加载jieba词典: {dict_path}")

    if os.path.exists(dict_path):
        with open(dict_path, 'r', encoding='utf-8') as f:
            for line in f:
                parts = line.strip().split(' ')
                if parts:
                    word = parts[0]
                    # 只保留2-7字的词
                    if 2 <= len(word) <= 7:
                        # 过滤掉包含非中文字符的词
                        if all('\u4e00' <= c <= '\u9fff' for c in word):
                            words.add(word)

    print(f"从jieba词典加载了 {len(words)} 个词汇")
    return words


def load_custom_words() -> set:
    """加载自定义词汇（如果有的话）"""
    words = set()
    custom_path = os.path.join(DATA_PATH, "custom_words.txt")

    if os.path.exists(custom_path):
        print(f"正在加载自定义词汇: {custom_path}")
        with open(custom_path, 'r', encoding='utf-8') as f:
            for line in f:
                word = line.strip()
                if word and 2 <= len(word) <= 7:
                    if all('\u4e00' <= c <= '\u9fff' for c in word):
                        words.add(word)
        print(f"加载了 {len(words)} 个自定义词汇")

    return words


def init_database():
    """初始化向量数据库"""
    print("=" * 50)
    print("AnyBeats 韵脚词库初始化")
    print("=" * 50)

    # 1. 加载词汇
    print("\n[1/4] 加载词汇...")
    all_words = load_jieba_dict()
    custom_words = load_custom_words()
    all_words.update(custom_words)
    print(f"总共 {len(all_words)} 个词汇")

    # 2. 处理词汇，提取拼音和韵母
    print("\n[2/4] 处理拼音和韵母...")
    word_data = []

    for word in tqdm(all_words, desc="处理词汇"):
        rhyme = get_rhyme(word)
        if rhyme:  # 只保留能识别韵母的词
            word_data.append({
                'word': word,
                'pinyin': get_pinyin_str(word),
                'rhyme': rhyme,
                'length': len(word),
                'pos': get_pos(word)
            })

    print(f"有效词汇: {len(word_data)} 个")

    # 按韵母统计
    rhyme_stats = defaultdict(int)
    for w in word_data:
        rhyme_stats[w['rhyme']] += 1
    print("\n韵母分布:")
    for rhyme, count in sorted(rhyme_stats.items(), key=lambda x: -x[1])[:15]:
        print(f"  {rhyme}: {count}")

    # 3. 生成词向量
    print("\n[3/4] 生成词向量（首次运行需下载模型，约400MB）...")
    model = SentenceTransformer('shibing624/text2vec-base-chinese')

    # 批量生成向量
    words_list = [w['word'] for w in word_data]
    batch_size = 1000
    all_embeddings = []

    for i in tqdm(range(0, len(words_list), batch_size), desc="生成向量"):
        batch = words_list[i:i+batch_size]
        embeddings = model.encode(batch, show_progress_bar=False)
        all_embeddings.extend(embeddings.tolist())

    # 4. 存入向量数据库
    print("\n[4/4] 存入向量数据库...")

    # 清理旧数据库
    if os.path.exists(DB_PATH):
        import shutil
        shutil.rmtree(DB_PATH)
    os.makedirs(DB_PATH, exist_ok=True)

    client = chromadb.PersistentClient(path=DB_PATH)

    # 创建collection
    collection = client.create_collection(
        name="rhyme_words",
        metadata={"description": "Chinese rhyme words for rap creation"}
    )

    # 批量插入
    batch_size = 5000
    for i in tqdm(range(0, len(word_data), batch_size), desc="写入数据库"):
        batch_end = min(i + batch_size, len(word_data))
        batch_data = word_data[i:batch_end]
        batch_embeddings = all_embeddings[i:batch_end]

        collection.add(
            ids=[f"word_{i+j}" for j in range(len(batch_data))],
            embeddings=batch_embeddings,
            documents=[w['word'] for w in batch_data],
            metadatas=[{
                'pinyin': w['pinyin'],
                'rhyme': w['rhyme'],
                'length': w['length'],
                'pos': w['pos']
            } for w in batch_data]
        )

    print("\n" + "=" * 50)
    print("初始化完成！")
    print(f"数据库路径: {DB_PATH}")
    print(f"总词汇数: {collection.count()}")
    print("=" * 50)

    # 保存统计信息
    stats = {
        'total_words': len(word_data),
        'rhyme_stats': dict(rhyme_stats)
    }
    with open(os.path.join(DATA_PATH, 'stats.json'), 'w', encoding='utf-8') as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    init_database()
