import { useState, useEffect, useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { message } from 'antd';
import { api, createHostWebSocket, getVotePageUrl } from '../../services/api';
import { gameConfig } from '../../config/game.config';
import './HostPage.scss';

const HostPage = () => {
  // 选项设置
  const [options, setOptions] = useState(gameConfig.host.defaultOptions);
  const [inputOptions, setInputOptions] = useState(gameConfig.host.defaultOptions);
  
  // 预设选项
  const [hasPreset, setHasPreset] = useState(false);
  const [presetTitle, setPresetTitle] = useState('');
  
  // 游戏状态
  const [gameStatus, setGameStatus] = useState('waiting'); // waiting, voting, result
  const [round, setRound] = useState(1);
  const [voteResults, setVoteResults] = useState([]);
  
  // 用户状态
  const [users, setUsers] = useState([]);
  const [votedCount, setVotedCount] = useState(0);
  
  // 历史记录
  const [roundHistory, setRoundHistory] = useState([]);
  
  // 会话ID（二维码）
  const [sessionId, setSessionId] = useState('');
  
  // 加载和错误状态
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  // WebSocket 引用
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const isUnmountedRef = useRef(false);

  // WebSocket 连接
  const connectWebSocket = useCallback(() => {
    // 如果组件已卸载，不再重连
    if (isUnmountedRef.current) return;
    
    // 清除之前的重连定时器
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    
    // 关闭现有连接
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      wsRef.current.close();
    }
    
    wsRef.current = createHostWebSocket(
      (message) => {
        handleWebSocketMessage(message);
      },
      (error) => {
        // 只在开发环境打印错误
        if (import.meta.env.DEV) {
          console.warn('WebSocket error');
        }
      },
      () => {
        // 断开后尝试重连（组件未卸载时）
        if (!isUnmountedRef.current) {
          reconnectTimerRef.current = setTimeout(() => {
            connectWebSocket();
          }, 5000); // 增加重连间隔到5秒
        }
      }
    );
  }, []);

  // 处理 WebSocket 消息
  const handleWebSocketMessage = (message) => {
    const { type, data } = message;
    
    switch (type) {
      case 'init':
        setGameStatus(data.status);
        setRound(data.round);
        if (data.options) {
          setVoteResults(data.options);
          setOptions(data.options.map(o => o.name));
        }
        if (data.users) {
          setUsers(data.users);
          setVotedCount(data.users.filter(u => u.voted && !u.eliminated).length);
        }
        if (data.session_id) {
          setSessionId(data.session_id);
        }
        setError('');
        break;
        
      case 'user_joined':
        setUsers(prev => {
          const exists = prev.some(u => u.token === data.token);
          if (exists) return prev;
          return [...prev, { token: data.token, name: data.name, voted: false, eliminated: false }];
        });
        break;
        
      case 'vote_update':
        setVoteResults(data.options);
        setVotedCount(data.voted_count);
        break;
        
      case 'status_change':
        setGameStatus(data.status);
        if (data.results) {
          setVoteResults(data.results);
        }
        break;
        
      case 'round_change':
        setRound(data.round);
        setGameStatus('waiting');
        setVoteResults([]);
        setVotedCount(0);
        // 更新用户列表，标记被淘汰的
        setUsers(prev => prev.map(u => ({
          ...u,
          eliminated: data.eliminated_tokens?.includes(u.token) || u.eliminated,
          voted: false
        })));
        break;
        
      case 'session_refreshed':
        setSessionId(data.session_id);
        break;
        
      case 'game_reset':
        setGameStatus('waiting');
        setRound(1);
        setVoteResults([]);
        setUsers([]);
        setVotedCount(0);
        setOptions(gameConfig.host.defaultOptions);
        setInputOptions(gameConfig.host.defaultOptions);
        setRoundHistory([]);
        break;
        
      default:
        break;
    }
  };

  // 初始化连接
  useEffect(() => {
    isUnmountedRef.current = false;
    connectWebSocket();
    
    return () => {
      isUnmountedRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectWebSocket]);

  // 检查当前轮次是否有预设选项
  const checkPresetOptions = useCallback(async () => {
    try {
      const config = await api.getRoundConfig();
      setHasPreset(config.has_preset);
      setPresetTitle(config.preset_title || '');
      if (config.has_preset && config.preset_options) {
        setInputOptions(config.preset_options);
      }
    } catch (err) {
      console.error('获取轮次配置失败:', err);
    }
  }, []);

  // 轮次变化时检查预设
  useEffect(() => {
    if (gameStatus === 'waiting') {
      checkPresetOptions();
    }
  }, [round, gameStatus, checkPresetOptions]);

  // 获取历史记录
  const fetchHistory = useCallback(async () => {
    try {
      const result = await api.getHistory();
      setRoundHistory(result.history || []);
    } catch (err) {
      console.error('获取历史记录失败:', err);
    }
  }, []);

  // 轮次变化或游戏状态变化时更新历史
  useEffect(() => {
    fetchHistory();
  }, [round, fetchHistory]);

  // 初始化获取会话ID
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const result = await api.getSession();
        setSessionId(result.session_id);
      } catch (err) {
        console.error('获取会话ID失败:', err);
      }
    };
    fetchSession();
  }, []);

  // 刷新二维码
  const refreshQRCode = async () => {
    setIsLoading(true);
    setError('');
    
    try {
      const result = await api.refreshQRCode();
      setSessionId(result.session_id);
      message.success('二维码已刷新，旧二维码已失效');
    } catch (err) {
      message.error(err.message || '刷新二维码失败');
    } finally {
      setIsLoading(false);
    }
  };

  // 加载预设选项
  const loadPreset = async () => {
    setIsLoading(true);
    setError('');
    
    try {
      const result = await api.loadPresetOptions();
      setInputOptions(result.options.map(o => o.name));
      message.success(result.message);
    } catch (err) {
      message.error(err.message || '加载预设失败');
    } finally {
      setIsLoading(false);
    }
  };

  // 添加选项
  const addOption = () => {
    if (inputOptions.length < gameConfig.host.maxOptions) {
      setInputOptions([...inputOptions, `选项${String.fromCharCode(65 + inputOptions.length)}`]);
    }
  };

  // 删除选项
  const removeOption = (index) => {
    if (inputOptions.length > gameConfig.host.minOptions) {
      setInputOptions(inputOptions.filter((_, i) => i !== index));
    }
  };

  // 修改选项
  const updateOption = (index, value) => {
    const newOptions = [...inputOptions];
    newOptions[index] = value;
    setInputOptions(newOptions);
  };

  // 保存选项并开始投票
  const startVoting = async () => {
    // 验证选项
    const validOptions = inputOptions.filter(o => o.trim());
    if (validOptions.length < 2) {
      setError('至少需要2个有效选项');
      return;
    }
    
    setIsLoading(true);
    setError('');
    
    try {
      // 先创建选项
      await api.createOptions(validOptions);
      setOptions(validOptions);
      
      // 开始投票
      await api.startVoting();
      setGameStatus('voting');
      setVotedCount(0);
    } catch (err) {
      setError(err.message || '操作失败');
    } finally {
      setIsLoading(false);
    }
  };

  // 结束投票
  const endVoting = async () => {
    setIsLoading(true);
    setError('');
    
    try {
      const result = await api.endVoting();
      setGameStatus('result');
      if (result.results) {
        setVoteResults(result.results);
      }
    } catch (err) {
      setError(err.message || '操作失败');
    } finally {
      setIsLoading(false);
    }
  };

  // 进入下一轮
  const nextRound = async () => {
    setIsLoading(true);
    setError('');
    
    try {
      await api.nextRound();
      setGameStatus('waiting');
      setInputOptions(gameConfig.host.defaultOptions);
      setVotedCount(0);
    } catch (err) {
      setError(err.message || '操作失败');
    } finally {
      setIsLoading(false);
    }
  };

  // 重置游戏
  const resetGame = async () => {
    if (!window.confirm('确定要重置游戏吗？所有数据将被清除。')) {
      return;
    }
    
    setIsLoading(true);
    setError('');
    
    try {
      await api.resetGame();
      setGameStatus('waiting');
      setRound(1);
      setVoteResults([]);
      setUsers([]);
      setVotedCount(0);
      setOptions(gameConfig.host.defaultOptions);
      setInputOptions(gameConfig.host.defaultOptions);
    } catch (err) {
      setError(err.message || '操作失败');
    } finally {
      setIsLoading(false);
    }
  };

  // 计算统计数据
  const activeUsers = users.filter(u => !u.eliminated);
  const totalVotes = voteResults.reduce((sum, opt) => sum + (opt.votes || 0), 0);

  return (
    <div className="host-page">
      <header className="host-page__header">
        <h1 className="host-page__title">{gameConfig.title} - 主持人控制台</h1>
        <div className="host-page__info">
          <span className="host-page__round">第 {round} 轮</span>
          <span className="host-page__players">在线玩家: {activeUsers.length}</span>
          <span className={`host-page__status host-page__status--${gameStatus}`}>
            {gameStatus === 'waiting' && '等待中'}
            {gameStatus === 'voting' && '投票中'}
            {gameStatus === 'result' && '已结束'}
          </span>
        </div>
      </header>

      {error && (
        <div className="host-page__error-banner">
          {error}
        </div>
      )}

      <div className="host-page__content">
        <section className="host-page__qrcode">
          <h2>扫码加入游戏</h2>
          <div className="host-page__qrcode-wrapper">
            <QRCodeSVG value={getVotePageUrl(sessionId)} size={200} />
          </div>
          <p className="host-page__url">{getVotePageUrl(sessionId)}</p>
          <button 
            onClick={refreshQRCode} 
            className="host-page__btn host-page__btn--refresh"
            disabled={isLoading}
          >
            🔄 刷新二维码
          </button>
          <p className="host-page__session-hint">刷新后旧二维码将失效</p>
        </section>

        <section className="host-page__options">
          <h2>设置选项 {presetTitle && `- ${presetTitle}`}</h2>
          
          {gameStatus === 'waiting' && (
            <div className="host-page__preset-info">
              {hasPreset ? (
                <div className="host-page__preset-badge host-page__preset-badge--has">
                  ✓ 当前轮次有预设选项
                  <button 
                    onClick={loadPreset} 
                    className="host-page__preset-btn"
                    disabled={isLoading}
                  >
                    重新加载预设
                  </button>
                </div>
              ) : (
                <div className="host-page__preset-badge host-page__preset-badge--none">
                  ⚠ 当前轮次无预设选项，请手动设置
                </div>
              )}
            </div>
          )}
          
          <div className="host-page__options-list">
            {inputOptions.map((option, index) => (
              <div key={index} className="host-page__option-item">
                <input
                  type="text"
                  value={option}
                  onChange={(e) => updateOption(index, e.target.value)}
                  disabled={gameStatus !== 'waiting' || isLoading}
                  className="host-page__option-input"
                  placeholder={`选项 ${index + 1}`}
                />
                {inputOptions.length > gameConfig.host.minOptions && gameStatus === 'waiting' && (
                  <button
                    onClick={() => removeOption(index)}
                    className="host-page__option-remove"
                    disabled={isLoading}
                  >
                    删除
                  </button>
                )}
              </div>
            ))}
          </div>
          {inputOptions.length < gameConfig.host.maxOptions && gameStatus === 'waiting' && (
            <button onClick={addOption} className="host-page__add-option" disabled={isLoading}>
              + 添加选项
            </button>
          )}
        </section>

        <section className="host-page__controls">
          <h2>游戏控制</h2>
          <div className="host-page__buttons">
            {gameStatus === 'waiting' && (
              <button 
                onClick={startVoting} 
                className="host-page__btn host-page__btn--primary"
                disabled={isLoading || activeUsers.length === 0}
              >
                {isLoading ? '处理中...' : '开始投票'}
              </button>
            )}
            {gameStatus === 'voting' && (
              <button 
                onClick={endVoting} 
                className="host-page__btn host-page__btn--success"
                disabled={isLoading}
              >
                {isLoading ? '处理中...' : `结束投票 (${votedCount}/${activeUsers.length})`}
              </button>
            )}
            {gameStatus === 'result' && (
              <button 
                onClick={nextRound} 
                className="host-page__btn host-page__btn--primary"
                disabled={isLoading}
              >
                {isLoading ? '处理中...' : '下一轮（淘汰多数派+未投票）'}
              </button>
            )}
            <button 
              onClick={resetGame} 
              className="host-page__btn host-page__btn--danger"
              disabled={isLoading}
            >
              重置游戏
            </button>
          </div>
        </section>

        <section className="host-page__results">
          <h2>投票结果 {gameStatus === 'voting' && `(投票中: ${votedCount}/${activeUsers.length})`}</h2>
          {gameStatus === 'result' && voteResults.length > 0 ? (
            <div className="host-page__results-chart">
              {voteResults.map((option) => {
                const count = option.votes || 0;
                const percentage = totalVotes > 0 ? (count / totalVotes * 100).toFixed(1) : 0;
                return (
                  <div key={option.id} className="host-page__result-item">
                    <div className="host-page__result-label">
                      <span>{option.name}</span>
                      <span>{count} 票 ({percentage}%)</span>
                    </div>
                    <div className="host-page__result-bar">
                      <div
                        className="host-page__result-fill"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="host-page__no-data">
              {gameStatus === 'voting' ? '投票进行中，结束后显示结果...' : '暂无投票数据'}
            </p>
          )}
        </section>

        <section className="host-page__players-list">
          <h2>玩家列表 ({users.length})</h2>
          {users.length > 0 ? (
            <div className="host-page__players-grid">
              {users.map((player) => (
                <div
                  key={player.token}
                  className={`host-page__player-card ${
                    player.eliminated ? 'host-page__player-card--eliminated' : ''
                  } ${player.voted && !player.eliminated ? 'host-page__player-card--voted' : ''}`}
                >
                  <span className="host-page__player-name">{player.name}</span>
                  {player.voted && !player.eliminated && (
                    <span className="host-page__player-vote">已投票</span>
                  )}
                  {player.eliminated && (
                    <span className="host-page__player-status">已淘汰</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="host-page__no-data">等待玩家加入...</p>
          )}
        </section>

        {/* 历史记录 */}
        <section className="host-page__history">
          <h2>历史记录</h2>
          {roundHistory.length > 0 ? (
            <div className="host-page__history-list">
              {roundHistory.map((record) => (
                <div key={record.round} className="host-page__history-item">
                  <div className="host-page__history-header">
                    <span className="host-page__history-round">第 {record.round} 轮</span>
                    {record.is_tie && <span className="host-page__history-tie">平局</span>}
                    <span className="host-page__history-options">
                      {record.options.map(o => `${o.name}(${o.votes}票)`).join(' vs ')}
                    </span>
                  </div>
                  <div className="host-page__history-details">
                    <div className="host-page__history-survivors">
                      <span className="host-page__history-label">胜出:</span>
                      <span className="host-page__history-names host-page__history-names--success">
                        {record.survivors.length > 0 ? record.survivors.join('、') : '无'}
                      </span>
                    </div>
                    <div className="host-page__history-eliminated">
                      <span className="host-page__history-label">淘汰:</span>
                      <span className="host-page__history-names host-page__history-names--danger">
                        {record.eliminated.length > 0 ? record.eliminated.join('、') : '无'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="host-page__no-data">暂无历史记录</p>
          )}
        </section>
      </div>
    </div>
  );
};

export default HostPage;
