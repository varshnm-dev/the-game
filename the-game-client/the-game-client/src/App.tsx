import React, { useState, useEffect } from 'react';
import { GameClient, GameClientEvent } from './services/GameClient';
import { ClientGameState, ChatMessage } from './types/game';
import RoomSetup from './components/RoomSetup';
import GameBoard from './components/GameBoard';
import Chat from './components/Chat';
import PlayerList from './components/PlayerList';
import './App.css';

interface AppState {
  screen: 'setup' | 'waiting' | 'cards_dealt' | 'playing';
  gameClient: GameClient;
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  roomId: string | null;
  playerId: string | null;
  playerName: string;
  players: Array<{id: string, name: string}>;
  gameState: ClientGameState | null;
  chatMessages: ChatMessage[];
  error: string | null;
  reconnectStatus: string | null;
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
    error: null,
    reconnectStatus: null
  });

  useEffect(() => {
    const client = state.gameClient;

    // Check for persisted session and auto-rejoin if available
    if (client.hasPersistedSession()) {
      const session = client.getPersistedSession();
      if (session) {
        console.log('Found persisted session, will auto-rejoin room:', session.roomId);
        console.log('Session details:', session);
        setState(prev => ({
          ...prev,
          playerName: session.playerName,
          playerId: session.playerId,
          roomId: session.roomId
        }));
      }
    } else {
      console.log('No persisted session found');
    }

    // Set up event handlers
    const handlers = {
      connected: () => {
        setState(prev => ({ ...prev, connectionStatus: 'connected', error: null, reconnectStatus: null }));
      },

      disconnected: () => {
        setState(prev => ({
          ...prev,
          connectionStatus: 'disconnected',
          reconnectStatus: 'Connection lost. Attempting to reconnect...'
        }));
      },

      reconnecting: (event: GameClientEvent) => {
        const seconds = event.nextDelayMs ? Math.round(event.nextDelayMs / 1000) : null;
        const reconnectMessage = seconds
          ? `Reconnecting (attempt ${event.attempt}) in ${seconds} second${seconds === 1 ? '' : 's'}...`
          : `Reconnecting (attempt ${event.attempt})...`;

        setState(prev => ({
          ...prev,
          connectionStatus: 'connecting',
          reconnectStatus: reconnectMessage
        }));
      },

      room_created: (event: GameClientEvent) => {
        console.log('Room created event:', event);
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
        console.log('Room joined event:', event);
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
        if (event.gameState) {
          setState(prev => {
            const newScreen = event.gameState!.status === 'cards_dealt' ? 'cards_dealt' :
                             event.gameState!.status === 'playing' ? 'playing' : prev.screen;
            return {
              ...prev,
              screen: newScreen,
              gameState: event.gameState || null,
              chatMessages: event.chatMessages || prev.chatMessages
            };
          });
        }
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
        const errorMessage = event.error || 'Unknown error';
        setState(prev => ({ ...prev, error: errorMessage }));

        // Only clear session if we're not in the middle of auto-rejoining and the error is about room not found
        if (errorMessage.includes('Room not found') &&
            state.gameClient.hasPersistedSession() &&
            !state.gameClient.isAutoRejoinInProgress()) {
          console.log('Persisted room no longer exists, clearing session');
          state.gameClient.clearSession();
          setState(prev => ({
            ...prev,
            screen: 'setup',
            roomId: null,
            playerId: null,
            playerName: '',
            players: [],
            gameState: null,
            chatMessages: [],
            error: 'Your previous game session has expired. Please start a new game.'
          }));
        } else if (errorMessage.includes('Room not found') && state.gameClient.isAutoRejoinInProgress()) {
          // If we get room not found during auto-rejoin, wait a bit before clearing session
          console.log('Room not found during auto-rejoin, waiting before clearing session...');
          setTimeout(() => {
            if (state.gameClient.hasPersistedSession() && !state.gameClient.isConnected()) {
              console.log('Auto-rejoin failed, clearing session');
              state.gameClient.clearSession();
              setState(prev => ({
                ...prev,
                screen: 'setup',
                roomId: null,
                playerId: null,
                playerName: '',
                players: [],
                gameState: null,
                chatMessages: [],
                error: 'Your previous game session has expired. Please start a new game.'
              }));
            }
          }, 5000); // Wait 5 seconds before giving up
        }
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

  const handleNewGame = () => {
    // Clear persisted session and start fresh
    state.gameClient.clearSession();
    handleLeaveRoom();
  };

  const handleContinueGame = (session: { roomId: string; playerId: string; playerName: string }) => {
    // The GameClient will automatically rejoin on connection, so we just need to update the UI state
    setState(prev => ({
      ...prev,
      playerName: session.playerName,
      playerId: session.playerId,
      roomId: session.roomId
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

  const handleSelectStartingPlayer = (startingPlayerId: string) => {
    state.gameClient.selectStartingPlayer(startingPlayerId);
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

  const renderReconnectStatus = () => {
    if (!state.reconnectStatus) {
      return null;
    }

    return (
      <div className="reconnect-status" style={{
        position: 'fixed',
        top: 80,
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: '#1976d2',
        color: 'white',
        padding: '8px 16px',
        borderRadius: '5px',
        zIndex: 900,
        fontSize: '13px'
      }}>
        {state.reconnectStatus}
      </div>
    );
  };

  return (
    <div className="App">
      {renderConnectionStatus()}
      {renderError()}
      {renderReconnectStatus()}

      {state.screen === 'setup' && (
        <RoomSetup
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onContinueGame={handleContinueGame}
          onNewGame={handleNewGame}
          persistedSession={state.gameClient.getPersistedSession()}
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
                <button
                  onClick={handleStartGame}
                  style={{
                    padding: '12px 24px',
                    background: '#2196f3',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  Deal Cards
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

      {state.screen === 'cards_dealt' && state.gameState && (
        <div className="cards-dealt-screen">
          <div className="game-header">
            <h3>Room: {state.roomId}</h3>
            <button onClick={handleLeaveRoom} className="leave-button">
              Leave Game
            </button>
          </div>

          <div className="cards-dealt-content">
            <div className="your-cards">
              <h3>Your Cards ({state.gameState.yourHand.length} cards)</h3>
              <div className="hand">
                {state.gameState.yourHand.map(card => (
                  <div key={card.id} className="card preview">
                    <div className="card-value">{card.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="starting-player-selection">
              <h3>Who should start first?</h3>
              <p>Look at your cards and decide who has the best starting hand!</p>

              <div className="player-selection">
                {state.gameState.players.map(player => (
                  <button
                    key={player.id}
                    onClick={() => handleSelectStartingPlayer(player.id)}
                    style={{
                      padding: '12px 20px',
                      background: player.id === state.playerId ? '#2196f3' : '#f0f0f0',
                      color: player.id === state.playerId ? 'white' : '#333',
                      border: '2px solid #ddd',
                      borderRadius: '8px',
                      fontSize: '16px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      margin: '5px'
                    }}
                  >
                    {player.name} {player.id === state.playerId ? '(You)' : ''} starts
                  </button>
                ))}
              </div>

              <div style={{ marginTop: '20px' }}>
                <button
                  onClick={() => handleSelectStartingPlayer('')}
                  style={{
                    padding: '8px 16px',
                    background: '#666',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '14px',
                    cursor: 'pointer'
                  }}
                >
                  Auto-select best starter
                </button>
              </div>
            </div>
          </div>

          <Chat
            messages={state.chatMessages}
            onSendMessage={handleSendChat}
            currentPlayerId={state.playerId || ''}
          />
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
