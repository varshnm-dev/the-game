import React, { useState, useEffect } from 'react';
import { GameClient, GameClientEvent } from './services/GameClient';
import { ClientGameState, ChatMessage } from './types/game';
import RoomSetup from './components/RoomSetup';
import GameBoard from './components/GameBoard';
import Chat from './components/Chat';
import PlayerList from './components/PlayerList';
import './App.css';

interface AppState {
  screen: 'setup' | 'waiting' | 'playing';
  gameClient: GameClient;
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  roomId: string | null;
  playerId: string | null;
  playerName: string;
  players: Array<{id: string, name: string}>;
  gameState: ClientGameState | null;
  chatMessages: ChatMessage[];
  error: string | null;
}

function App() {
  const [state, setState] = useState<AppState>({
    screen: 'setup',
    gameClient: new GameClient(),
    connectionStatus: 'disconnected',
    roomId: null,
    playerId: null,
    playerName: '',
    players: [],
    gameState: null,
    chatMessages: [],
    error: null
  });

  useEffect(() => {
    const client = state.gameClient;

    // Set up event handlers
    const handlers = {
      connected: () => {
        setState(prev => ({ ...prev, connectionStatus: 'connected', error: null }));
      },

      disconnected: () => {
        setState(prev => ({ ...prev, connectionStatus: 'disconnected' }));
      },

      room_created: (event: GameClientEvent) => {
        setState(prev => ({
          ...prev,
          screen: 'waiting',
          roomId: event.roomId || null,
          playerId: event.playerId || null,
          players: event.players || [],
          error: null
        }));
      },

      room_joined: (event: GameClientEvent) => {
        setState(prev => ({
          ...prev,
          screen: 'waiting',
          roomId: event.roomId || null,
          playerId: event.playerId || null,
          players: event.players || [],
          error: null
        }));
      },

      player_joined: (event: GameClientEvent) => {
        if (event.player) {
          setState(prev => ({
            ...prev,
            players: [...prev.players, event.player!]
          }));
        }
      },

      player_left: (event: GameClientEvent) => {
        setState(prev => ({
          ...prev,
          players: prev.players.filter(p => p.id !== event.playerId)
        }));
      },

      game_state_update: (event: GameClientEvent) => {
        setState(prev => ({
          ...prev,
          screen: 'playing',
          gameState: event.gameState || null,
          chatMessages: event.chatMessages || prev.chatMessages
        }));
      },

      chat_message: (event: GameClientEvent) => {
        if (event.message) {
          setState(prev => ({
            ...prev,
            chatMessages: [...prev.chatMessages, event.message!]
          }));
        }
      },

      error: (event: GameClientEvent) => {
        setState(prev => ({ ...prev, error: event.error || 'Unknown error' }));
      },

      game_error: (event: GameClientEvent) => {
        setState(prev => ({ ...prev, error: event.error || 'Game error' }));
      }
    };

    // Register all handlers
    Object.entries(handlers).forEach(([eventType, handler]) => {
      client.on(eventType as any, handler);
    });

    // Connect to server
    setState(prev => ({ ...prev, connectionStatus: 'connecting' }));
    client.connect();

    // Cleanup on unmount
    return () => {
      Object.entries(handlers).forEach(([eventType, handler]) => {
        client.off(eventType as any, handler);
      });
      client.disconnect();
    };
  }, []);

  const handleCreateRoom = (playerName: string) => {
    setState(prev => ({ ...prev, playerName }));
    state.gameClient.createRoom(playerName);
  };

  const handleJoinRoom = (roomId: string, playerName: string) => {
    setState(prev => ({ ...prev, playerName }));
    state.gameClient.joinRoom(roomId, playerName);
  };

  const handleLeaveRoom = () => {
    state.gameClient.leaveRoom();
    setState(prev => ({
      ...prev,
      screen: 'setup',
      roomId: null,
      playerId: null,
      players: [],
      gameState: null,
      chatMessages: [],
      error: null
    }));
  };

  const handleSendChat = (message: string, isHint: boolean) => {
    state.gameClient.sendChatMessage(message, isHint);
  };

  const handleStartGame = async () => {
    if (!state.roomId) return;

    try {
      const success = await state.gameClient.startGame(state.roomId);
      if (!success) {
        setState(prev => ({ ...prev, error: 'Failed to start game' }));
      }
    } catch (error) {
      setState(prev => ({ ...prev, error: 'Error starting game' }));
    }
  };

  const handleStartGameWithPlayer = async (startingPlayerId: string) => {
    if (!state.roomId) return;

    try {
      const success = await state.gameClient.startGameWithPlayer(state.roomId, startingPlayerId);
      if (!success) {
        setState(prev => ({ ...prev, error: 'Failed to start game' }));
      }
    } catch (error) {
      setState(prev => ({ ...prev, error: 'Error starting game' }));
    }
  };

  const renderConnectionStatus = () => {
    const statusColors = {
      disconnected: '#ff4444',
      connecting: '#ffaa00',
      connected: '#44ff44'
    };

    return (
      <div className="connection-status" style={{
        position: 'fixed',
        top: 10,
        right: 10,
        padding: '5px 10px',
        borderRadius: '5px',
        backgroundColor: statusColors[state.connectionStatus],
        color: 'white',
        fontSize: '12px',
        fontWeight: 'bold'
      }}>
        {state.connectionStatus.toUpperCase()}
      </div>
    );
  };

  const renderError = () => {
    if (!state.error) return null;

    return (
      <div className="error-message" style={{
        position: 'fixed',
        top: 50,
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: '#ff4444',
        color: 'white',
        padding: '10px 20px',
        borderRadius: '5px',
        zIndex: 1000
      }}>
        {state.error}
        <button
          onClick={() => setState(prev => ({ ...prev, error: null }))}
          style={{ marginLeft: '10px', background: 'none', border: 'none', color: 'white' }}
        >
          ×
        </button>
      </div>
    );
  };

  return (
    <div className="App">
      {renderConnectionStatus()}
      {renderError()}

      {state.screen === 'setup' && (
        <RoomSetup
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          isConnected={state.connectionStatus === 'connected'}
        />
      )}

      {state.screen === 'waiting' && (
        <div className="waiting-room">
          <div className="room-header">
            <h2>Room: {state.roomId}</h2>
            <button onClick={handleLeaveRoom} className="leave-button">
              Leave Room
            </button>
          </div>

          <PlayerList
            players={state.players}
            currentPlayerId={state.playerId}
          />

          <div className="waiting-message">
            <p>Waiting for other players...</p>
            <p><small>Share the room code <strong>{state.roomId}</strong> with your friends!</small></p>

            {state.players.length >= 1 && (
              <div style={{ marginTop: '20px' }}>
                <p><strong>Who should start first?</strong></p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', margin: '10px 0' }}>
                  {state.players.map(player => (
                    <button
                      key={player.id}
                      onClick={() => handleStartGameWithPlayer(player.id)}
                      style={{
                        padding: '10px 20px',
                        background: player.id === state.playerId ? '#2196f3' : '#f0f0f0',
                        color: player.id === state.playerId ? 'white' : '#333',
                        border: '2px solid #ddd',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      {player.name} {player.id === state.playerId ? '(You)' : ''} starts
                    </button>
                  ))}
                </div>
                <button
                  onClick={handleStartGame}
                  style={{
                    padding: '8px 16px',
                    background: '#666',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  Auto-select best starter
                </button>
              </div>
            )}
          </div>

          {state.chatMessages.length > 0 && (
            <Chat
              messages={state.chatMessages}
              onSendMessage={handleSendChat}
              currentPlayerId={state.playerId || ''}
            />
          )}
        </div>
      )}

      {state.screen === 'playing' && state.gameState && (
        <div className="game-screen">
          <div className="game-header">
            <h3>Room: {state.roomId}</h3>
            <button onClick={handleLeaveRoom} className="leave-button">
              Leave Game
            </button>
          </div>

          <div className="game-layout">
            <div className="game-main">
              <GameBoard
                gameState={state.gameState}
                gameClient={state.gameClient}
              />
            </div>

            <div className="game-sidebar">
              <PlayerList
                players={state.gameState.players.map(p => ({ id: p.id, name: p.name }))}
                currentPlayerId={state.gameState.currentPlayerId}
                gameState={state.gameState}
              />

              <Chat
                messages={state.chatMessages}
                onSendMessage={handleSendChat}
                currentPlayerId={state.playerId || ''}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
