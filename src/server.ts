import express from 'express';
import { createServer } from 'http';
import WebSocket from 'ws';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

import { GameEngine } from './game/GameEngine';
import { ServerGameState, WebSocketMessage, ChatMessage, GameAction } from './types/game';
import { RedisService, StoredRoom, RedisServiceLike } from './services/RedisService';

interface RoomPlayer {
  id: string;
  name: string;
}

interface GameRoom {
  id: string;
  gameState: ServerGameState | null;
  players: Map<string, RoomPlayer>;
  connections: Map<string, WebSocket>;
  chatMessages: ChatMessage[];
  maxPlayers: number;
  isStarted: boolean;
  createdAt: number;
  lastActivity: number;
}

interface GameServerOptions {
  redisService?: RedisServiceLike;
  enableCleanupTimer?: boolean;
  autoConnectRedis?: boolean;
}

class GameServer {
  private app = express();
  private server = createServer(this.app);
  private wss = new WebSocket.Server({ server: this.server });
  private rooms = new Map<string, GameRoom>();
  private playerConnections = new Map<WebSocket, { playerId: string; roomId: string }>();
  private redisService: RedisServiceLike;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(options: GameServerOptions = {}) {
    this.redisService = options.redisService ?? new RedisService();
    this.setupExpress();
    this.setupWebSocket();
    if (options.enableCleanupTimer !== false) {
      this.startCleanupTimer();
    }
    if (options.autoConnectRedis !== false) {
      this.connectToRedis();
    }
  }

  private setupExpress() {
    const allowedOrigins = process.env.NODE_ENV === 'production'
      ? [process.env.FRONTEND_URL, process.env.RENDER_EXTERNAL_URL, 'https://the-game-1-quxo.onrender.com'].filter((url): url is string => Boolean(url))
      : ['http://localhost:3000', 'http://localhost:3001'];

    this.app.use(cors({
      origin: allowedOrigins,
      credentials: true
    }));
    
    this.app.use(express.json());

    // Health check
    this.app.get('/health', async (req, res) => {
      const redisHealth = await this.redisService.healthCheck();
      res.json({
        status: 'healthy',
        rooms: this.rooms.size,
        persistentRooms: redisHealth.roomCount,
        connections: this.playerConnections.size,
        redis: redisHealth
      });
    });

    // Get room info
    this.app.get('/api/room/:roomId', async (req, res) => {
      const roomId = req.params.roomId;
      console.log(`🔍 API: Looking for room ${roomId}`);

      let room = this.rooms.get(roomId);

      // If room not in memory, try loading from Redis
      if (!room) {
        console.log(`💾 Room ${roomId} not in memory, checking Redis...`);
        const storedRoom = await this.redisService.getRoom(roomId);
        if (storedRoom) {
          console.log(`📥 Room ${roomId} found in Redis, restoring to memory`);
          const restoredRoom = await this.restoreRoomFromStorage(storedRoom);
          room = restoredRoom || undefined;
        }
      }

      if (!room) {
        console.log(`❌ Room ${roomId} not found anywhere`);
        return res.status(404).json({ error: 'Room not found' });
      }

      console.log(`✅ Room ${roomId} info retrieved`);
      res.json({
        id: room.id,
        playerCount: room.players.size,
        maxPlayers: room.maxPlayers,
        isStarted: room.isStarted,
        status: room.gameState?.status || 'waiting'
      });
    });

    // Start game endpoint - deals cards without selecting starting player
    this.app.post('/api/room/:roomId/start', async (req, res) => {
      const roomId = req.params.roomId;
      console.log(`🚀 API: Starting game for room ${roomId}`);
      const success = await this.dealCards(roomId);

      if (success) {
        res.json({ success: true, message: 'Cards dealt' });
      } else {
        res.status(400).json({ success: false, error: 'Could not deal cards' });
      }
    });

    // Create room
    this.app.post('/api/room', async (req, res) => {
      const roomId = this.generateRoomId();
      console.log(`🆕 API: Creating room ${roomId}`);

      const room: GameRoom = {
        id: roomId,
        gameState: null,
        players: new Map(),
        connections: new Map(),
        chatMessages: [],
        maxPlayers: 5,
        isStarted: false,
        createdAt: Date.now(),
        lastActivity: Date.now()
      };

      this.rooms.set(roomId, room);
      await this.saveRoomToRedis(room);

      console.log(`✅ Room ${roomId} created and saved`);
      res.json({ roomId });
    });
  }

