"""
面向老年人的智能体核心：意图路由、天气/健康/紧急、反诈与离线检测。
可与 FastAPI 挂载使用。
"""

from __future__ import annotations

import hashlib
import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)


def _local_chat_reply(text: str) -> str:
    t = text.strip()
    if not t:
        return "我在呢，您慢慢说，我会认真听着。"
    if any(k in t for k in ("你好", "您好", "在吗", "小守")):
        return "我在呢，您今天感觉怎么样？想聊聊天，还是需要我帮您看看天气、记录吃药？"
    if any(k in t for k in ("谢谢", "麻烦你了", "辛苦了")):
        return "不客气，我会一直陪着您。有需要的时候，随时叫我就好。"
    if any(k in t for k in ("睡不着", "失眠", "晚上睡不好")):
        return "睡不着的时候别着急，可以先放松一下，慢慢呼吸。我也可以陪您说说话，让心情平稳一点。"
    if any(k in t for k in ("想家", "想儿子", "想女儿", "想家人")):
        return "想家人是很正常的呀。您可以和我说说他们最近的事情，我陪您一起聊聊，也能帮您把这份想念记下来。"
    if any(k in t for k in ("难受", "不开心", "心慌", "害怕", "紧张")):
        return "我陪着您，您别着急，慢慢说就好。先深呼吸一下，有什么不舒服或者担心的事，都可以告诉我。"
    if any(k in t for k in ("吃饭", "喝水", "休息", "散步")):
        return "这样很好呀，按时吃饭、喝水、休息都很重要。您照顾好自己，我也会一直提醒您。"
    if any(k in t for k in ("今天天气", "出门", "遛弯")):
        return "如果您想出门，我也可以帮您看看天气，再提醒您多穿一件还是带把伞。"
    return f"我听到了，您刚才说“{t[:40]}”。您可以再多和我说一点，我会一直陪您聊下去。"


class Intent(str, Enum):
    WEATHER = "weather"
    HEALTH = "health"
    EMERGENCY = "emergency"
    FRAUD = "fraud"
    CHAT = "chat"


@dataclass
class RouteResult:
    """route_intent 的统一返回结构，便于 FastAPI 序列化。"""

    intent: Intent
    reply: str
    user_id: str
    extra: dict[str, Any] = field(default_factory=dict)


