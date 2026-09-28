# 电商实时风险控制系统（RiskController）

前后端分离的实时风控闭环演示系统：五类事件接入（login / coupon_receive / order_create / order_pay / after_sale_apply）→ 滑动窗口特征计算 → 黑白名单 + 规则评分 + 仲裁（Pass / Challenge / Review / Reject，0~59 / 60~79 / 80~100）→ 案件流转（待审 → 审核中 → 已处置 → 已归档）→ 名单联动 → 审计留痕。

依据《大致需求.md》§2.3 与《PRD-电商风控系统.md》实现，含模拟事件流数据集与羊毛党作弊场景端到端演示。

## 功能特性

- **决策流水线**：名单前置拦截 → 条件树规则引擎评分 → 仲裁分级，特征为 1h/24h/10m 滑动窗口实时聚合（非查表）
- **案件闭环**：Review 自动建案 → 审核员核对证据链（命中规则 / 特征快照 / 关联图谱）→ 处置（二次确认）→ 状态流转 → 名单联动
- **策略配置**：规则增删改查、阈值权重调整、名单库维护，改动实时生效
- **态势大盘**：核心指标、决策滚屏、风险分布
- **仿真测试**：构造事件实时命中验证，附未命中规则对照
- **角色权限**：风控审核员 / 风控策略师 / 系统管理员，按权限矩阵控制导航与操作

## 目录结构

```
RiskController/
├── frontend/          # 纯 HTML/CSS/JS 前端（无构建工具，api.js 为 HTTP 适配层）
├── backend/           # FastAPI + SQLite 决策管理服务（端口 8642）
│   ├── app/           #   db/config/engine(特征+规则+流水线)/routers(十组路由)/seed
│   ├── data/          #   运行时 SQLite（已 gitignore，空库启动自动灌种子）
│   └── requirements.txt
├── simulation/        # 模拟事件流数据集与演示脚本（纯 Node ≥18，零依赖，ESM）
│   ├── data/          #   users/rules/blacklist/scenarios + 生成产物 events_stream.jsonl
│   └── scripts/       #   generator 生成器 / engine 离线决策引擎 / demo 回放
├── scripts/           # 验证脚本：smoke / check_adapter / replay / verify
├── prototype/         # 早期交互线框原型
├── 大致需求.md / PRD-电商风控系统.md
└── 演示步骤清单.md     # ★ 跟着走的完整演示手册
```

## 快速开始

环境要求：Python 3.10+、Node.js ≥ 18（仿真用）、任意现代浏览器。

```powershell
# 1. 后端（首次启动自动建库并灌入种子：130 用户 / 9 规则 / 4 名单 / 406 图谱边）
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8642
# 验证：GET http://127.0.0.1:8642/api/v1/health → status UP

# 2. 前端（新终端）
cd frontend
python -m http.server 8643
# 浏览器打开 http://127.0.0.1:8643，登录页选择角色进入（演示级鉴权，免密码）

# 3. 模拟数据（可选重新生成；仓库已含生成产物，固定 seed=42 可复现）
cd simulation
npm run generate   # 重新生成 events_stream.jsonl
npm run demo       # 离线引擎回放（后端不可用时的降级演示）
```

### 端到端回放与验证（项目根目录运行）

```powershell
python scripts/verify.py         # 复位数据库 + 灌种子 + 引擎自检（打印 VERIFY_OK）
python scripts/smoke.py          # 全接口冒烟测试 24 项
python scripts/check_adapter.py  # 前后端适配层校验 6 项
python scripts/replay.py         # 761 事件端到端回放：处置前回放 → 拉黑团伙 → 对抗回放验证名单拦截
```

## 演示

按 [演示步骤清单.md](./演示步骤清单.md) 操作，核心场景：**S1 羊毛党批量领券**——同设备 6 账号领大额券 → 命中 R003/R007 评分 Review → 审核员拉黑（设备/IP/账号入黑名单）→ 团伙重试被名单事前拦截。另有 S2 恶意退款、S3 囤货聚集剧本。

## 角色权限矩阵

| 页面 | 审核员 | 策略师 | 管理员 |
|---|:-:|:-:|:-:|
| 态势大盘 / 工作台 / 仿真测试 | ✓ | ✓ | ✓ |
| 工作台·案件处置 | ✓ | — | — |
| 策略与规则配置 | — | ✓ | — |
| 操作审计流水 | — | ✓ | ✓ |
| 系统运行监控 | — | — | ✓ |

## 技术说明

- **前端**：hash 路由 + 角色导航；`js/api.js` 为 HTTP 适配层（统一信封解包 / `X-Role` 头 / 字段映射），页面代码与数据源解耦；`js/mock-data.js` 仅存静态文案兜底。
- **后端**：FastAPI + SQLite；`X-Role` 演示级鉴权（`require_role` 依赖）；全部敏感操作记审计；CORS 全放行（仅演示环境）。
- **数据复位**：停止后端后删除 `backend/data/riskguard.db`（连同 `-wal`/`-shm`），重启即自动重建；或直接运行 `python scripts/verify.py`。
