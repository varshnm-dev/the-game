import React, { useState } from 'react';
import './RoomSetup.css';

interface RoomSetupProps {
  onCreateRoom: (playerName: string) => void;
  onJoinRoom: (roomId: string, playerName: string) => void;
  onContinueGame?: (session: { roomId: string; playerId: string; playerName: string }) => void;
  onNewGame?: () => void;
  persistedSession?: { roomId: string; playerId: string; playerName: string } | null;
  isConnected: boolean;
}

const RoomSetup: React.FC<RoomSetupProps> = ({
  onCreateRoom,
  onJoinRoom,
  onContinueGame,
  onNewGame,
  persistedSession,
  isConnected
}) => {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!playerName.trim()) {
      alert('Please enter your name');
      return;
    }

    if (mode === 'join' && !roomId.trim()) {
      alert('Please enter room code');
      return;
    }

    if (!isConnected) {
      alert('Not connected to server');
      return;
    }

    setIsLoading(true);

    try {
      if (mode === 'create') {
        onCreateRoom(playerName.trim());
      } else {
        onJoinRoom(roomId.trim().toUpperCase(), playerName.trim());
      }
    } catch (error) {
      setIsLoading(false);
    }
  };

  const handleContinueGame = () => {
    if (persistedSession && onContinueGame) {
      onContinueGame(persistedSession);
    }
  };

  const handleNewGameClick = () => {
    if (onNewGame) {
      onNewGame();
    }
  };

  return (
    <div className="room-setup">
      <div className="room-setup-container">
        <header className="room-setup-header">
          <h1>🎮 The Game</h1>
          <p>Cooperative card game for 1-5 players</p>
        </header>

        {persistedSession && (
          <div className="continue-game-section">
            <h3>Continue Previous Game</h3>
            <div className="continue-game-info">
              <p><strong>Player:</strong> {persistedSession.playerName}</p>
              <p><strong>Room:</strong> {persistedSession.roomId}</p>
            </div>
            <div className="continue-game-buttons">
              <button
                className="continue-button"
                onClick={handleContinueGame}
                disabled={!isConnected}
              >
                Continue Game
              </button>
              <button
                className="new-game-button"
                onClick={handleNewGameClick}
                disabled={!isConnected}
              >
                Start New Game
              </button>
            </div>
            <hr className="section-divider" />
          </div>
        )}

        <div className="mode-selector">
          <button
            className={`mode-button ${mode === 'create' ? 'active' : ''}`}
            onClick={() => setMode('create')}
            disabled={isLoading}
          >
            Create Room
          </button>
          <button
            className={`mode-button ${mode === 'join' ? 'active' : ''}`}
            onClick={() => setMode('join')}
            disabled={isLoading}
          >
            Join Room
          </button>
        </div>

        <form onSubmit={handleSubmit} className="room-form">
          <div className="form-group">
            <label htmlFor="playerName">Your Name:</label>
            <input
              id="playerName"
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Enter your name"
              maxLength={20}
              disabled={isLoading}
              required
            />
          </div>

          {mode === 'join' && (
            <div className="form-group">
              <label htmlFor="roomId">Room Code:</label>
              <input
                id="roomId"
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                placeholder="Enter room code (e.g. AB3X7F)"
                maxLength={6}
                disabled={isLoading}
                required
              />
            </div>
          )}

          <button
            type="submit"
            className="submit-button"
            disabled={isLoading || !isConnected}
          >
            {isLoading ? 'Connecting...' : mode === 'create' ? 'Create Room' : 'Join Room'}
          </button>

          {!isConnected && (
            <p className="connection-warning">
              ⚠️ Connecting to server...
            </p>
          )}
        </form>

        <div className="game-rules">
          <h3>How to Play:</h3>
          <ul>
            <li><strong>Goal:</strong> Work together to play all cards (2-99)</li>
            <li><strong>Piles:</strong> 2 ascending (↗) and 2 descending (↘)</li>
            <li><strong>Special:</strong> Play cards exactly ±10 to reverse direction</li>
            <li><strong>Turn:</strong> Play at least 2 cards, then draw</li>
            <li><strong>Communication:</strong> Give hints, but don't say exact numbers!</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default RoomSetup;