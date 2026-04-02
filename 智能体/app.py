"""
智能体 FastAPI 入口
启动命令: uvicorn app:app --host 0.0.0.0 --port 5001

环境变量:
  DASHSCOPE_API_KEY=你的阿里云API密钥
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
import sys
import os
from pathlib import Path

# 确保能导入 AI陪聊
sys.path.insert(0, str(Path(__file__).parent))
from AI陪聊 import AgentCore, Intent

app = FastAPI(title="老年人智能体服务", version="1.0.0")

# 从环境变量读取API Key
DASHSCOPE_API_KEY = os.environ.get('DASHSCOPE_API_KEY', '')

# 初始化智能体核心
agent = AgentCore(
    default_city="北京"
)

# 如果配置了API Key，设置到agent
if DASHSCOPE_API_KEY:
    agent._dashscope_api_key = DASHSCOPE_API_KEY
    print(f"✅ 已配置通义千问API (密钥前8位: {DASHSCOPE_API_KEY[:8]}...)")
else:
    print("⚠️ 未配置通义千问API，将使用本地兜底回复")
    print("   如需配置，设置环境变量: DASHSCOPE_API_KEY=你的密钥")


class ChatRequest(BaseModel):
    text: str
    user_id: str = "elderly_user"


class ChatResponse(BaseModel):
    intent: str
    reply: str
    user_id: str
    extra: Optional[dict] = {}


class InactiveCheckRequest(BaseModel):
    user_ids: list
    hours: float = 24.0


@app.get("/health")
def health():
    return {"status": "ok", "service": "老年人智能体"}


@app.post("/route")
def route(req: ChatRequest):
    """
    核心接口：接收用户消息，返回智能体回复
    """
    try:
        result = agent.route_intent(req.text, req.user_id)
        return ChatResponse(
            intent=result.intent.value,
            reply=result.reply,
            user_id=result.user_id,
            extra=result.extra
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/inactive-check")
def inactive_check(req: InactiveCheckRequest):
    """
    离线检测接口
    """
    inactive_users = agent.check_inactive_users(req.user_ids, hours=req.hours)
    return {"inactive_users": inactive_users, "hours": req.hours}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5001)
