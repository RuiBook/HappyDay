import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import HostPage from './pages/HostPage/HostPage';
import VotePage from './pages/VotePage/VotePage';
import './App.scss';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/host" element={<HostPage />} />
        <Route path="/vote" element={<VotePage />} />
      </Routes>
    </Router>
  );
}

// 首页组件
function HomePage() {
  return (
    <div className="home-page">
      <div className="home-page__container">
        <h1 className="home-page__title">二维码投票小游戏</h1>
        <p className="home-page__description">
          一个有趣的互动投票游戏，主持人设置选项，玩家扫码参与投票，少数派将被淘汰！
        </p>
        <div className="home-page__buttons">
          <Link to="/host" className="home-page__btn home-page__btn--primary">
            我是主持人
          </Link>
          <Link to="/vote" className="home-page__btn home-page__btn--secondary">
            我是玩家
          </Link>
        </div>
        <div className="home-page__rules">
          <h2>游戏规则</h2>
          <ol>
            <li>主持人创建游戏，生成二维码</li>
            <li>玩家扫描二维码加入游戏</li>
            <li>主持人设置投票选项并开始投票</li>
            <li>玩家选择一个选项进行投票</li>
            <li>投票结束后，选择少数派选项的玩家将被淘汰</li>
            <li>重复以上步骤，直到决出最终胜利者</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

export default App;