  private async connectToRedis() {
    try {
      await this.redisService.connect();
      console.log('🔌 Redis service connected');
    } catch (error) {
      console.error('😱 Failed to connect to Redis, continuing without persistence:', error);
    }
  }

  private async saveRoomToRedis(room: GameRoom): Promise<void> {
    try {
      const storedRoom: StoredRoom = {
        id: room.id,
        gameState: room.gameState,
        players: Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name })),
        chatMessages: room.chatMessages,
        maxPlayers: room.maxPlayers,
        isStarted: room.isStarted,
        createdAt: room.createdAt,
        lastActivity: room.lastActivity
      };
      await this.redisService.saveRoom(room.id, storedRoom);
    } catch (error) {
      console.error(`Failed to save room ${room.id} to Redis:`, error);
    }
  }

  private async restoreRoomFromStorage(storedRoom: StoredRoom): Promise<GameRoom | null> {
    try {
      const room: GameRoom = {
        id: storedRoom.id,
        gameState: storedRoom.gameState,
        players: new Map(storedRoom.players.map(p => [p.id, { id: p.id, name: p.name }])),
        connections: new Map(),
        chatMessages: storedRoom.chatMessages,
        maxPlayers: storedRoom.maxPlayers,
        isStarted: storedRoom.isStarted,
        createdAt: storedRoom.createdAt,
        lastActivity: storedRoom.lastActivity
      };

      this.rooms.set(room.id, room);
      console.log(`📦 Room ${room.id} restored from storage`);
      return room;
    } catch (error) {
      console.error(`Failed to restore room ${storedRoom.id}:`, error);
      return null;
    }
  }

  private setupWebSocket() {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('🔗 New WebSocket connection');

      ws.on('message', async (data: WebSocket.RawData) => {
        try {
          const message: WebSocketMessage = JSON.parse(data.toString());
          await this.handleWebSocketMessage(ws, message);
        } catch (error) {
          console.error('❗ Error parsing WebSocket message:', error);
          ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
        }
      });

      ws.on('close', () => {
        console.log('🔌 WebSocket connection closed');
        this.handlePlayerDisconnection(ws);
      });

      ws.on('error', (error) => {
        console.error('❗ WebSocket error:', error);
        this.handlePlayerDisconnection(ws);
      });
    });
  }

  private async handleWebSocketMessage(ws: WebSocket, message: WebSocketMessage) {
    try {
      switch (message.type) {
        case 'join_room':
          await this.handleJoinRoom(ws, message);
          break;
        case 'create_room':
          await this.handleCreateRoom(ws, message);
          break;
        case 'game_action':
          await this.handleGameAction(ws, message);
          break;
        case 'chat_message':
          await this.handleChatMessage(ws, message);
          break;
        case 'leave_room':
          await this.handleLeaveRoom(ws, message);
          break;
        case 'select_starting_player':
          await this.handleSelectStartingPlayer(ws, message);
          break;
        case 'ping':
          // Keep-alive ping - just respond with pong
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        default:
          console.log(`❌ Unknown message type: ${message.type}`);
          ws.send(JSON.stringify({ type: 'error', error: 'Unknown message type' }));
      }
    } catch (error) {
      console.error('❗ Error handling WebSocket message:', error);
      ws.send(JSON.stringify({ type: 'error', error: 'Failed to process message' }));
    }
  }

  private async handleJoinRoom(ws: WebSocket, message: WebSocketMessage) {
    const { roomId, playerId, playerName } = message;
    console.log(`🎮 Player ${playerName} (${playerId}) attempting to join room ${roomId}`);

    if (!roomId || !playerId || !playerName) {
      console.log(`❌ Join room failed: Missing required fields`);
      return ws.send(JSON.stringify({ type: 'error', error: 'Missing required fields' }));
    }

    let room = this.rooms.get(roomId);

    // If room not in memory, try loading from Redis
    if (!room) {
      console.log(`💾 Room ${roomId} not in memory, checking Redis...`);
      const storedRoom = await this.redisService.getRoom(roomId);
      if (storedRoom) {
        console.log(`📥 Room ${roomId} found in Redis, restoring to memory`);
        const restoredRoom = await this.restoreRoomFromStorage(storedRoom);
        room = restoredRoom || undefined;
      }
    }

    if (!room) {
      console.log(`❌ Room ${roomId} not found anywhere`);
      return ws.send(JSON.stringify({ type: 'error', error: 'Room not found' }));
    }

    const existingPlayer = room.players.get(playerId);
    const isRejoining = !!existingPlayer;

    if (!isRejoining && room.players.size >= room.maxPlayers) {
      console.log(`❌ Room ${roomId} is full (${room.players.size}/${room.maxPlayers})`);
      return ws.send(JSON.stringify({ type: 'error', error: 'Room is full' }));
    }

    // Ensure player metadata exists and connection map is current
    room.players.set(playerId, { id: playerId, name: playerName });
    room.connections.set(playerId, ws);
    this.playerConnections.set(ws, { playerId, roomId });
    room.lastActivity = Date.now();

    console.log(`✅ Player ${playerName} ${isRejoining ? 'rejoined' : 'joined'} room ${roomId}`);

    // If player was in game state, reconnect them to the game
    if (room.gameState) {
      const gamePlayer = room.gameState.players.find(p => p.id === playerId);
      if (gamePlayer) {
        gamePlayer.isConnected = true;
        console.log(`🔄 Player ${playerName} (${playerId}) reconnected to ongoing game in room ${roomId}`);

        // Notify other connected players that this player has reconnected
        this.broadcastToRoom(roomId, {
          type: 'player_reconnected',
          playerId: playerId,
          playerName: playerName
        }, playerId);
      }
    }

    // Send success response
    ws.send(JSON.stringify({
      type: 'room_joined',
      roomId,
      playerId,
      players: Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name }))
    }));

    // If there's an active game, send current game state to rejoining player
    if (room.gameState && isRejoining) {
      console.log(`🎮 Sending game state to rejoining player ${playerName}`);
      const clientGameState = GameEngine.createClientGameState(room.gameState, playerId);
      ws.send(JSON.stringify({
        type: 'game_state_update',
        gameState: clientGameState,
        chatMessages: room.chatMessages
      }));
    }

    // Save room state to Redis after player joins
    await this.saveRoomToRedis(room);

    // Notify other players (only if it's a new join, not a rejoin)
    if (!isRejoining) {
      console.log(`📢 Notifying other players about ${playerName} joining room ${roomId}`);
      this.broadcastToRoom(roomId, {
        type: 'player_joined',
        player: { id: playerId, name: playerName }
      }, playerId);
    }
  }

  private async handleCreateRoom(ws: WebSocket, message: WebSocketMessage) {
    const { playerId, playerName } = message;
    console.log(`🆕 Player ${playerName} (${playerId}) creating new room`);

    if (!playerId || !playerName) {
      console.log(`❌ Create room failed: Missing required fields`);
      return ws.send(JSON.stringify({ type: 'error', error: 'Missing required fields' }));
    }

    const roomId = this.generateRoomId();
    const room: GameRoom = {
      id: roomId,
      gameState: null,
      players: new Map(),
      connections: new Map(),
      chatMessages: [],
      maxPlayers: 5,
      isStarted: false,
      createdAt: Date.now(),
      lastActivity: Date.now()
    };

    // Add creator to room
    room.players.set(playerId, { id: playerId, name: playerName });
    room.connections.set(playerId, ws);
    this.playerConnections.set(ws, { playerId, roomId });
    this.rooms.set(roomId, room);

    await this.saveRoomToRedis(room);
    console.log(`✅ Room ${roomId} created by ${playerName}`);

    ws.send(JSON.stringify({
      type: 'room_created',
      roomId,
      playerId,
      players: [{ id: playerId, name: playerName }]
    }));
  }

  private async handleGameAction(ws: WebSocket, message: WebSocketMessage) {
    const connection = this.playerConnections.get(ws);
    if (!connection) {
      console.log(`❌ Game action failed: No connection found`);
      return;
    }

    const room = this.rooms.get(connection.roomId);
    if (!room || !room.gameState || !message.action) {
      console.log(`❌ Game action failed: Room or game state not found`);
      return;
    }

    console.log(`🎮 Player ${connection.playerId} performing ${message.action.type} in room ${connection.roomId}`);

    try {
      let newGameState: ServerGameState;

      switch (message.action.type) {
        case 'play_card':
          if (!message.action.cardId || !message.action.pileId) return;
          newGameState = GameEngine.playCard(room.gameState, connection.playerId, message.action.cardId, message.action.pileId);
          console.log(`🂬 Card ${message.action.cardId} played to pile ${message.action.pileId}`);
          break;
        case 'end_turn':
          newGameState = GameEngine.endTurn(room.gameState);
          console.log(`⏭️ Turn ended by player ${connection.playerId}`);
          break;
        case 'undo_move':
          newGameState = GameEngine.undoLastMove(room.gameState);
          console.log(`↩️ Move undone by player ${connection.playerId}`);
          break;
        default:
          console.log(`❌ Unknown game action type: ${message.action.type}`);
          return;
      }

      room.gameState = newGameState;
      room.lastActivity = Date.now();

      // Save updated game state to Redis
      await this.saveRoomToRedis(room);

      // Broadcast updated game state to all players
      this.broadcastGameState(connection.roomId);

    } catch (error) {
      console.error(`❗ Game action error in room ${connection.roomId}:`, error);
      ws.send(JSON.stringify({
        type: 'game_error',
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  }

  private async handleChatMessage(ws: WebSocket, message: WebSocketMessage) {
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

    console.log(`💬 Chat message from ${connection.playerId} in room ${connection.roomId}`);

    // Save updated chat to Redis
    await this.saveRoomToRedis(room);

    this.broadcastToRoom(connection.roomId, {
      type: 'chat_message',
      message: chatMessage
    });
  }

  private async handleLeaveRoom(ws: WebSocket, message: WebSocketMessage) {
    await this.handlePlayerDisconnection(ws, { removeFromRoom: true });
  }

  private async handleSelectStartingPlayer(ws: WebSocket, message: WebSocketMessage) {
    const connection = this.playerConnections.get(ws);
    if (!connection || !message.startingPlayerId) return;

    console.log(`🏁 Selecting starting player ${message.startingPlayerId} for room ${connection.roomId}`);

    const success = await this.startGame(connection.roomId, message.startingPlayerId);
    if (!success) {
      console.log(`❌ Failed to select starting player for room ${connection.roomId}`);
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Failed to select starting player'
      }));
    }
  }

  private async handlePlayerDisconnection(ws: WebSocket, options: { removeFromRoom?: boolean } = {}) {
    const connection = this.playerConnections.get(ws);
    if (!connection) return;

    console.log(`🚪 Player ${connection.playerId} disconnecting from room ${connection.roomId}`);

    const room = this.rooms.get(connection.roomId);
    if (room) {
      const player = room.players.get(connection.playerId);
      const playerName = player?.name || 'Unknown';

      room.connections.delete(connection.playerId);
      if (options.removeFromRoom) {
        room.players.delete(connection.playerId);
      }
      room.lastActivity = Date.now();

      // Mark player as disconnected in game state (but keep them for reconnection)
      if (room.gameState) {
        const gamePlayer = room.gameState.players.find(p => p.id === connection.playerId);
        if (gamePlayer) {
          gamePlayer.isConnected = false;
          console.log(`🔌 Player ${connection.playerId} marked as disconnected in game state`);

          // Notify other players about disconnection
          this.broadcastToRoom(connection.roomId, {
            type: 'player_disconnected',
            playerId: connection.playerId,
            playerName: playerName
          });
        }
      } else if (options.removeFromRoom) {
        // If no game state and player intentionally left, notify others
        this.broadcastToRoom(connection.roomId, {
          type: 'player_left',
          playerId: connection.playerId
        });
      } else {
        this.broadcastToRoom(connection.roomId, {
          type: 'player_disconnected',
          playerId: connection.playerId,
          playerName: playerName
        });
      }

      // Update room in Redis with current state
      await this.saveRoomToRedis(room);

      // Only remove from memory if no active game or all players disconnected
      // Keep rooms with active games in memory for better performance
      if (room.players.size === 0 && (!room.gameState || room.gameState.status === 'waiting')) {
        console.log(`🧹 Room ${connection.roomId} now empty and no active game, removing from memory but keeping in Redis`);
        this.rooms.delete(connection.roomId);
      } else if (room.connections.size === 0 && room.gameState) {
        console.log(`🔄 Room ${connection.roomId} has no connected players but has active game - keeping in memory for reconnection`);
      }
    }

    this.playerConnections.delete(ws);
  }

  private forEachActiveConnection(room: GameRoom, callback: (playerId: string, socket: WebSocket) => void) {
    const disconnectedPlayers: string[] = [];

    room.connections.forEach((socket, playerId) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        if (!socket || socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
          disconnectedPlayers.push(playerId);
        }
        return;
      }

      callback(playerId, socket);
    });

    disconnectedPlayers.forEach(playerId => {
      room.connections.delete(playerId);
    });
  }

  private broadcastGameState(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room || !room.gameState) return;

    this.forEachActiveConnection(room, (playerId, socket) => {
      const clientGameState = GameEngine.createClientGameState(room.gameState!, playerId);
      socket.send(JSON.stringify({
        type: 'game_state_update',
        gameState: clientGameState,
        chatMessages: room.chatMessages
      }));
    });
  }

  private broadcastToRoom(roomId: string, message: any, excludePlayerId?: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    this.forEachActiveConnection(room, (playerId, socket) => {
      if (playerId !== excludePlayerId) {
        socket.send(JSON.stringify(message));
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
    setInterval(async () => {
      console.log(`🧹 Starting cleanup check...`);
      const now = Date.now();
      const TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours
      let cleanedMemory = 0;

      // Clean up memory rooms
      this.rooms.forEach((room, roomId) => {
        if (now - room.lastActivity > TIMEOUT) {
          console.log(`🧹 Cleaning up inactive room from memory: ${roomId}`);
          this.rooms.delete(roomId);
          cleanedMemory++;
        }
      });

      // Clean up Redis rooms
      const cleanedRedis = await this.redisService.cleanupExpiredRooms();

      if (cleanedMemory > 0 || cleanedRedis > 0) {
        console.log(`🧹 Cleanup completed: ${cleanedMemory} from memory, ${cleanedRedis} from Redis`);
      }
    }, 10 * 60 * 1000); // Check every 10 minutes
  }

  public async dealCards(roomId: string): Promise<boolean> {
    console.log(`🃏 Dealing cards for room ${roomId}`);
    const room = this.rooms.get(roomId);
    if (!room || room.isStarted || room.players.size < 1) {
      console.log(`❌ Cannot deal cards: Room not found, already started, or no players`);
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

      await this.saveRoomToRedis(room);
      console.log(`✅ Cards dealt successfully for room ${roomId}`);

      this.broadcastGameState(roomId);
      return true;
    } catch (error) {
      console.error(`❗ Failed to deal cards for room ${roomId}:`, error);
      return false;
    }
  }

  public async startGame(roomId: string, startingPlayerId?: string): Promise<boolean> {
    console.log(`🏁 Starting game for room ${roomId} with starting player ${startingPlayerId}`);
    const room = this.rooms.get(roomId);
    if (!room || !room.gameState || room.gameState.status !== 'cards_dealt') {
      console.log(`❌ Cannot start game: Invalid room state`);
      return false;
    }

    try {
      room.gameState = GameEngine.selectStartingPlayer(room.gameState, startingPlayerId);
      room.lastActivity = Date.now();

      await this.saveRoomToRedis(room);
      console.log(`✅ Game started successfully for room ${roomId}`);

      this.broadcastGameState(roomId);
      return true;
    } catch (error) {
      console.error(`❗ Failed to start game for room ${roomId}:`, error);
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

// Start the server when executed directly
if (require.main === module) {
  const gameServer = new GameServer();
  gameServer.start();
}

export default GameServer;
