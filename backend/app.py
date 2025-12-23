"""
AnyBeats 韵脚助手后端
基于向量数据库的语义押韵词搜索
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer
import os

app = FastAPI(title="AnyBeats Rhyme API", version="1.0.0")

# CORS配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局变量
model = None
collection = None

# 数据库路径
DB_PATH = os.path.join(os.path.dirname(__file__), "rhyme_db")


class RhymeRequest(BaseModel):
    rhyme: str  # 韵母，如 "a", "an", "ang"
    word_length: int = 2  # 字数
    theme: Optional[str] = None  # 主题（可选）
    limit: int = 100  # 返回数量


class RhymeWord(BaseModel):
    word: str
    pinyin: str
    part_of_speech: str


class RhymeResponse(BaseModel):
    words: list[RhymeWord]
    total: int


@app.on_event("startup")
async def startup():
    """启动时加载模型和数据库"""
    global model, collection

    print("正在加载词嵌入模型...")
    # 使用中文词向量模型
    model = SentenceTransformer('shibing624/text2vec-base-chinese')
    print("模型加载完成")

    print("正在连接向量数据库...")
    client = chromadb.PersistentClient(path=DB_PATH)

    # 获取或创建collection
    try:
        collection = client.get_collection(name="rhyme_words")
        print(f"数据库连接成功，共有 {collection.count()} 个词汇")
    except Exception as e:
        print(f"警告：数据库未初始化，请先运行 python scripts/init_db.py")
        collection = None


@app.get("/")
async def root():
    """健康检查"""
    return {
        "status": "ok",
        "message": "AnyBeats Rhyme API",
        "db_ready": collection is not None and collection.count() > 0
    }


@app.get("/stats")
async def get_stats():
    """获取数据库统计信息"""
    if collection is None:
        raise HTTPException(status_code=503, detail="数据库未初始化")

    return {
        "total_words": collection.count(),
        "model": "text2vec-base-chinese"
    }


@app.post("/rhyme", response_model=RhymeResponse)
async def search_rhyme(request: RhymeRequest):
    """搜索押韵词汇"""
    if collection is None or collection.count() == 0:
        raise HTTPException(status_code=503, detail="数据库未初始化，请先运行初始化脚本")

    if model is None:
        raise HTTPException(status_code=503, detail="模型未加载")

    # 构建查询条件
    where_filter = {
        "$and": [
            {"rhyme": {"$eq": request.rhyme}},
            {"length": {"$eq": request.word_length}}
        ]
    }

    # 如果有主题，使用语义搜索
    if request.theme and request.theme.strip():
        # 将主题转换为向量
        theme_embedding = model.encode(request.theme).tolist()

        # 语义搜索 + 条件过滤
        results = collection.query(
            query_embeddings=[theme_embedding],
            where=where_filter,
            n_results=min(request.limit, 500),
            include=["metadatas", "documents"]
        )
    else:
        # 无主题时，直接按条件查询
        results = collection.get(
            where=where_filter,
            limit=request.limit,
            include=["metadatas", "documents"]
        )

    # 解析结果
    words = []

    if request.theme and request.theme.strip():
        # query返回的结果格式
        if results["ids"] and len(results["ids"]) > 0:
            ids = results["ids"][0]
            metadatas = results["metadatas"][0] if results["metadatas"] else []
            documents = results["documents"][0] if results["documents"] else []

            for i, word_id in enumerate(ids):
                metadata = metadatas[i] if i < len(metadatas) else {}
                word = documents[i] if i < len(documents) else ""

                words.append(RhymeWord(
                    word=word,
                    pinyin=metadata.get("pinyin", ""),
                    part_of_speech=metadata.get("pos", "其他")
                ))
    else:
        # get返回的结果格式
        if results["ids"]:
            for i, word_id in enumerate(results["ids"]):
                metadata = results["metadatas"][i] if results["metadatas"] else {}
                word = results["documents"][i] if results["documents"] else ""

                words.append(RhymeWord(
                    word=word,
                    pinyin=metadata.get("pinyin", ""),
                    part_of_speech=metadata.get("pos", "其他")
                ))

    return RhymeResponse(words=words, total=len(words))


@app.get("/rhymes")
async def list_available_rhymes():
    """获取所有可用的韵母列表"""
    rhymes = [
        {"value": "a", "label": "a (啊、大、沙)"},
        {"value": "ai", "label": "ai (爱、来、白)"},
        {"value": "an", "label": "an (安、看、山)"},
        {"value": "ang", "label": "ang (放、想、光)"},
        {"value": "ao", "label": "ao (好、道、高)"},
        {"value": "e", "label": "e (了、得、河)"},
        {"value": "ei", "label": "ei (给、飞、北)"},
        {"value": "en", "label": "en (人、很、门)"},
        {"value": "eng", "label": "eng (风、梦、冷)"},
        {"value": "i", "label": "i (你、意、地)"},
        {"value": "ia", "label": "ia (家、下、夏)"},
        {"value": "ian", "label": "ian (天、钱、面)"},
        {"value": "iang", "label": "iang (想、样、亮)"},
        {"value": "iao", "label": "iao (要、笑、叫)"},
        {"value": "ie", "label": "ie (夜、写、街)"},
        {"value": "in", "label": "in (心、金、林)"},
        {"value": "ing", "label": "ing (行、听、星)"},
        {"value": "iu", "label": "iu (流、九、秋)"},
        {"value": "o", "label": "o (我、多、波)"},
        {"value": "ong", "label": "ong (中、红、东)"},
        {"value": "ou", "label": "ou (走、头、手)"},
        {"value": "u", "label": "u (不、路、湖)"},
        {"value": "ua", "label": "ua (话、花、瓜)"},
        {"value": "uan", "label": "uan (完、转、暖)"},
        {"value": "uang", "label": "uang (王、光、黄)"},
        {"value": "ue", "label": "ue (说、月、雪)"},
        {"value": "ui", "label": "ui (对、最、回)"},
        {"value": "un", "label": "un (问、春、云)"},
        {"value": "uo", "label": "uo (说、过、火)"},
        {"value": "v", "label": "ü (女、绿、雨)"},
    ]
    return rhymes


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
