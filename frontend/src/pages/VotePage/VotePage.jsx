import { useState, useEffect, useCallback, useRef } from 'react';
import { api, createUserWebSocket } from '../../services/api';
import { gameConfig } from '../../config/game.config';
import './VotePage.scss';

const VotePage = () => {
  // 用户状态
  const [playerName, setPlayerName] = useState('');
  const [token, setToken] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  // 游戏状态
  const [gameStatus, setGameStatus] = useState('waiting');
  const [options, setOptions] = useState([]);
  const [selectedOption, setSelectedOption] = useState('');
  const [hasVoted, setHasVoted] = useState(false);
  const [isEliminated, setIsEliminated] = useState(false);
  const [round, setRound] = useState(1);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  
  // WebSocket 引用
  const wsRef = useRef(null);

  // 校验姓名
  const validateName = (name) => {
    if (!name.trim()) {
      return '姓名不能为空';
    }
    if (name.length > 20) {
      return '姓名不能超过20个字符';
    }
    if (/[<>"'/\\;&|`$]/.test(name)) {
      return '姓名包含非法字符';
    }
    return null;
  };

  // 加入游戏
  const joinGame = async () => {
    const nameError = validateName(playerName);
    if (nameError) {
      setError(nameError);
      return;
    }
    
    setIsLoading(true);
    setError('');
    
    try {
      const result = await api.registerUser(playerName.trim());
      
      if (result.success) {
        setToken(result.token);
        setIsJoined(true);
        
        // 保存到 sessionStorage
        sessionStorage.setItem('vote_token', result.token);
        sessionStorage.setItem('vote_name', playerName.trim());
        
        // 如果已经在投票中，设置选项
        if (result.options) {
          setOptions(result.options);
          setGameStatus('voting');
        }
        
        // 建立 WebSocket 连接
        connectWebSocket(result.token);
      }
    } catch (err) {
      setError(err.message || '注册失败，请重试');
    } finally {
      setIsLoading(false);
    }
  };

  // WebSocket 连接
  const connectWebSocket = useCallback((userToken) => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    
    wsRef.current = createUserWebSocket(
      userToken,
      (message) => {
        handleWebSocketMessage(message);
      },
      (error) => {
        console.error('WebSocket error:', error);
      },
      () => {
        // 断开后立即尝试重连（缩短到1秒）
        setTimeout(() => {
          if (userToken && isJoined) {
            connectWebSocket(userToken);
          }
        }, 1000);
      }
    );
  }, [isJoined]);

  // 定期轮询状态（作为 WebSocket 的备份）
  useEffect(() => {
    if (!token || !isJoined) return;
    
    const pollStatus = async () => {
      try {
        const status = await api.getUserStatus(token);
        
        // 更新状态
        if (status.game_status !== gameStatus) {
          setGameStatus(status.game_status);
        }
        if (status.round !== round) {
          setRound(status.round);
        }
        if (status.options && status.options.length > 0 && options.length === 0) {
          setOptions(status.options);
        }
        if (status.eliminated && !isEliminated) {
          setIsEliminated(true);
        }
      } catch (err) {
        console.error('轮询状态失败:', err);
      }
    };
    
    // 每2秒轮询一次
    const interval = setInterval(pollStatus, 2000);
    
    return () => clearInterval(interval);
  }, [token, isJoined, gameStatus, round, options.length, isEliminated]);

  // 处理 WebSocket 消息
  const handleWebSocketMessage = (message) => {
    const { type, data } = message;
    
    switch (type) {
      case 'init':
        setGameStatus(data.status);
        setRound(data.round);
        if (data.options) {
          setOptions(data.options);
        }
        setHasVoted(data.voted);
        setIsEliminated(data.eliminated);
        break;
        
      case 'voting_started':
        setGameStatus('voting');
        setRound(data.round);
        setOptions(data.options);
        setHasVoted(false);
        setSelectedOption('');
        break;
        
      case 'voting_ended':
        setGameStatus('result');
        break;
        
      case 'eliminated':
        setIsEliminated(true);
        break;
        
      case 'next_round':
        setRound(data.round);
        setGameStatus('waiting');
        setHasVoted(false);
        setSelectedOption('');
        setOptions([]);
        break;
        
      case 'game_reset':
        setIsEliminated(false);
        setHasVoted(false);
        setSelectedOption('');
        setRound(1);
        setOptions([]);
        setGameStatus('waiting');
        break;
        
      default:
        break;
    }
  };

  // 提交投票
  const submitVote = async (optionId) => {
    if (hasVoted || isEliminated) return;
    
    setIsLoading(true);
    setError('');
    
    try {
      const result = await api.submitVote(token, optionId);
      
      if (result.success) {
        setSelectedOption(optionId);
        setHasVoted(true);
        setShowSuccessModal(true);
        
        // 3秒后关闭弹窗
        setTimeout(() => {
          setShowSuccessModal(false);
        }, 3000);
      }
    } catch (err) {
      setError(err.message || '投票失败，请重试');
    } finally {
      setIsLoading(false);
    }
  };

  // 恢复会话
  useEffect(() => {
    const savedToken = sessionStorage.getItem('vote_token');
    const savedName = sessionStorage.getItem('vote_name');
    
    if (savedToken && savedName) {
      setToken(savedToken);
      setPlayerName(savedName);
      setIsJoined(true);
      
      // 获取用户状态
      api.getUserStatus(savedToken)
        .then((status) => {
          setHasVoted(status.voted);
          setIsEliminated(status.eliminated);
          setGameStatus(status.game_status);
          setRound(status.round);
          if (status.options) {
            setOptions(status.options);
          }
          if (status.vote_option) {
            setSelectedOption(status.vote_option);
          }
          
          // 建立 WebSocket 连接
          connectWebSocket(savedToken);
        })
        .catch((err) => {
          // token 无效，清除会话
          sessionStorage.removeItem('vote_token');
          sessionStorage.removeItem('vote_name');
          setToken('');
          setPlayerName('');
          setIsJoined(false);
        });
    }
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectWebSocket]);

  // 获取选中选项的名称
  const getSelectedOptionName = () => {
    const opt = options.find(o => o.id === selectedOption);
    return opt ? opt.name : selectedOption;
  };

  // 渲染加入界面
  if (!isJoined) {
    return (
      <div className="vote-page">
        <div className="vote-page__join">
          <h1 className="vote-page__title">{gameConfig.title}</h1>
          <div className="vote-page__join-form">
            <input
              type="text"
              value={playerName}
              onChange={(e) => {
                setPlayerName(e.target.value);
                setError('');
              }}
              placeholder="请输入您的姓名"
              className="vote-page__input"
              maxLength={20}
              disabled={isLoading}
            />
            {error && <p className="vote-page__error">{error}</p>}
            <button
              onClick={joinGame}
              disabled={!playerName.trim() || isLoading}
              className="vote-page__btn vote-page__btn--primary"
            >
              {isLoading ? '提交中...' : '提交'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 渲染被淘汰界面
  if (isEliminated) {
    return (
      <div className="vote-page vote-page--eliminated">
        <div className="vote-page__status">
          <div className="vote-page__status-icon">😢</div>
          <h2>{gameConfig.vote.eliminatedMessage}</h2>
          <p>感谢参与！请等待下一局游戏</p>
        </div>
      </div>
    );
  }

  // 渲染等待界面
  if (gameStatus === 'waiting') {
    return (
      <div className="vote-page">
        <div className="vote-page__waiting">
          <div className="vote-page__player-info">
            <span className="vote-page__player-avatar">👤</span>
            <span className="vote-page__player-name">{playerName}</span>
            <span className="vote-page__round">第 {round} 轮</span>
          </div>
          <div className="vote-page__waiting-content">
            <div className="vote-page__loader"></div>
            <p>{gameConfig.vote.waitingMessage}</p>
          </div>
        </div>
      </div>
    );
  }

  // 渲染投票界面
  return (
    <div className="vote-page">
      <div className="vote-page__voting">
        <div className="vote-page__player-info">
          <span className="vote-page__player-avatar">👤</span>
          <span className="vote-page__player-name">{playerName}</span>
          <span className="vote-page__round">第 {round} 轮</span>
        </div>

        {error && <p className="vote-page__error">{error}</p>}

        {!hasVoted ? (
          <div className="vote-page__options">
            <h2>请选择您的答案</h2>
            <div className="vote-page__options-grid">
              {options.map((option) => (
                <button
                  key={option.id}
                  onClick={() => submitVote(option.id)}
                  disabled={isLoading}
                  className="vote-page__option-btn"
                >
                  {option.name}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="vote-page__voted">
            <div className="vote-page__voted-icon">✓</div>
            <h2>{gameConfig.vote.votedMessage}</h2>
            <p>您的选择: <strong>{getSelectedOptionName()}</strong></p>
          </div>
        )}
      </div>

      {/* 投票成功弹窗 */}
      {showSuccessModal && (
        <div className="vote-page__modal-overlay">
          <div className="vote-page__modal">
            <div className="vote-page__modal-icon">🎉</div>
            <h3>投票成功！</h3>
            <p>您已成功投票，请等待主持人公布结果</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default VotePage;
