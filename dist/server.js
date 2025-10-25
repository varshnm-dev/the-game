"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const ws_1 = __importDefault(require("ws"));
const cors_1 = __importDefault(require("cors"));
const uuid_1 = require("uuid");
const GameEngine_1 = require("./game/GameEngine");
const RedisService_1 = require("./services/RedisService");
class GameServer {
    constructor(options = {}) {
        this.app = (0, express_1.default)();
        this.server = (0, http_1.createServer)(this.app);
        this.wss = new ws_1.default.Server({ server: this.server });
        this.rooms = new Map();
        this.playerConnections = new Map();
        this.cleanupInterval = null;
        this.redisService = options.redisService ?? new RedisService_1.RedisService();
        this.setupExpress();
        this.setupWebSocket();
        if (options.enableCleanupTimer !== false) {
            this.startCleanupTimer();
        }
        if (options.autoConnectRedis !== false) {
            this.connectToRedis();
        }
    }
    setupExpress() {
        const allowedOrigins = process.env.NODE_ENV === 'production'
            ? [process.env.FRONTEND_URL, process.env.RENDER_EXTERNAL_URL, 'https://the-game-1-quxo.onrender.com'].filter((url) => Boolean(url))
            : ['http://localhost:3000', 'http://localhost:3001'];
        this.app.use((0, cors_1.default)({
            origin: allowedOrigins,
            credentials: true
        }));
        this.app.use(express_1.default.json());
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
            }
            else {
                res.status(400).json({ success: false, error: 'Could not deal cards' });
            }
        });
        // Create room
        this.app.post('/api/room', async (req, res) => {
            const roomId = this.generateRoomId();
            console.log(`🆕 API: Creating room ${roomId}`);
            const room = {
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
            await this.persistRoom(room, { chat: false });
            console.log(`✅ Room ${roomId} created and saved`);
            res.json({ roomId });
        });
    }
    async connectToRedis() {
        try {
            await this.redisService.connect();
            console.log('🔌 Redis service connected');
        }
        catch (error) {
            console.error('😱 Failed to connect to Redis, continuing without persistence:', error);
        }
    }
    getStoredPlayers(room) {
        return Array.from(room.players.values()).map(player => ({ id: player.id, name: player.name }));
    }
    supportsStructuredPersistence(service) {
        return (typeof service.saveRoomMetadata === 'function' &&
            typeof service.savePlayers === 'function' &&
            typeof service.saveGameState === 'function' &&
            typeof service.clearGameState === 'function' &&
            typeof service.setChatMessages === 'function');
    }
    hasLegacyRoomPersistence(service) {
        return typeof service.saveRoom === 'function';
    }
    isStructuredSnapshot(snapshot) {
        return snapshot.metadata !== undefined;
    }
    normalizeSnapshot(snapshot) {
        if (this.isStructuredSnapshot(snapshot)) {
            return {
                metadata: snapshot.metadata,
                players: snapshot.players ?? [],
                gameState: snapshot.gameState ?? null,
                chatMessages: snapshot.chatMessages ?? []
            };
        }
        return {
            metadata: {
                id: snapshot.id,
                maxPlayers: snapshot.maxPlayers ?? snapshot.players?.length ?? 0,
                isStarted: snapshot.isStarted ?? false,
                createdAt: snapshot.createdAt ?? Date.now(),
                lastActivity: snapshot.lastActivity ?? Date.now()
            },
            players: snapshot.players ?? [],
            gameState: snapshot.gameState ?? null,
            chatMessages: snapshot.chatMessages ?? []
        };
    }
    buildLegacySnapshot(room) {
        return {
            id: room.id,
            gameState: room.gameState,
            players: this.getStoredPlayers(room),
            chatMessages: room.chatMessages,
            maxPlayers: room.maxPlayers,
            isStarted: room.isStarted,
            createdAt: room.createdAt,
            lastActivity: room.lastActivity
        };
    }
    async persistRoom(room, options) {
        const persistOptions = {
            metadata: true,
            players: true,
            gameState: true,
            chat: true,
            ...options
        };
        try {
            if (this.supportsStructuredPersistence(this.redisService)) {
                const operations = [];
                if (persistOptions.metadata) {
                    const metadata = {
                        id: room.id,
                        maxPlayers: room.maxPlayers,
                        isStarted: room.isStarted,
                        createdAt: room.createdAt,
                        lastActivity: room.lastActivity
                    };
                    operations.push(this.redisService.saveRoomMetadata(room.id, metadata));
                }
                if (persistOptions.players) {
                    operations.push(this.redisService.savePlayers(room.id, this.getStoredPlayers(room)));
                }
                if (persistOptions.gameState) {
                    if (room.gameState) {
                        operations.push(this.redisService.saveGameState(room.id, room.gameState));
                    }
                    else {
                        operations.push(this.redisService.clearGameState(room.id));
                    }
                }
                if (persistOptions.chat) {
                    operations.push(this.redisService.setChatMessages(room.id, room.chatMessages));
                }
                await Promise.all(operations);
            }
            else if (this.hasLegacyRoomPersistence(this.redisService)) {
                if (persistOptions.metadata || persistOptions.players || persistOptions.gameState || persistOptions.chat) {
                    await this.redisService.saveRoom(room.id, this.buildLegacySnapshot(room));
                }
            }
        }
        catch (error) {
            console.error(`Failed to persist room ${room.id}:`, error);
        }
    }
    async restoreRoomFromStorage(snapshot) {
        try {
            const normalized = this.normalizeSnapshot(snapshot);
            const room = {
                id: normalized.metadata.id,
                gameState: normalized.gameState,
                players: new Map(normalized.players.map(player => [player.id, { id: player.id, name: player.name }])),
                connections: new Map(),
                chatMessages: normalized.chatMessages,
                maxPlayers: normalized.metadata.maxPlayers,
                isStarted: normalized.metadata.isStarted,
                createdAt: normalized.metadata.createdAt,
                lastActivity: normalized.metadata.lastActivity
            };
            this.rooms.set(room.id, room);
            console.log(`📦 Room ${room.id} restored from storage`);
            return room;
        }
        catch (error) {
            const id = this.isStructuredSnapshot(snapshot) ? snapshot.metadata.id : snapshot.id;
            console.error(`Failed to restore room ${id}:`, error);
            return null;
        }
    }
    async hydrateRoomFromPersistence(room) {
        try {
            const snapshot = await this.redisService.getRoom(room.id);
            if (!snapshot) {
                return;
            }
            const normalized = this.normalizeSnapshot(snapshot);
            room.maxPlayers = normalized.metadata.maxPlayers;
            room.isStarted = normalized.metadata.isStarted;
            room.createdAt = normalized.metadata.createdAt;
            room.lastActivity = normalized.metadata.lastActivity;
            room.chatMessages = normalized.chatMessages;
            room.gameState = normalized.gameState;
            const playersFromSnapshot = new Map();
            normalized.players.forEach((storedPlayer) => {
                playersFromSnapshot.set(storedPlayer.id, { id: storedPlayer.id, name: storedPlayer.name });
            });
            // Preserve any players currently connected but not yet persisted
            room.players.forEach((player, playerId) => {
                if (!playersFromSnapshot.has(playerId)) {
                    playersFromSnapshot.set(playerId, player);
                }
            });
            room.players = playersFromSnapshot;
            // Drop stale connections for players no longer present
            room.connections.forEach((socket, playerId) => {
                if (!room.players.has(playerId)) {
                    this.playerConnections.delete(socket);
                    room.connections.delete(playerId);
                }
            });
        }
        catch (error) {
            console.error(`Failed to hydrate room ${room.id} from persistence:`, error);
        }
    }
    setupWebSocket() {
        this.wss.on('connection', (ws) => {
            console.log('🔗 New WebSocket connection');
            ws.on('message', async (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    await this.handleWebSocketMessage(ws, message);
                }
                catch (error) {
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
    async handleWebSocketMessage(ws, message) {
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
        }
        catch (error) {
            console.error('❗ Error handling WebSocket message:', error);
            ws.send(JSON.stringify({ type: 'error', error: 'Failed to process message' }));
        }
    }
    async handleJoinRoom(ws, message) {
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
        await this.hydrateRoomFromPersistence(room);
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
        let playerInGame = false;
        if (room.gameState) {
            const gamePlayer = room.gameState.players.find(p => p.id === playerId);
            if (gamePlayer) {
                gamePlayer.isConnected = true;
                playerInGame = true;
                console.log(`🔄 Player ${playerName} (${playerId}) reconnected to ongoing game in room ${roomId}`);
                // Notify other connected players that this player has reconnected
                this.broadcastToRoom(roomId, {
                    type: 'player_reconnected',
                    playerId: playerId,
                    playerName: playerName
                }, playerId);
            }
        }
        await this.persistRoom(room, { chat: false });
        // Send success response
        ws.send(JSON.stringify({
            type: 'room_joined',
            roomId,
            playerId,
            players: Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name }))
        }));
        // If there's an active game, send current game state to the player
        if (room.gameState && playerInGame) {
            console.log(`🎮 Sending game state to rejoining player ${playerName}`);
            const clientGameState = GameEngine_1.GameEngine.createClientGameState(room.gameState, playerId);
            ws.send(JSON.stringify({
                type: 'game_state_update',
                gameState: clientGameState,
                chatMessages: room.chatMessages
            }));
        }
        // Notify other players (only if it's a new join, not a rejoin)
        if (!isRejoining) {
            console.log(`📢 Notifying other players about ${playerName} joining room ${roomId}`);
            this.broadcastToRoom(roomId, {
                type: 'player_joined',
                player: { id: playerId, name: playerName }
            }, playerId);
        }
    }
    async handleCreateRoom(ws, message) {
        const { playerId, playerName } = message;
        console.log(`🆕 Player ${playerName} (${playerId}) creating new room`);
        if (!playerId || !playerName) {
            console.log(`❌ Create room failed: Missing required fields`);
            return ws.send(JSON.stringify({ type: 'error', error: 'Missing required fields' }));
        }
        const roomId = this.generateRoomId();
        const room = {
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
        await this.persistRoom(room);
        console.log(`✅ Room ${roomId} created by ${playerName}`);
        ws.send(JSON.stringify({
            type: 'room_created',
            roomId,
            playerId,
            players: [{ id: playerId, name: playerName }]
        }));
    }
    async handleGameAction(ws, message) {
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
            let newGameState;
            switch (message.action.type) {
                case 'play_card':
                    if (!message.action.cardId || !message.action.pileId)
                        return;
                    newGameState = GameEngine_1.GameEngine.playCard(room.gameState, connection.playerId, message.action.cardId, message.action.pileId);
                    console.log(`🂬 Card ${message.action.cardId} played to pile ${message.action.pileId}`);
                    break;
                case 'end_turn':
                    newGameState = GameEngine_1.GameEngine.endTurn(room.gameState);
                    console.log(`⏭️ Turn ended by player ${connection.playerId}`);
                    break;
                case 'undo_move':
                    newGameState = GameEngine_1.GameEngine.undoLastMove(room.gameState);
                    console.log(`↩️ Move undone by player ${connection.playerId}`);
                    break;
                default:
                    console.log(`❌ Unknown game action type: ${message.action.type}`);
                    return;
            }
            room.gameState = newGameState;
            room.lastActivity = Date.now();
            // Save updated game state to Redis before broadcasting
            await this.persistRoom(room, { chat: false });
            // Broadcast updated game state to all players
            this.broadcastGameState(connection.roomId);
        }
        catch (error) {
            console.error(`❗ Game action error in room ${connection.roomId}:`, error);
            ws.send(JSON.stringify({
                type: 'game_error',
                error: error instanceof Error ? error.message : 'Unknown error'
            }));
        }
    }
    async handleChatMessage(ws, message) {
        const connection = this.playerConnections.get(ws);
        if (!connection || !message.message)
            return;
        const room = this.rooms.get(connection.roomId);
        if (!room)
            return;
        const chatMessage = {
            ...message.message,
            id: (0, uuid_1.v4)(),
            playerId: connection.playerId,
            timestamp: Date.now()
        };
        console.log(`💬 Chat message from ${connection.playerId} in room ${connection.roomId}`);
        const appendChat = this.redisService.appendChatMessage?.bind(this.redisService);
        let appended = false;
        if (appendChat) {
            appended = await appendChat(connection.roomId, chatMessage);
        }
        if (appended) {
            const fetchChatMessages = this.redisService.getChatMessages?.bind(this.redisService);
            if (fetchChatMessages) {
                room.chatMessages = await fetchChatMessages(connection.roomId);
            }
            else {
                room.chatMessages.push(chatMessage);
            }
        }
        else {
            room.chatMessages.push(chatMessage);
            if (room.chatMessages.length > 100) {
                room.chatMessages = room.chatMessages.slice(-100);
            }
        }
        room.lastActivity = Date.now();
        await this.persistRoom(room, { gameState: false, chat: !appended });
        this.broadcastToRoom(connection.roomId, {
            type: 'chat_message',
            message: chatMessage
        });
    }
    async handleLeaveRoom(ws, message) {
        await this.handlePlayerDisconnection(ws, { removeCompletely: true });
    }
    async handleSelectStartingPlayer(ws, message) {
        const connection = this.playerConnections.get(ws);
        if (!connection || !message.startingPlayerId)
            return;
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
    async handlePlayerDisconnection(ws, options = {}) {
        const connection = this.playerConnections.get(ws);
        if (!connection)
            return;
        console.log(`🚪 Player ${connection.playerId} disconnecting from room ${connection.roomId}`);
        const room = this.rooms.get(connection.roomId);
        if (room) {
            const player = room.players.get(connection.playerId);
            const playerName = player?.name || 'Unknown';
            const shouldRemovePlayer = options.removeCompletely || !room.gameState;
            room.connections.delete(connection.playerId);
            if (player && shouldRemovePlayer) {
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
            }
            else if (shouldRemovePlayer) {
                // If no game state and player left entirely, notify about player leaving
                this.broadcastToRoom(connection.roomId, {
                    type: 'player_left',
                    playerId: connection.playerId
                });
            }
            else {
                // Before the game starts, treat disconnects as temporary
                this.broadcastToRoom(connection.roomId, {
                    type: 'player_disconnected',
                    playerId: connection.playerId,
                    playerName: playerName
                });
            }
            // Update room in Redis with current state
            await this.persistRoom(room, { chat: false });
            // Only remove from memory if no active game or all players disconnected
            // Keep rooms with active games in memory for better performance
            const connectedPlayers = Array.from(room.connections.values()).filter(socket => socket.readyState === ws_1.default.OPEN).length;
            if (connectedPlayers === 0 && (!room.gameState || room.gameState.status === 'waiting')) {
                console.log(`🧹 Room ${connection.roomId} now empty and no active game, removing from memory but keeping in Redis`);
                this.rooms.delete(connection.roomId);
            }
            else if (connectedPlayers === 0 && room.gameState) {
                console.log(`🔄 Room ${connection.roomId} empty but has active game - keeping in memory for reconnection`);
            }
        }
        this.playerConnections.delete(ws);
    }
    forEachActiveConnection(room, callback) {
        const disconnectedPlayers = [];
        room.connections.forEach((socket, playerId) => {
            if (!socket || socket.readyState !== ws_1.default.OPEN) {
                if (!socket || socket.readyState === ws_1.default.CLOSING || socket.readyState === ws_1.default.CLOSED) {
                    disconnectedPlayers.push(playerId);
                    if (socket) {
                        this.playerConnections.delete(socket);
                    }
                }
                return;
            }
            callback(playerId, socket);
        });
        disconnectedPlayers.forEach(playerId => {
            room.connections.delete(playerId);
        });
    }
    broadcastGameState(roomId) {
        const room = this.rooms.get(roomId);
        if (!room || !room.gameState)
            return;
        this.forEachActiveConnection(room, (playerId, socket) => {
            const clientGameState = GameEngine_1.GameEngine.createClientGameState(room.gameState, playerId);
            socket.send(JSON.stringify({
                type: 'game_state_update',
                gameState: clientGameState,
                chatMessages: room.chatMessages
            }));
        });
    }
    broadcastToRoom(roomId, message, excludePlayerId) {
        const room = this.rooms.get(roomId);
        if (!room)
            return;
        this.forEachActiveConnection(room, (playerId, socket) => {
            if (playerId !== excludePlayerId) {
                socket.send(JSON.stringify(message));
            }
        });
    }
    generateRoomId() {
        let id;
        do {
            id = Math.random().toString(36).substring(2, 8).toUpperCase();
        } while (this.rooms.has(id));
        return id;
    }
    startCleanupTimer() {
        this.cleanupInterval = setInterval(async () => {
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
    async dealCards(roomId) {
        console.log(`🃏 Dealing cards for room ${roomId}`);
        const room = this.rooms.get(roomId);
        if (!room || room.isStarted || room.players.size < 1) {
            console.log(`❌ Cannot deal cards: Room not found, already started, or no players`);
            return false;
        }
        try {
            const playerData = Array.from(room.connections.entries())
                .filter(([, socket]) => socket.readyState === ws_1.default.OPEN)
                .map(([playerId]) => {
                const player = room.players.get(playerId);
                if (!player) {
                    return null;
                }
                return {
                    id: player.id,
                    name: player.name,
                    connectionId: player.id
                };
            })
                .filter((player) => player !== null);
            room.gameState = GameEngine_1.GameEngine.initializeGame(roomId, playerData);
            room.isStarted = true;
            room.lastActivity = Date.now();
            await this.persistRoom(room, { chat: false });
            console.log(`✅ Cards dealt successfully for room ${roomId}`);
            this.broadcastGameState(roomId);
            return true;
        }
        catch (error) {
            console.error(`❗ Failed to deal cards for room ${roomId}:`, error);
            return false;
        }
    }
    async startGame(roomId, startingPlayerId) {
        console.log(`🏁 Starting game for room ${roomId} with starting player ${startingPlayerId}`);
        const room = this.rooms.get(roomId);
        if (!room || !room.gameState || room.gameState.status !== 'cards_dealt') {
            console.log(`❌ Cannot start game: Invalid room state`);
            return false;
        }
        try {
            room.gameState = GameEngine_1.GameEngine.selectStartingPlayer(room.gameState, startingPlayerId);
            room.lastActivity = Date.now();
            await this.persistRoom(room, { chat: false });
            console.log(`✅ Game started successfully for room ${roomId}`);
            this.broadcastGameState(roomId);
            return true;
        }
        catch (error) {
            console.error(`❗ Failed to start game for room ${roomId}:`, error);
            return false;
        }
    }
    start(port = parseInt(process.env.PORT || '3001')) {
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
exports.default = GameServer;
