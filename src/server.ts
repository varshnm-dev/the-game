import express from 'express';
import { createServer } from 'http';
import WebSocket from 'ws';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

import { GameEngine } from './game/GameEngine';
import { ServerGameState, WebSocketMessage, ChatMessage, GameAction } from './types/game';

interface GameRoom {
  id: string;
  gameState: ServerGameState | null;
  players: Map<string, { id: string; name: string; ws: WebSocket }>;
  chatMessages: ChatMessage[];
  maxPlayers: number;
  isStarted: boolean;
  createdAt: number;
  lastActivity: number;
}

class GameServer {
  private app = express();
  private server = createServer(this.app);
  private wss = new WebSocket.Server({ server: this.server });
  private rooms = new Map<string, GameRoom>();
  private playerConnections = new Map<WebSocket, { playerId: string; roomId: string }>();

  constructor() {
    this.setupExpress();
    this.setupWebSocket();
    this.startCleanupTimer();
  }

  private setupExpress() {
    const allowedOrigins = process.env.NODE_ENV === 'production'
      ? [process.env.FRONTEND_URL, process.env.RENDER_EXTERNAL_URL].filter((url): url is string => Boolean(url))
      : ['http://localhost:3000', 'http://localhost:3001'];

    this.app.use(cors({
      origin: allowedOrigins,
      credentials: true
    }));
    
    this.app.use(express.json());

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        rooms: this.rooms.size, 
        connections: this.playerConnections.size 
      });
    });

    // Get room info
    this.app.get('/api/room/:roomId', (req, res) => {
      const room = this.rooms.get(req.params.roomId);
      if (!room) {
        return res.status(404).json({ error: 'Room not found' });
      }

      res.json({
        id: room.id,
        playerCount: room.players.size,
        maxPlayers: room.maxPlayers,
        isStarted: room.isStarted,
        status: room.gameState?.status || 'waiting'
      });
    });

    // Start game endpoint
    this.app.post('/api/room/:roomId/start', (req, res) => {
      const roomId = req.params.roomId;
      const success = this.startGame(roomId);

      if (success) {
        res.json({ success: true, message: 'Game started' });
      } else {
        res.status(400).json({ success: false, error: 'Could not start game' });
      }
    });

    // Create room
    this.app.post('/api/room', (req, res) => {
      const roomId = this.generateRoomId();
      const room: GameRoom = {
        id: roomId,
        gameState: null,
        players: new Map(),
        chatMessages: [],
        maxPlayers: 5,
        isStarted: false,
        createdAt: Date.now(),
        lastActivity: Date.now()
      };

      this.rooms.set(roomId, room);
      res.json({ roomId });
    });
  }

  private setupWebSocket() {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('New WebSocket connection');

      ws.on('message', (data: WebSocket.RawData) => {
        try {
          const message: WebSocketMessage = JSON.parse(data.toString());
          this.handleWebSocketMessage(ws, message);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
          ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
        }
      });

      ws.on('close', () => {
        console.log('WebSocket connection closed');
        this.handlePlayerDisconnection(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.handlePlayerDisconnection(ws);
      });
    });
  }

  private handleWebSocketMessage(ws: WebSocket, message: WebSocketMessage) {
    try {
      switch (message.type) {
        case 'join_room':
          this.handleJoinRoom(ws, message);
          break;
        case 'create_room':
          this.handleCreateRoom(ws, message);
          break;
        case 'game_action':
          this.handleGameAction(ws, message);
          break;
        case 'chat_message':
          this.handleChatMessage(ws, message);
          break;
        case 'leave_room':
          this.handleLeaveRoom(ws, message);
          break;
        default:
          ws.send(JSON.stringify({ type: 'error', error: 'Unknown message type' }));
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      ws.send(JSON.stringify({ type: 'error', error: 'Failed to process message' }));
    }
  }

  private handleJoinRoom(ws: WebSocket, message: WebSocketMessage) {
    const { roomId, playerId, playerName } = message;
    if (!roomId || !playerId || !playerName) {
      return ws.send(JSON.stringify({ type: 'error', error: 'Missing required fields' }));
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return ws.send(JSON.stringify({ type: 'error', error: 'Room not found' }));
    }

    if (room.players.size >= room.maxPlayers) {
      return ws.send(JSON.stringify({ type: 'error', error: 'Room is full' }));
    }

    // Add player to room
    room.players.set(playerId, { id: playerId, name: playerName, ws });
    this.playerConnections.set(ws, { playerId, roomId });
    room.lastActivity = Date.now();

    // Send success response
    ws.send(JSON.stringify({
      type: 'room_joined',
      roomId,
      playerId,
      players: Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name }))
    }));

    // Notify other players
    this.broadcastToRoom(roomId, {
      type: 'player_joined',
      player: { id: playerId, name: playerName }
    }, playerId);
  }

  private handleCreateRoom(ws: WebSocket, message: WebSocketMessage) {
    const { playerId, playerName } = message;
    if (!playerId || !playerName) {
      return ws.send(JSON.stringify({ type: 'error', error: 'Missing required fields' }));
    }

    const roomId = this.generateRoomId();
    const room: GameRoom = {
      id: roomId,
      gameState: null,
      players: new Map(),
      chatMessages: [],
      maxPlayers: 5,
      isStarted: false,
      createdAt: Date.now(),
      lastActivity: Date.now()
    };

    // Add creator to room
    room.players.set(playerId, { id: playerId, name: playerName, ws });
    this.playerConnections.set(ws, { playerId, roomId });
    this.rooms.set(roomId, room);

    ws.send(JSON.stringify({
      type: 'room_created',
      roomId,
      playerId,
      players: [{ id: playerId, name: playerName }]
    }));
  }

  private handleGameAction(ws: WebSocket, message: WebSocketMessage) {
    const connection = this.playerConnections.get(ws);
    if (!connection) return;

    const room = this.rooms.get(connection.roomId);
    if (!room || !room.gameState || !message.action) return;

    try {
      let newGameState: ServerGameState;
      
      switch (message.action.type) {
        case 'play_card':
          if (!message.action.cardId || !message.action.pileId) return;
          newGameState = GameEngine.playCard(room.gameState, connection.playerId, message.action.cardId, message.action.pileId);
          break;
        case 'end_turn':
          newGameState = GameEngine.endTurn(room.gameState);
          break;
        case 'undo_move':
          newGameState = GameEngine.undoLastMove(room.gameState);
          break;
        default:
          return;
      }

      room.gameState = newGameState;
      room.lastActivity = Date.now();

      // Broadcast updated game state to all players
      this.broadcastGameState(connection.roomId);

    } catch (error) {
      ws.send(JSON.stringify({ 
        type: 'game_error', 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }));
    }
  }

  private handleChatMessage(ws: WebSocket, message: WebSocketMessage) {
    const connection = this.playerConnections.get(ws);
    if (!connection || !message.message) return;

    const room = this.rooms.get(connection.roomId);
    if (!room) return;

    const chatMessage: ChatMessage = {
      ...message.message,
      id: uuidv4(),
      playerId: connection.playerId,
      timestamp: Date.now()
    };

    room.chatMessages.push(chatMessage);
    room.lastActivity = Date.now();

    // Keep only last 100 messages
    if (room.chatMessages.length > 100) {
      room.chatMessages = room.chatMessages.slice(-100);
    }

    this.broadcastToRoom(connection.roomId, {
      type: 'chat_message',
      message: chatMessage
    });
  }

  private handleLeaveRoom(ws: WebSocket, message: WebSocketMessage) {
    this.handlePlayerDisconnection(ws);
  }

  private handlePlayerDisconnection(ws: WebSocket) {
    const connection = this.playerConnections.get(ws);
    if (!connection) return;

    const room = this.rooms.get(connection.roomId);
    if (room) {
      room.players.delete(connection.playerId);
      
      // Mark player as disconnected in game state
      if (room.gameState) {
        const player = room.gameState.players.find(p => p.id === connection.playerId);
        if (player) {
          player.isConnected = false;
        }
      }

      // Notify other players
      this.broadcastToRoom(connection.roomId, {
        type: 'player_left',
        playerId: connection.playerId
      });

      // Clean up empty rooms
      if (room.players.size === 0) {
        this.rooms.delete(connection.roomId);
      }
    }

    this.playerConnections.delete(ws);
  }

  private broadcastGameState(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room || !room.gameState) return;

    room.players.forEach((player) => {
      if (player.ws.readyState === WebSocket.OPEN) {
        const clientGameState = GameEngine.createClientGameState(room.gameState!, player.id);
        player.ws.send(JSON.stringify({
          type: 'game_state_update',
          gameState: clientGameState,
          chatMessages: room.chatMessages
        }));
      }
    });
  }

  private broadcastToRoom(roomId: string, message: any, excludePlayerId?: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.players.forEach((player) => {
      if (player.id !== excludePlayerId && player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(JSON.stringify(message));
      }
    });
  }

  private generateRoomId(): string {
    let id: string;
    do {
      id = Math.random().toString(36).substring(2, 8).toUpperCase();
    } while (this.rooms.has(id));
    return id;
  }

  private startCleanupTimer() {
    setInterval(() => {
      const now = Date.now();
      const TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours

      this.rooms.forEach((room, roomId) => {
        if (now - room.lastActivity > TIMEOUT) {
          console.log(`Cleaning up inactive room: ${roomId}`);
          this.rooms.delete(roomId);
        }
      });
    }, 10 * 60 * 1000); // Check every 10 minutes
  }

  public startGame(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room || room.isStarted || room.players.size < 1) {
      return false;
    }

    try {
      const playerData = Array.from(room.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        connectionId: p.id
      }));

      room.gameState = GameEngine.initializeGame(roomId, playerData);
      room.isStarted = true;
      room.lastActivity = Date.now();

      this.broadcastGameState(roomId);
      return true;
    } catch (error) {
      console.error('Failed to start game:', error);
      return false;
    }
  }

  public start(port: number = parseInt(process.env.PORT || '3001')) {
    this.server.listen(port, () => {
      console.log(`🎮 The Game Server running on port ${port}`);
      console.log(`📡 WebSocket server ready for connections`);
      console.log(`🌍 Health check: http://localhost:${port}/health`);
    });
  }
}

// Start the server
const gameServer = new GameServer();
gameServer.start();

export default GameServer;