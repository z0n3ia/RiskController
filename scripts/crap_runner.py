# crap_runner.py —— CRAP 测量专用：进程内启动后端（coverage 可测量），跑完整测试链路后优雅退出
# 运行：python -m coverage run --source=backend/app scripts/crap_runner.py
import os
import subprocess
import sys
import threading
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'backend'))
sys.path.insert(0, ROOT)

# 复位数据库并灌种子（冷启动基线，与 replay 前置一致）
from app import db, seed  # noqa: E402

db.reset()
print('[runner] seeded:', seed.seed())

import uvicorn  # noqa: E402
from app.main import app  # noqa: E402

server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=8642, log_level='warning'))
t = threading.Thread(target=server.run, daemon=True)
t.start()

for _ in range(30):
    try:
        urllib.request.urlopen('http://127.0.0.1:8642/api/v1/health', timeout=2)
        print('[runner] backend UP')
        break
    except Exception:
        time.sleep(0.5)
else:
    sys.exit('backend failed to start')

# 依次执行测试链路（子进程为 HTTP 客户端，不影响进程内覆盖率）
for script in ('scripts/smoke.py', 'scripts/check_adapter.py',
               'scripts/replay.py', 'scripts/diag_fraud.py'):
    print('=' * 22, script, '=' * 22)
    subprocess.run([sys.executable, script], cwd=ROOT)

server.should_exit = True
t.join(timeout=30)
print('[runner] backend stopped, RUNNER_DONE')