class AgentCore:
    """
    连接用户与第三方陪聊 AI 的中间层：意图识别、工具函数、活动与离线检测。
    """

    # 关键词可按业务扩展
    _FRAUD_KEYWORDS = ("转账", "银行卡", "验证码", "密码", "汇款", "网贷", "中奖")
    _EMERGENCY_KEYWORDS = ("迷路", "救命", "摔倒", "急救", "不舒服", "晕")
    _WEATHER_KEYWORDS = ("天气", "下雨", "温度", "气温", "冷不冷", "热不热", "刮风")
    _HEALTH_KEYWORDS = ("吃药", "打卡", "吃饭", "血压", "血糖", "睡眠")

    def __init__(
        self,
        data_dir: Optional[Path | str] = None,
        default_city: str = "北京",
        third_party_chat_url: Optional[str] = None,
        third_party_chat_headers: Optional[dict[str, str]] = None,
        third_party_fetcher: Optional[Callable[[str, str], str]] = None,
    ) -> None:
        self.default_city = default_city
        self.third_party_chat_url = third_party_chat_url
        self.third_party_chat_headers = third_party_chat_headers or {}
        self._third_party_fetcher = third_party_fetcher

        base = Path(data_dir) if data_dir else Path(__file__).resolve().parent
        self._data_dir = base
        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._health_log_path = self._data_dir / "health_logs.json"
        self._activity_path = self._data_dir / "user_activity.json"

    # --- 意图识别与路由 ---

    def route_intent(self, text: str, user_id: str) -> RouteResult:
        """
        接收用户文本，按优先级路由：反诈 > 紧急 > 天气 > 健康 > 普通聊天。
        普通聊天时调用第三方陪聊接口（若未配置则返回占位回复）。
        """
        self._touch_activity(user_id)
        t = text.strip()

        if self._match_any(t, self._FRAUD_KEYWORDS):
            return RouteResult(
                intent=Intent.FRAUD,
                reply=self._fraud_warning_text(),
                user_id=user_id,
                extra={"third_party_called": False},
            )

        if self._match_any(t, self._EMERGENCY_KEYWORDS):
            self.emergency_alert(user_id)
            return RouteResult(
                intent=Intent.EMERGENCY,
                reply="已为您联系紧急协助，请尽量待在原地，家人会尽快与您联系。",
                user_id=user_id,
                extra={"third_party_called": False},
            )

        if self._match_any(t, self._WEATHER_KEYWORDS):
            city = self._guess_city_from_text(t) or self.default_city
            return RouteResult(
                intent=Intent.WEATHER,
                reply=self.get_weather(city),
                user_id=user_id,
                extra={"city": city, "third_party_called": False},
            )

        if self._match_any(t, self._HEALTH_KEYWORDS):
            action = self._guess_health_action(t)
            self.log_health(user_id, action)
            return RouteResult(
                intent=Intent.HEALTH,
                reply=f"已帮您记录：{action}。注意按时休息，有事随时叫我。",
                user_id=user_id,
                extra={"action": action, "third_party_called": False},
            )

        chat_reply = self._call_third_party_chat(text, user_id)
        return RouteResult(
            intent=Intent.CHAT,
            reply=chat_reply,
            user_id=user_id,
            extra={"third_party_called": True},
        )

    @staticmethod
    def _match_any(text: str, keywords: tuple[str, ...]) -> bool:
        return any(k in text for k in keywords)

    @staticmethod
    def _fraud_warning_text() -> str:
        return (
            "【安全提醒】请不要向陌生人转账、透露银行卡号或短信验证码。"
            "凡是索要密码、验证码的，多半是诈骗。如有疑问，请先挂断并与子女或社区工作人员核实。"
        )

    def _guess_city_from_text(self, text: str) -> Optional[str]:
        for marker in ("市", "区", "县"):
            if marker in text:
                parts = text.replace("，", ",").split(",")
                for p in parts:
                    p = p.strip()
                    if marker in p and len(p) <= 12:
                        return p.replace("的", "").strip() or None
        return None

    def _guess_health_action(self, text: str) -> str:
        if "吃药" in text:
            return "吃药打卡"
        if "吃饭" in text:
            return "吃饭记录"
        if "打卡" in text:
            return "健康打卡"
        return "健康记录"

    # --- 天气（模拟 API） ---

    def get_weather(self, city: str = "默认城市") -> str:
        """模拟天气 API，返回口语化建议。"""
        name = city if city and city != "默认城市" else self.default_city
        seed = int(hashlib.md5(name.encode("utf-8")).hexdigest()[:8], 16)
        temp = 18 + (seed % 15)
        conditions = ["晴", "多云", "小雨", "阴"]
        cond = conditions[seed % len(conditions)]

        if temp >= 28:
            comfort = "有点热，出门记得带水和遮阳帽，中午少晒太阳。"
        elif temp >= 22:
            comfort = "很暖和，适合出去遛弯，穿轻便一点就行。"
        elif temp >= 15:
            comfort = "温度正好，可以加件薄外套再出门。"
        else:
            comfort = "有点凉，多穿一件，注意关节保暖。"

        rain_hint = "今天可能有小雨，记得带伞。" if cond == "小雨" else "路面干爽，走路当心台阶。"

        return f"{name}今天{cond}，大约{temp}度。{comfort}{rain_hint}"

    # --- 紧急求助 ---

    def emergency_alert(self, user_id: str) -> dict[str, Any]:
        """模拟获取经纬度并通知紧急联系人（日志）。"""
        lat, lon = self._mock_geo_for_user(user_id)
        msg = f"已发送位置给紧急联系人 user_id={user_id} lat={lat:.4f} lon={lon:.4f}"
        logger.warning(msg)
        print(msg)
        return {"user_id": user_id, "latitude": lat, "longitude": lon, "status": "sent"}

    @staticmethod
    def _mock_geo_for_user(user_id: str) -> tuple[float, float]:
        h = hashlib.sha256(user_id.encode("utf-8")).digest()
        lat = 39.9 + (h[0] / 255.0) * 0.2
        lon = 116.3 + (h[1] / 255.0) * 0.2
        return round(lat, 5), round(lon, 5)

    # --- 健康记录 ---

    def log_health(self, user_id: str, action: str) -> None:
        """将健康行为追加写入本地 JSON。"""
        data = self._read_json(self._health_log_path)
        if user_id not in data:
            data[user_id] = []
        entry = {
            "action": action,
            "logged_at": datetime.now(timezone.utc).isoformat(),
        }
        data[user_id].append(entry)
        self._write_json(self._health_log_path, data)

    # --- 活动与离线 ---

    def _touch_activity(self, user_id: str) -> None:
        data = self._read_json(self._activity_path)
        data[user_id] = datetime.now(timezone.utc).isoformat()
        self._write_json(self._activity_path, data)

    def update_last_active(self, user_id: str, at: Optional[datetime] = None) -> None:
        """手动更新某用户最后活跃时间（与 route_intent 内自动更新二选一或共用）。"""
        data = self._read_json(self._activity_path)
        ts = at or datetime.now(timezone.utc)
        data[user_id] = ts.isoformat()
        self._write_json(self._activity_path, data)

    def check_inactive_users(
        self,
        user_ids: list[str],
        hours: float = 24.0,
        now: Optional[datetime] = None,
    ) -> list[str]:
        """
        遍历用户 ID 列表，若最近一次对话时间超过指定小时数，则列入预警列表。
        时间来源：user_activity.json（需曾通过 route_intent / update_last_active 写入）。
        """
        activity = self._read_json(self._activity_path)
        cutoff = (now or datetime.now(timezone.utc)) - timedelta(hours=hours)
        warned: list[str] = []
        for uid in user_ids:
            raw = activity.get(uid)
            if not raw:
                warned.append(uid)
                continue
            try:
                last = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                if last.tzinfo is None:
                    last = last.replace(tzinfo=timezone.utc)
            except ValueError:
                warned.append(uid)
                continue
            if last < cutoff:
                warned.append(uid)
        return warned

    # --- 第三方陪聊 ---

    def _call_third_party_chat(self, text: str, user_id: str) -> str:
        if self._third_party_fetcher:
            return self._third_party_fetcher(text, user_id)
        if not self.third_party_chat_url:
            return _local_chat_reply(text)
        payload = json.dumps(
            {"user_id": user_id, "message": text},
            ensure_ascii=False,
        ).encode("utf-8")
        req = urllib.request.Request(
            self.third_party_chat_url,
            data=payload,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                **self.third_party_chat_headers,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read().decode("utf-8")
            parsed = json.loads(body)
            if isinstance(parsed, dict) and "reply" in parsed:
                return str(parsed["reply"])
            if isinstance(parsed, dict) and "message" in parsed:
                return str(parsed["message"])
            return body if body else "好的，我记下了。"
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as e:
            logger.exception("third_party_chat failed: %s", e)
            return _local_chat_reply(text)

    # --- JSON 辅助 ---

    def _read_json(self, path: Path) -> dict[str, Any]:
        if not path.exists():
            return {}
        try:
            with path.open("r", encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError:
            return {}

    def _write_json(self, path: Path, data: dict[str, Any]) -> None:
        with path.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
