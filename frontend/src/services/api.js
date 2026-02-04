/**
 * API 服务配置
 */

// 动态获取 API 地址 - 使用当前访问的主机名
function getApiBaseUrl() {
  // 优先使用环境变量
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  // 否则使用当前主机名 + 后端端口
  const hostname = window.location.hostname;
  return `http://${hostname}:8000`;
}

function getWsBaseUrl() {
  // 优先使用环境变量
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  // 否则使用当前主机名 + 后端端口
  const hostname = window.location.hostname;
  return `ws://${hostname}:8000`;
}

const API_BASE_URL = getApiBaseUrl();
const WS_BASE_URL = getWsBaseUrl();

/**
 * 通用请求方法
 */
async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
    },
  };
  
  const response = await fetch(url, { ...defaultOptions, ...options });
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.detail || '请求失败');
  }
  
  return data;
}

/**
 * API 接口
 */
export const api = {
  // 获取游戏配置
  getConfig: () => request('/api/config'),
  
  // 用户注册
  registerUser: (name) => request('/api/user/register', {
    method: 'POST',
    body: JSON.stringify({ name }),
  }),
  
  // 获取用户状态
  getUserStatus: (token) => request(`/api/user/${token}/status`),
  
  // 提交投票
  submitVote: (token, optionId) => request('/api/vote', {
    method: 'POST',
    body: JSON.stringify({ token, option_id: optionId }),
  }),
  
  // 获取投票结果
  getResults: () => request('/api/results'),
  
  // 主持人 - 获取当前轮次预设配置
  getRoundConfig: () => request('/api/host/round-config'),
  
  // 主持人 - 加载预设选项
  loadPresetOptions: () => request('/api/host/load-preset', { method: 'POST' }),
  
  // 主持人 - 创建选项
  createOptions: (options) => request('/api/host/options', {
    method: 'POST',
    body: JSON.stringify({ options }),
  }),
  
  // 主持人 - 开始投票
  startVoting: () => request('/api/host/start', { method: 'POST' }),
  
  // 主持人 - 结束投票
  endVoting: () => request('/api/host/end', { method: 'POST' }),
  
  // 主持人 - 下一轮
  nextRound: (newOptions = null) => request('/api/host/next-round', {
    method: 'POST',
    body: JSON.stringify({ new_options: newOptions }),
  }),
  
  // 主持人 - 重置游戏
  resetGame: () => request('/api/host/reset', { method: 'POST' }),
  
  // 主持人 - 获取用户列表
  getUsers: () => request('/api/host/users'),
  
  // 主持人 - 获取历史记录
  getHistory: () => request('/api/host/history'),
};

/**
 * WebSocket 连接
 */
export function createHostWebSocket(onMessage, onError, onClose) {
  const ws = new WebSocket(`${WS_BASE_URL}/ws/host`);
  
  ws.onopen = () => {
    // 减少日志输出
    if (import.meta.env.DEV) {
      console.log('Host WebSocket connected');
    }
  };
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch (e) {
      console.error('Failed to parse message:', e);
    }
  };
  
  ws.onerror = (error) => {
    // 减少错误日志刷屏
    if (onError) onError(error);
  };
  
  ws.onclose = () => {
    if (import.meta.env.DEV) {
      console.log('Host WebSocket disconnected');
    }
    if (onClose) onClose();
  };
  
  return ws;
}

export function createUserWebSocket(token, onMessage, onError, onClose) {
  const ws = new WebSocket(`${WS_BASE_URL}/ws/user/${token}`);
  
  ws.onopen = () => {
    if (import.meta.env.DEV) {
      console.log('User WebSocket connected');
    }
  };
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch (e) {
      console.error('Failed to parse message:', e);
    }
  };
  
  ws.onerror = (error) => {
    if (onError) onError(error);
  };
  
  ws.onclose = () => {
    if (import.meta.env.DEV) {
      console.log('User WebSocket disconnected');
    }
    if (onClose) onClose();
  };
  
  return ws;
}

/**
 * 获取投票页面URL（用于二维码）
 */
export function getVotePageUrl() {
  // 使用当前域名
  const baseUrl = window.location.origin;
  return `${baseUrl}/vote`;
}

export default api;
