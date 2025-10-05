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
class GameServer {
    constructor() {
        this.app = (0, express_1.default)();
        this.server = (0, http_1.createServer)(this.app);
        this.wss = new ws_1.default.Server({ server: this.server });
        this.rooms = new Map();
        this.playerConnections = new Map();
        this.setupExpress();
        this.setupWebSocket();
        this.startCleanupTimer();
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
        // Start game endpoint - deals cards without selecting starting player
        this.app.post('/api/room/:roomId/start', (req, res) => {
            const roomId = req.params.roomId;
            const success = this.dealCards(roomId);
            if (success) {
                res.json({ success: true, message: 'Cards dealt' });
            }
            else {
                res.status(400).json({ success: false, error: 'Could not deal cards' });
            }
        });
        // Create room
        this.app.post('/api/room', (req, res) => {
            const roomId = this.generateRoomId();
            const room = {
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
    setupWebSocket() {
        this.wss.on('connection', (ws) => {
            console.log('New WebSocket connection');
            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleWebSocketMessage(ws, message);
                }
                catch (error) {
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
    handleWebSocketMessage(ws, message) {
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
                case 'select_starting_player':
                    this.handleSelectStartingPlayer(ws, message);
                    break;
                case 'ping':
                    // Keep-alive ping - just respond with pong
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;
                default:
                    ws.send(JSON.stringify({ type: 'error', error: 'Unknown message type' }));
            }
        }
        catch (error) {
            console.error('Error handling WebSocket message:', error);
            ws.send(JSON.stringify({ type: 'error', error: 'Failed to process message' }));
        }
    }
    handleJoinRoom(ws, message) {
        const { roomId, playerId, playerName } = message;
        if (!roomId || !playerId || !playerName) {
            return ws.send(JSON.stringify({ type: 'error', error: 'Missing required fields' }));
        }
        const room = this.rooms.get(roomId);
        if (!room) {
            return ws.send(JSON.stringify({ type: 'error', error: 'Room not found' }));
        }
        const existingPlayer = room.players.get(playerId);
        const isRejoining = !!existingPlayer;
        if (!isRejoining && room.players.size >= room.maxPlayers) {
            return ws.send(JSON.stringify({ type: 'error', error: 'Room is full' }));
        }
        // Add or update player in room
        room.players.set(playerId, { id: playerId, name: playerName, ws });
        this.playerConnections.set(ws, { playerId, roomId });
        room.lastActivity = Date.now();
        // If player was in game state, reconnect them to the game
        if (room.gameState) {
            const gamePlayer = room.gameState.players.find(p => p.id === playerId);
            if (gamePlayer) {
                gamePlayer.isConnected = true;
                console.log(`Player ${playerName} (${playerId}) reconnected to game in room ${roomId}`);
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
            const clientGameState = GameEngine_1.GameEngine.createClientGameState(room.gameState, playerId);
            ws.send(JSON.stringify({
                type: 'game_state_update',
                gameState: clientGameState,
                chatMessages: room.chatMessages
            }));
        }
        // Notify other players (only if it's a new join, not a rejoin)
        if (!isRejoining) {
            this.broadcastToRoom(roomId, {
                type: 'player_joined',
                player: { id: playerId, name: playerName }
            }, playerId);
        }
    }
    handleCreateRoom(ws, message) {
        const { playerId, playerName } = message;
        if (!playerId || !playerName) {
            return ws.send(JSON.stringify({ type: 'error', error: 'Missing required fields' }));
        }
        const roomId = this.generateRoomId();
        const room = {
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
    handleGameAction(ws, message) {
        const connection = this.playerConnections.get(ws);
        if (!connection)
            return;
        const room = this.rooms.get(connection.roomId);
        if (!room || !room.gameState || !message.action)
            return;
        try {
            let newGameState;
            switch (message.action.type) {
                case 'play_card':
                    if (!message.action.cardId || !message.action.pileId)
                        return;
                    newGameState = GameEngine_1.GameEngine.playCard(room.gameState, connection.playerId, message.action.cardId, message.action.pileId);
                    break;
                case 'end_turn':
                    newGameState = GameEngine_1.GameEngine.endTurn(room.gameState);
                    break;
                case 'undo_move':
                    newGameState = GameEngine_1.GameEngine.undoLastMove(room.gameState);
                    break;
                default:
                    return;
            }
            room.gameState = newGameState;
            room.lastActivity = Date.now();
            // Broadcast updated game state to all players
            this.broadcastGameState(connection.roomId);
        }
        catch (error) {
            ws.send(JSON.stringify({
                type: 'game_error',
                error: error instanceof Error ? error.message : 'Unknown error'
            }));
        }
    }
    handleChatMessage(ws, message) {
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
    handleLeaveRoom(ws, message) {
        this.handlePlayerDisconnection(ws);
    }
    handleSelectStartingPlayer(ws, message) {
        const connection = this.playerConnections.get(ws);
        if (!connection || !message.startingPlayerId)
            return;
        const success = this.startGame(connection.roomId, message.startingPlayerId);
        if (!success) {
            ws.send(JSON.stringify({
                type: 'error',
                error: 'Failed to select starting player'
            }));
        }
    }
    handlePlayerDisconnection(ws) {
        const connection = this.playerConnections.get(ws);
        if (!connection)
            return;
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
    broadcastGameState(roomId) {
        const room = this.rooms.get(roomId);
        if (!room || !room.gameState)
            return;
        room.players.forEach((player) => {
            if (player.ws.readyState === ws_1.default.OPEN) {
                const clientGameState = GameEngine_1.GameEngine.createClientGameState(room.gameState, player.id);
                player.ws.send(JSON.stringify({
                    type: 'game_state_update',
                    gameState: clientGameState,
                    chatMessages: room.chatMessages
                }));
            }
        });
    }
    broadcastToRoom(roomId, message, excludePlayerId) {
        const room = this.rooms.get(roomId);
        if (!room)
            return;
        room.players.forEach((player) => {
            if (player.id !== excludePlayerId && player.ws.readyState === ws_1.default.OPEN) {
                player.ws.send(JSON.stringify(message));
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
    dealCards(roomId) {
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
            room.gameState = GameEngine_1.GameEngine.initializeGame(roomId, playerData);
            room.isStarted = true;
            room.lastActivity = Date.now();
            this.broadcastGameState(roomId);
            return true;
        }
        catch (error) {
            console.error('Failed to deal cards:', error);
            return false;
        }
    }
    startGame(roomId, startingPlayerId) {
        const room = this.rooms.get(roomId);
        if (!room || !room.gameState || room.gameState.status !== 'cards_dealt') {
            return false;
        }
        try {
            room.gameState = GameEngine_1.GameEngine.selectStartingPlayer(room.gameState, startingPlayerId);
            room.lastActivity = Date.now();
            this.broadcastGameState(roomId);
            return true;
        }
        catch (error) {
            console.error('Failed to start game:', error);
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
// Start the server
const gameServer = new GameServer();
gameServer.start();
exports.default = GameServer;
