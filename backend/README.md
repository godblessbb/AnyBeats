# AnyBeats 韵脚后端

基于向量数据库的语义押韵词搜索服务。

## 功能特点

- 使用 jieba 词典作为词库（约10万词汇）
- pypinyin 提取准确韵母
- text2vec-base-chinese 词嵌入模型
- ChromaDB 向量数据库
- 支持语义搜索（按主题筛选）

## 快速开始

### 1. 安装依赖

```bash
cd backend
pip install -r requirements.txt
```

### 2. 初始化数据库（首次运行）

```bash
python scripts/init_db.py
```

首次运行会：
- 下载词嵌入模型（约400MB）
- 处理词库并生成向量
- 存入 ChromaDB

整个过程约需5-10分钟。

### 3. 启动服务

Windows:
```bash
start.bat
```

Linux/Mac:
```bash
chmod +x start.sh
./start.sh
```

### 4. API文档

启动后访问: http://localhost:8000/docs

## API 接口

### POST /rhyme

搜索押韵词汇

```json
{
  "rhyme": "a",
  "word_length": 2,
  "theme": "汽车",
  "limit": 100
}
```

响应：

```json
{
  "words": [
    {"word": "沙发", "pinyin": "shā fā", "part_of_speech": "名词"},
    ...
  ],
  "total": 100
}
```

### GET /stats

获取数据库统计信息

### GET /rhymes

获取所有可用韵母列表

## 添加自定义词汇

在 `data/custom_words.txt` 中添加词汇（每行一个），然后重新运行初始化脚本。
