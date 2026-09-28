# ============================================================
# models.py —— Pydantic 请求/响应模型（PRD §8 结果输出格式）
# ============================================================
from typing import Optional

from pydantic import BaseModel, Field


class LoginIn(BaseModel):
    account: str = Field(min_length=1)
    password: str = Field(min_length=1)
    role: str  # auditor / strategist / admin


class EventIn(BaseModel):
    eventType: str                      # login/coupon_receive/order_create/order_pay/after_sale_apply
    userId: str
    bizOrderId: Optional[str] = None
    deviceId: Optional[str] = None
    ip: Optional[str] = None
    timestamp: Optional[str] = None     # ISO；缺省取服务器当前时间
    payload: dict = {}


class DisposeIn(BaseModel):
    conclusion: str                     # pass / reject / black
    dims: list[str] = []                # black 时必填：user/phone/ip/device
    reason: str = Field(min_length=1)
    evidence: str = Field(min_length=1)


class RuleIn(BaseModel):
    code: Optional[str] = None          # 编辑时必传；新建自动生成
    name: str = Field(min_length=1)
    scene: str
    expr: dict                          # 条件树
    score: int = Field(ge=1, le=100)
    reasonTpl: str = ''
    enabled: bool = False               # 新建默认停用


class RuleToggleIn(BaseModel):
    enabled: bool


class ListBatchIn(BaseModel):
    listType: str                       # 黑名单/白名单/灰名单
    dim: str                            # 用户/手机号/IP/设备/地址
    values: list[str] = Field(min_length=1)
    reason: str = Field(min_length=1)


class SimulateIn(BaseModel):
    eventType: str
    userId: str
    payload: dict = {}
    timestamp: Optional[str] = None


class ConfigIn(BaseModel):
    reviewLine: Optional[int] = Field(default=None, ge=0, le=100)
    rejectLine: Optional[int] = Field(default=None, ge=0, le=100)
    challengeEnabled: Optional[bool] = None
    archiveDays: Optional[int] = Field(default=None, ge=1)
