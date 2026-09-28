# ============================================================
# main.py —— FastAPI 实例（PRD §6 后端决策管理服务）
# CORS 全放行（演示）+ 启动预热（建库/灌种子/特征引擎预热）
# ============================================================
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db, seed
from .engine.pipeline import now, pipeline
from .routers import (audit, auth, cases, config, events, features, graph,
                      lists, metrics, rules, simulate)

app = FastAPI(title='电商实时风险控制系统 · 决策管理服务', version='1.0.0')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'], allow_credentials=True,
    allow_methods=['*'], allow_headers=['*'],
)

for r in (auth, events, cases, rules, lists, graph, metrics, audit, simulate, config, features):
    app.include_router(r.router)


@app.on_event('startup')
def startup():
    """启动预热：建库建表 → 空库灌种子 → 特征引擎加载画像与历史窗口"""
    db._connect()
    if seed.seed():
        print('[startup] 空库检测：种子数据已装载')
    users = db.query('SELECT * FROM users')
    pipeline.warmup(users)
    print(f'[startup] 决策流水线预热完成（画像 {len(users)} 人）')


@app.get('/api/v1/health')
def health():
    return {'code': 0, 'data': {'status': 'UP', 'time': now()}}
