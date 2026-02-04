// 游戏配置文件
export const gameConfig = {
  // 游戏标题
  title: '二维码投票小游戏',
  
  // 主持人页面配置
  host: {
    maxOptions: 4,
    minOptions: 2,
    defaultOptions: ['选项A', '选项B']
  },
  
  // 投票页面配置
  vote: {
    waitingMessage: '等待主持人设置选项...',
    votedMessage: '投票成功！等待结果...',
    eliminatedMessage: '您已被淘汰',
    survivedMessage: '恭喜您进入下一轮！'
  },
  
  // 存储键名
  storageKeys: {
    gameState: 'vote_game_state',
    players: 'vote_game_players',
    votes: 'vote_game_votes',
    round: 'vote_game_round'
  }
};

export default gameConfig;
