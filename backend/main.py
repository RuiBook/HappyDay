"""
二维码投票系统 - FastAPI 后端
"""
import re
import os
import json
import uuid
import asyncio
from datetime import datetime
from typing import Dict, List, Optional, Set
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator


# ==================== 配置文件管理 ====================

CONFIG_FILE_PATH = os.path.join(os.path.dirname(__file__), "rounds_config.json")

def load_rounds_config():
    """加载轮次配置文件"""
    try:
        with open(CONFIG_FILE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {"rounds": {}, "default_options": ["选项A", "选项B"]}
    except json.JSONDecodeError:
        return {"rounds": {}, "default_options": ["选项A", "选项B"]}

def get_round_options(round_num: int) -> Optional[List[str]]:
    """获取指定轮次的预设选项"""
    config = load_rounds_config()
    round_key = str(round_num)
    if round_key in config.get("rounds", {}):
        return config["rounds"][round_key].get("options")
    return None

def get_round_title(round_num: int) -> Optional[str]:
    """获取指定轮次的标题"""
    config = load_rounds_config()
    round_key = str(round_num)
    if round_key in config.get("rounds", {}):
        return config["rounds"][round_key].get("title")
    return None


# ==================== 数据模型 ====================

class UserRegisterRequest(BaseModel):
    """用户注册请求"""
    name: str = Field(..., min_length=1, max_length=20, description="用户姓名")
    
    @field_validator('name')
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError('姓名不能为空')
        # 校验特殊字符
        if re.search(r'[<>"\'/\\;&|`$]', v):
            raise ValueError('姓名包含非法字符')
        return v


class UserRegisterResponse(BaseModel):
    """用户注册响应"""
    success: bool
    message: str
    token: Optional[str] = None
    user_name: Optional[str] = None
    options: Optional[List[dict]] = None


class VoteRequest(BaseModel):
    """投票请求"""
    token: str = Field(..., description="用户令牌")
    option_id: str = Field(..., description="选项ID")


class VoteResponse(BaseModel):
    """投票响应"""
    success: bool
    message: str


class VoteOption(BaseModel):
    """投票选项"""
    id: str
    name: str
    votes: int = 0


class GameConfig(BaseModel):
    """游戏配置"""
    options: List[VoteOption] = []
    round: int = 1
    status: str = "waiting"  # waiting, voting, result


class CreateOptionsRequest(BaseModel):
    """创建选项请求"""
    options: List[str] = Field(..., min_length=2, max_length=4, description="选项列表")


class NextRoundRequest(BaseModel):
    """下一轮请求"""
    new_options: Optional[List[str]] = None


# ==================== 数据存储（内存存储，生产环境应使用数据库） ====================

class DataStore:
    """内存数据存储"""
    def __init__(self):
        self.reset()
    
    def reset(self):
        """重置所有数据"""
        # 用户数据: {token: {"name": str, "voted": bool, "vote_option": str, "eliminated": bool}}
        self.users: Dict[str, dict] = {}
        # 投票选项: {option_id: VoteOption}
        self.options: Dict[str, VoteOption] = {}
        # 游戏状态
        self.game_status: str = "waiting"  # waiting, voting, result
        # 当前轮次
        self.round: int = 1
        # 被淘汰的用户token
        self.eliminated_users: Set[str] = set()
        # 每轮历史记录
        self.round_history: List[dict] = []
    
    def get_user_names(self) -> Set[str]:
        """获取所有已注册的用户名"""
        return {u["name"].lower() for u in self.users.values()}
    
    def is_name_taken(self, name: str) -> bool:
        """检查用户名是否已被使用"""
        return name.lower().strip() in self.get_user_names()
    
    def get_token_by_name(self, name: str) -> Optional[str]:
        """根据用户名获取token"""
        name_lower = name.lower().strip()
        for token, user in self.users.items():
            if user["name"].lower() == name_lower:
                return token
        return None


# 全局数据存储实例
store = DataStore()


# ==================== WebSocket 连接管理 ====================

class ConnectionManager:
    """WebSocket连接管理器"""
    def __init__(self):
        # 主持人连接
        self.host_connections: List[WebSocket] = []
        # 用户连接: {token: websocket}
        self.user_connections: Dict[str, WebSocket] = {}
    
    async def connect_host(self, websocket: WebSocket):
        """主持人连接"""
        await websocket.accept()
        self.host_connections.append(websocket)
    
    async def disconnect_host(self, websocket: WebSocket):
        """主持人断开"""
        if websocket in self.host_connections:
            self.host_connections.remove(websocket)
    
    async def connect_user(self, websocket: WebSocket, token: str):
        """用户连接"""
        await websocket.accept()
        self.user_connections[token] = websocket
    
    async def disconnect_user(self, token: str):
        """用户断开"""
        if token in self.user_connections:
            del self.user_connections[token]
    
    async def broadcast_to_hosts(self, message: dict):
        """广播给所有主持人"""
        disconnected = []
        for connection in self.host_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)
        for conn in disconnected:
            self.host_connections.remove(conn)
    
    async def broadcast_to_users(self, message: dict):
        """广播给所有用户"""
        disconnected = []
        for token, connection in self.user_connections.items():
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(token)
        for token in disconnected:
            del self.user_connections[token]
    
    async def send_to_user(self, token: str, message: dict):
        """发送给特定用户"""
        if token in self.user_connections:
            try:
                await self.user_connections[token].send_json(message)
            except Exception:
                del self.user_connections[token]


