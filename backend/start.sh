#!/bin/bash
echo "========================================"
echo "  AnyBeats 韵脚后端服务"
echo "========================================"
echo

# 检查虚拟环境
if [ -z "$VIRTUAL_ENV" ] && [ -d "venv" ]; then
    echo "激活虚拟环境..."
    source venv/bin/activate
fi

# 检查数据库是否初始化
if [ ! -f "rhyme_db/chroma.sqlite3" ]; then
    echo
    echo "[警告] 数据库未初始化，正在初始化..."
    echo "首次运行需要下载模型，请耐心等待..."
    echo
    python scripts/init_db.py
    if [ $? -ne 0 ]; then
        echo
        echo "[错误] 初始化失败，请检查依赖是否安装"
        echo "运行: pip install -r requirements.txt"
        exit 1
    fi
fi

echo
echo "启动后端服务..."
echo "API地址: http://localhost:8000"
echo "API文档: http://localhost:8000/docs"
echo
python -m uvicorn app:app --host 0.0.0.0 --port 8000 --reload
