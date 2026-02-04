# HappyDay - 二维码投票游戏

一个实时互动的二维码投票小游戏，支持多人参与，主持人控制游戏流程。

## 功能特点

- 扫码加入游戏
- 实时投票和结果展示
- 淘汰规则：多数派和未投票者被淘汰
- 平局时不淘汰投票者
- 每轮历史记录
- 预设选项配置

## 技术栈

- **前端**: React 19 + Vite 7 + SCSS
- **后端**: Python FastAPI + WebSocket

## 运行方式

### 后端
```bash
cd backend
pip install -r requirements.txt
python main.py
```

### 前端
```bash
cd frontend
npm install
npm run dev
```

## 访问地址

- 主持人页面: http://localhost:5173/
- 用户投票页面: 扫描主持人页面的二维码