# 全局连接管理器
manager = ConnectionManager()


# ==================== FastAPI 应用 ====================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期"""
    yield
    # 清理资源

app = FastAPI(
    title="二维码投票系统",
    description="实时互动投票系统后端API",
    version="1.0.0",
    lifespan=lifespan
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应限制具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== API 接口 ====================

@app.get("/")
async def root():
    """根路径"""
    return {"message": "二维码投票系统API", "status": "running"}


@app.get("/api/config")
async def get_config():
    """获取游戏配置"""
    return {
        "status": store.game_status,
        "round": store.round,
        "options": [opt.model_dump() for opt in store.options.values()],
        "user_count": len([u for u in store.users.values() if not u.get("eliminated", False)]),
        "voted_count": len([u for u in store.users.values() if u.get("voted", False) and not u.get("eliminated", False)])
    }


@app.post("/api/user/register", response_model=UserRegisterResponse)
async def register_user(request: UserRegisterRequest):
    """用户注册（姓名校验）"""
    try:
        # 检查用户名是否已存在，如果存在则返回原有token和状态
        existing_token = store.get_token_by_name(request.name)
        if existing_token:
            user = store.users[existing_token]
            # 获取当前选项
            options = None
            if store.game_status == "voting":
                options = [{"id": opt.id, "name": opt.name} for opt in store.options.values()]
            
            return UserRegisterResponse(
                success=True,
                message="欢迎回来",
                token=existing_token,
                user_name=user["name"],
                options=options
            )
        
        # 新用户：生成唯一token
        token = str(uuid.uuid4())
        
        # 存储用户信息
        store.users[token] = {
            "name": request.name,
            "voted": False,
            "vote_option": None,
            "eliminated": False,
            "joined_at": datetime.now().isoformat()
        }
        
        # 获取当前选项
        options = None
        if store.game_status == "voting":
            options = [{"id": opt.id, "name": opt.name} for opt in store.options.values()]
        
        # 通知主持人有新用户加入
        await manager.broadcast_to_hosts({
            "type": "user_joined",
            "data": {
                "token": token,
                "name": request.name,
                "user_count": len([u for u in store.users.values() if not u.get("eliminated", False)])
            }
        })
        
        return UserRegisterResponse(
            success=True,
            message="姓名验证通过",
            token=token,
            user_name=request.name,
            options=options
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/user/{token}/status")
async def get_user_status(token: str):
    """获取用户状态"""
    if token not in store.users:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    user = store.users[token]
    options = None
    if store.game_status == "voting":
        options = [{"id": opt.id, "name": opt.name} for opt in store.options.values()]
    
    return {
        "name": user["name"],
        "voted": user["voted"],
        "vote_option": user["vote_option"],
        "eliminated": user.get("eliminated", False),
        "game_status": store.game_status,
        "round": store.round,
        "options": options
    }


@app.post("/api/vote", response_model=VoteResponse)
async def submit_vote(request: VoteRequest):
    """提交投票"""
    # 校验用户
    if request.token not in store.users:
        raise HTTPException(status_code=404, detail="用户不存在，请重新注册")
    
    user = store.users[request.token]
    
    # 校验用户是否被淘汰
    if user.get("eliminated", False):
        raise HTTPException(status_code=403, detail="您已被淘汰，无法投票")
    
    # 校验是否已投票
    if user["voted"]:
        raise HTTPException(status_code=400, detail="您已经投过票了")
    
    # 校验游戏状态
    if store.game_status != "voting":
        raise HTTPException(status_code=400, detail="当前不在投票阶段")
    
    # 校验选项是否合法
    if request.option_id not in store.options:
        raise HTTPException(status_code=400, detail="无效的选项")
    
    # 更新投票
    store.options[request.option_id].votes += 1
    user["voted"] = True
    user["vote_option"] = request.option_id
    
    # 广播投票更新给主持人
    await manager.broadcast_to_hosts({
        "type": "vote_update",
        "data": {
            "options": [opt.model_dump() for opt in store.options.values()],
            "voted_count": len([u for u in store.users.values() if u.get("voted", False) and not u.get("eliminated", False)]),
            "user_count": len([u for u in store.users.values() if not u.get("eliminated", False)])
        }
    })
    
    return VoteResponse(success=True, message="投票成功")


@app.get("/api/results")
async def get_results():
    """获取投票结果"""
    return {
        "round": store.round,
        "status": store.game_status,
        "options": [opt.model_dump() for opt in store.options.values()],
        "total_votes": sum(opt.votes for opt in store.options.values()),
        "users": [
            {
                "name": u["name"],
                "voted": u["voted"],
                "eliminated": u.get("eliminated", False)
            }
            for u in store.users.values()
        ]
    }


# ==================== 主持人管理接口 ====================

@app.get("/api/host/round-config")
async def get_round_config():
    """获取当前轮次的预设配置"""
    preset_options = get_round_options(store.round)
    preset_title = get_round_title(store.round)
    
    return {
        "round": store.round,
        "has_preset": preset_options is not None,
        "preset_options": preset_options,
        "preset_title": preset_title,
        "message": "已加载预设选项" if preset_options else "当前轮次无预设选项，请手动设置"
    }


@app.post("/api/host/load-preset")
async def load_preset_options():
    """加载当前轮次的预设选项"""
    preset_options = get_round_options(store.round)
    
    if not preset_options:
        raise HTTPException(status_code=404, detail="当前轮次无预设选项，请手动设置")
    
    # 清空现有选项和投票
    store.options.clear()
    
    # 重置用户投票状态
    for user in store.users.values():
        if not user.get("eliminated", False):
            user["voted"] = False
            user["vote_option"] = None
    
    # 创建预设选项
    for i, name in enumerate(preset_options):
        option_id = f"option_{i+1}"
        store.options[option_id] = VoteOption(id=option_id, name=name)
    
    return {
        "success": True,
        "options": [opt.model_dump() for opt in store.options.values()],
        "message": f"已加载第 {store.round} 轮预设选项"
    }


@app.post("/api/host/options")
async def create_options(request: CreateOptionsRequest):
    """主持人创建选项"""
    # 清空现有选项和投票
    store.options.clear()
    
    # 重置用户投票状态
    for user in store.users.values():
        if not user.get("eliminated", False):
            user["voted"] = False
            user["vote_option"] = None
    
    # 创建新选项
    for i, name in enumerate(request.options):
        option_id = f"option_{i+1}"
        store.options[option_id] = VoteOption(id=option_id, name=name)
    
    return {
        "success": True,
        "options": [opt.model_dump() for opt in store.options.values()]
    }


@app.post("/api/host/start")
async def start_voting():
    """开始投票"""
    if not store.options:
        raise HTTPException(status_code=400, detail="请先设置投票选项")
    
    store.game_status = "voting"
    
    # 广播给所有用户
    await manager.broadcast_to_users({
        "type": "voting_started",
        "data": {
            "round": store.round,
            "options": [{"id": opt.id, "name": opt.name} for opt in store.options.values()]
        }
    })
    
    # 广播给主持人
    await manager.broadcast_to_hosts({
        "type": "status_change",
        "data": {"status": "voting", "round": store.round}
    })
    
    return {"success": True, "message": "投票已开始"}


@app.post("/api/host/end")
async def end_voting():
    """结束投票"""
    if store.game_status != "voting":
        raise HTTPException(status_code=400, detail="当前不在投票阶段")
    
    store.game_status = "result"
    
    # 获取结果
    results = [opt.model_dump() for opt in store.options.values()]
    
    # 广播给所有用户
    await manager.broadcast_to_users({
        "type": "voting_ended",
        "data": {
            "round": store.round,
            "results": results
        }
    })
    
    # 广播给主持人
    await manager.broadcast_to_hosts({
        "type": "status_change",
        "data": {"status": "result", "results": results}
    })
    
    return {"success": True, "message": "投票已结束", "results": results}


@app.post("/api/host/next-round")
async def next_round(request: NextRoundRequest):
    """进入下一轮（淘汰多数派和未投票者，平局不淘汰）"""
    if store.game_status != "result":
        raise HTTPException(status_code=400, detail="请先结束当前投票")
    
    # 获取所有选项的票数
    vote_counts = [opt.votes for opt in store.options.values()]
    
    # 检查是否平局（所有选项票数相同）
    is_tie = len(set(vote_counts)) == 1 and vote_counts[0] > 0
    
    eliminated_tokens = []
    survivors = []  # 胜出者
    
    # 记录本轮选项信息
    round_options = [{"name": opt.name, "votes": opt.votes} for opt in store.options.values()]
    
    if is_tie:
        # 平局：只淘汰未投票的用户
        for token, user in store.users.items():
            if user.get("eliminated", False):
                continue
            # 没有投票的用户被淘汰
            if not user.get("voted", False):
                user["eliminated"] = True
                store.eliminated_users.add(token)
                eliminated_tokens.append(token)
            else:
                survivors.append(user["name"])
    else:
        # 非平局：找出得票最多的选项（多数派）
        max_votes = max(opt.votes for opt in store.options.values())
        majority_options = [opt.id for opt in store.options.values() if opt.votes == max_votes]
        
        # 淘汰规则：
        # 1. 投了多数派的用户被淘汰
        # 2. 没有投票的用户也被淘汰
        for token, user in store.users.items():
            if user.get("eliminated", False):
                continue  # 已经被淘汰的跳过
            
            # 没有投票的用户被淘汰
            if not user.get("voted", False):
                user["eliminated"] = True
                store.eliminated_users.add(token)
                eliminated_tokens.append(token)
            # 投了多数派的用户被淘汰
            elif user.get("vote_option") in majority_options:
                user["eliminated"] = True
                store.eliminated_users.add(token)
                eliminated_tokens.append(token)
            else:
                survivors.append(user["name"])
    
    # 记录本轮历史
    eliminated_names = [store.users[t]["name"] for t in eliminated_tokens]
    store.round_history.append({
        "round": store.round,
        "options": round_options,
        "is_tie": is_tie,
        "survivors": survivors,
        "eliminated": eliminated_names
    })
    
    # 通知被淘汰的用户
    for token in eliminated_tokens:
        await manager.send_to_user(token, {
            "type": "eliminated",
            "data": {"message": "您已被淘汰"}
        })
    
    # 重置投票状态
    store.round += 1
    store.game_status = "waiting"
    store.options.clear()
    
    for user in store.users.values():
        if not user.get("eliminated", False):
            user["voted"] = False
            user["vote_option"] = None
    
    # 如果提供了新选项，直接设置
    if request.new_options:
        for i, name in enumerate(request.new_options):
            option_id = f"option_{i+1}"
            store.options[option_id] = VoteOption(id=option_id, name=name)
    
    # 广播给未被淘汰的用户
    await manager.broadcast_to_users({
        "type": "next_round",
        "data": {
            "round": store.round,
            "eliminated_count": len(eliminated_tokens),
            "is_tie": is_tie
        }
    })
    
    # 广播给主持人
    await manager.broadcast_to_hosts({
        "type": "round_change",
        "data": {
            "round": store.round,
            "eliminated_tokens": eliminated_tokens,
            "active_users": len([u for u in store.users.values() if not u.get("eliminated", False)]),
            "is_tie": is_tie
        }
    })
    
    return {
        "success": True,
        "round": store.round,
        "eliminated_count": len(eliminated_tokens),
        "active_users": len([u for u in store.users.values() if not u.get("eliminated", False)]),
        "is_tie": is_tie,
        "message": "平局！本轮不淘汰任何投票者" if is_tie else f"淘汰了 {len(eliminated_tokens)} 人"
    }


@app.post("/api/host/reset")
async def reset_game():
    """重置游戏"""
    store.reset()
    
    # 广播给所有连接
    await manager.broadcast_to_users({
        "type": "game_reset",
        "data": {"message": "游戏已重置"}
    })
    
    await manager.broadcast_to_hosts({
        "type": "game_reset",
        "data": {"message": "游戏已重置"}
    })
    
    return {"success": True, "message": "游戏已重置"}


@app.get("/api/host/users")
async def get_users():
    """获取所有用户列表"""
    users = []
    for token, user in store.users.items():
        users.append({
            "token": token,
            "name": user["name"],
            "voted": user["voted"],
            "eliminated": user.get("eliminated", False),
            "vote_option": user.get("vote_option")
        })
    return {"users": users, "total": len(users)}


@app.get("/api/host/history")
async def get_round_history():
    """获取每轮历史记录"""
    return {
        "history": store.round_history,
        "current_round": store.round,
        "total_rounds": len(store.round_history)
    }


# ==================== WebSocket 端点 ====================

@app.websocket("/ws/host")
async def websocket_host(websocket: WebSocket):
    """主持人WebSocket连接"""
    await manager.connect_host(websocket)
    try:
        # 发送当前状态
        await websocket.send_json({
            "type": "init",
            "data": {
                "status": store.game_status,
                "round": store.round,
                "options": [opt.model_dump() for opt in store.options.values()],
                "users": [
                    {
                        "token": token,
                        "name": u["name"],
                        "voted": u["voted"],
                        "eliminated": u.get("eliminated", False)
                    }
                    for token, u in store.users.items()
                ]
            }
        })
        
        # 保持连接
        while True:
            data = await websocket.receive_text()
            # 可以处理主持人发来的消息
            
    except WebSocketDisconnect:
        await manager.disconnect_host(websocket)


@app.websocket("/ws/user/{token}")
async def websocket_user(websocket: WebSocket, token: str):
    """用户WebSocket连接"""
    if token not in store.users:
        await websocket.close(code=4001)
        return
    
    await manager.connect_user(websocket, token)
    try:
        user = store.users[token]
        
        # 发送当前状态
        options = None
        if store.game_status == "voting":
            options = [{"id": opt.id, "name": opt.name} for opt in store.options.values()]
        
        await websocket.send_json({
            "type": "init",
            "data": {
                "status": store.game_status,
                "round": store.round,
                "options": options,
                "voted": user["voted"],
                "eliminated": user.get("eliminated", False)
            }
        })
        
        # 保持连接
        while True:
            data = await websocket.receive_text()
            # 可以处理用户发来的消息
            
    except WebSocketDisconnect:
        await manager.disconnect_user(token)


# ==================== 启动入口 ====================

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
