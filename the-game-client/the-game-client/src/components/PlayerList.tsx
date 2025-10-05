import React from 'react';
import { ClientGameState } from '../types/game';
import './PlayerList.css';

interface PlayerListProps {
  players: Array<{id: string, name: string}>;
  currentPlayerId: string | null;
  gameState?: ClientGameState;
}

const PlayerList: React.FC<PlayerListProps> = ({
  players,
  currentPlayerId,
  gameState
}) => {
  const getPlayerStatus = (playerId: string) => {
    if (!gameState) return null;

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) return null;

    return {
      isCurrentPlayer: player.isCurrentPlayer,
      handCount: player.handCount,
      isConnected: player.isConnected
    };
  };

  return (
    <div className="player-list">
      <h4>Players ({players.length}/5)</h4>

      <div className="players">
        {players.map((player) => {
          const status = getPlayerStatus(player.id);
          const isYou = player.id === currentPlayerId;

          return (
            <div
              key={player.id}
              className={`player ${isYou ? 'you' : ''} ${
                status?.isCurrentPlayer ? 'current-player' : ''
              } ${
                status && !status.isConnected ? 'disconnected' : ''
              }`}
            >
              <div className="player-info">
                <div className="player-name">
                  {player.name} {isYou && '(You)'}
                  {status?.isCurrentPlayer && ' 🎯'}
                </div>

                {status && (
                  <div className="player-details">
                    <span className="hand-count">
                      {status.handCount} cards
                    </span>

                    {!status.isConnected && (
                      <span className="disconnected-indicator">
                        📵 Disconnected
                      </span>
                    )}
                  </div>
                )}
              </div>

              {status?.isCurrentPlayer && (
                <div className="current-player-indicator">
                  Current Turn
                </div>
              )}
            </div>
          );
        })}
      </div>

      {gameState && (
        <div className="game-status">
          <div className="status-item">
            <span className="label">Game Status:</span>
            <span className={`value status-${gameState.status}`}>
              {gameState.status.toUpperCase()}
            </span>
          </div>

          <div className="status-item">
            <span className="label">Cards Left:</span>
            <span className="value">{gameState.deckCount}</span>
          </div>

          {gameState.status === 'playing' && (
            <div className="status-item">
              <span className="label">Cards to Play:</span>
              <span className="value">
                {gameState.cardsPlayed}/{gameState.minCardsToPlay}
              </span>
            </div>
          )}

          {gameState.canUndo && (
            <div className="status-item">
              <span className="undo-available">↶ Undo Available</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PlayerList;