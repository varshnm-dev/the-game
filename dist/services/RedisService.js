"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisService = void 0;
const redis_1 = require("redis");
class RedisService {
    constructor() {
        this.connected = false;
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
            throw new Error('REDIS_URL environment variable is required');
        }
        this.client = (0, redis_1.createClient)({
            url: redisUrl,
            socket: {
                connectTimeout: 10000
            }
        });
        this.client.on('error', (err) => {
            console.error('Redis Client Error:', err);
            this.connected = false;
        });
        this.client.on('connect', () => {
            console.log('✅ Connected to Redis');
            this.connected = true;
        });
        this.client.on('disconnect', () => {
            console.log('❌ Disconnected from Redis');
            this.connected = false;
        });
    }
    async connect() {
        try {
            await this.client.connect();
            console.log('🔑 Redis connection established');
        }
        catch (error) {
            console.error('Failed to connect to Redis:', error);
            console.warn('⚠️ Server will continue without Redis persistence');
            // Don't throw error - allow server to start without Redis
        }
    }
    async disconnect() {
        try {
            await this.client.disconnect();
            console.log('🔌 Redis connection closed');
        }
        catch (error) {
            console.error('Error disconnecting from Redis:', error);
        }
    }
    isConnected() {
        return this.connected && this.client.isReady;
    }
    metadataKey(roomId) {
        return `room:${roomId}:metadata`;
    }
    playersKey(roomId) {
        return `room:${roomId}:players`;
    }
    gameStateKey(roomId) {
        return `room:${roomId}:gameState`;
    }
    chatKey(roomId) {
        return `room:${roomId}:chat`;
    }
    get expirySeconds() {
        return 4 * 60 * 60; // 4 hours
    }
    async saveRoomMetadata(roomId, metadata) {
        try {
            if (!this.isConnected()) {
                try {
                    await this.connect();
                }
                catch (reconnectError) {
                    console.warn('Redis not connected and reconnection failed, cannot save room');
                    return false;
                }
            }
            const metadataKey = this.metadataKey(roomId);
            await this.client.hSet(metadataKey, {
                id: metadata.id,
                maxPlayers: metadata.maxPlayers,
                isStarted: metadata.isStarted ? 1 : 0,
                createdAt: metadata.createdAt,
                lastActivity: metadata.lastActivity
            });
            await this.client.expire(metadataKey, this.expirySeconds);
            await this.client.sAdd('active_rooms', roomId);
            console.log(`💾 Room ${roomId} metadata saved to Redis`);
            return true;
        }
        catch (error) {
            console.error(`Failed to save room metadata ${roomId}:`, error);
            this.connected = false;
            return false;
        }
    }
    async getRoomMetadata(roomId) {
        try {
            if (!this.isConnected()) {
                try {
                    await this.connect();
                }
                catch (reconnectError) {
                    console.warn('Redis not connected and reconnection failed, cannot get room');
                    return null;
                }
            }
            const metadataKey = this.metadataKey(roomId);
            const metadata = await this.client.hGetAll(metadataKey);
            if (!metadata || Object.keys(metadata).length === 0) {
                console.log(`🔍 Room ${roomId} not found in Redis`);
                return null;
            }
            const isStartedValue = metadata.isStarted;
            const storedMetadata = {
                id: metadata.id || roomId,
                maxPlayers: Number(metadata.maxPlayers ?? 0),
                isStarted: isStartedValue === '1' || isStartedValue === 'true',
                createdAt: Number(metadata.createdAt ?? Date.now()),
                lastActivity: Number(metadata.lastActivity ?? Date.now())
            };
            console.log(`📥 Room ${roomId} metadata loaded from Redis`);
            return storedMetadata;
        }
        catch (error) {
            console.error(`Failed to get room metadata ${roomId}:`, error);
            this.connected = false;
            return null;
        }
    }
    async savePlayers(roomId, players) {
        try {
            if (!this.isConnected()) {
                try {
                    await this.connect();
                }
                catch (reconnectError) {
                    console.warn('Redis not connected and reconnection failed, cannot save players');
                    return false;
                }
            }
            const key = this.playersKey(roomId);
            await this.client.setEx(key, this.expirySeconds, JSON.stringify(players));
            console.log(`💾 Room ${roomId} players saved to Redis`);
            return true;
        }
        catch (error) {
            console.error(`Failed to save players for room ${roomId}:`, error);
            this.connected = false;
            return false;
        }
    }
    async getPlayers(roomId) {
        try {
            if (!this.isConnected()) {
                try {
                    await this.connect();
                }
                catch (reconnectError) {
                    console.warn('Redis not connected and reconnection failed, cannot get players');
                    return [];
                }
            }
            const key = this.playersKey(roomId);
            const data = await this.client.get(key);
            if (!data) {
                return [];
            }
            return JSON.parse(data);
        }
        catch (error) {
            console.error(`Failed to get players for room ${roomId}:`, error);
            this.connected = false;
            return [];
        }
    }
    async saveGameState(roomId, gameState) {
        try {
            if (!this.isConnected()) {
                try {
                    await this.connect();
                }
                catch (reconnectError) {
                    console.warn('Redis not connected and reconnection failed, cannot save game state');
                    return false;
                }
            }
            const key = this.gameStateKey(roomId);
            await this.client.setEx(key, this.expirySeconds, JSON.stringify(gameState));
            console.log(`💾 Room ${roomId} game state saved to Redis`);
            return true;
        }
        catch (error) {
            console.error(`Failed to save game state for room ${roomId}:`, error);
            this.connected = false;
            return false;
        }
    }
    async clearGameState(roomId) {
        try {
            if (!this.isConnected()) {
                return;
            }
            await this.client.del(this.gameStateKey(roomId));
        }
        catch (error) {
            console.error(`Failed to clear game state for room ${roomId}:`, error);
        }
    }
    async getGameState(roomId) {
        try {
            if (!this.isConnected()) {
                try {
                    await this.connect();
                }
                catch (reconnectError) {
                    console.warn('Redis not connected and reconnection failed, cannot get game state');
                    return null;
                }
            }
            const key = this.gameStateKey(roomId);
            const data = await this.client.get(key);
            if (!data) {
                return null;
            }
            return JSON.parse(data);
        }
        catch (error) {
            console.error(`Failed to get game state for room ${roomId}:`, error);
            this.connected = false;
            return null;
        }
    }
    async setChatMessages(roomId, messages) {
        try {
            if (!this.isConnected()) {
                try {
                    await this.connect();
                }
                catch (reconnectError) {
                    console.warn('Redis not connected and reconnection failed, cannot save chat');
                    return false;
                }
            }
            const key = this.chatKey(roomId);
            const pipeline = this.client.multi();
            pipeline.del(key);
            if (messages.length > 0) {
                pipeline.rPush(key, messages.map(msg => JSON.stringify(msg)));
            }
            pipeline.expire(key, this.expirySeconds);
            await pipeline.exec();
            console.log(`💾 Room ${roomId} chat log saved to Redis`);
            return true;
        }
        catch (error) {
            console.error(`Failed to save chat log for room ${roomId}:`, error);
            this.connected = false;
            return false;
        }
    }
    async appendChatMessage(roomId, message) {
        try {
            if (!this.isConnected()) {
                try {
                    await this.connect();
                }
                catch (reconnectError) {
                    console.warn('Redis not connected and reconnection failed, cannot append chat message');
                    return false;
                }
            }
            const key = this.chatKey(roomId);
            const pipeline = this.client.multi();
            pipeline.rPush(key, JSON.stringify(message));
            pipeline.lTrim(key, -100, -1);
            pipeline.expire(key, this.expirySeconds);
            await pipeline.exec();
            return true;
        }
        catch (error) {
            console.error(`Failed to append chat message for room ${roomId}:`, error);
            this.connected = false;
            return false;
        }
    }
    async getChatMessages(roomId) {
        try {
            if (!this.isConnected()) {
                try {
                    await this.connect();
                }
                catch (reconnectError) {
                    console.warn('Redis not connected and reconnection failed, cannot get chat messages');
                    return [];
                }
            }
            const key = this.chatKey(roomId);
            const messages = await this.client.lRange(key, 0, -1);
            return messages.map(msg => JSON.parse(msg));
        }
        catch (error) {
            console.error(`Failed to get chat messages for room ${roomId}:`, error);
            this.connected = false;
            return [];
        }
    }
    async getRoom(roomId) {
        const metadata = await this.getRoomMetadata(roomId);
        if (!metadata) {
            return null;
        }
        const [players, gameState, chatMessages] = await Promise.all([
            this.getPlayers(roomId),
            this.getGameState(roomId),
            this.getChatMessages(roomId)
        ]);
        return {
            metadata,
            players,
            gameState,
            chatMessages
        };
    }
    async saveRoom(roomId, room) {
        try {
            const metadata = {
                id: room.id,
                maxPlayers: room.maxPlayers,
                isStarted: room.isStarted,
                createdAt: room.createdAt,
                lastActivity: room.lastActivity
            };
            const operations = [
                this.saveRoomMetadata(roomId, metadata),
                this.savePlayers(roomId, room.players),
                room.gameState ? this.saveGameState(roomId, room.gameState) : this.clearGameState(roomId),
                this.setChatMessages(roomId, room.chatMessages)
            ];
            const results = await Promise.all(operations);
            return results.every(result => result !== false);
        }
        catch (error) {
            console.error(`Failed to save legacy room ${roomId}:`, error);
            return false;
        }
    }
    async deleteRoom(roomId) {
        try {
            if (!this.isConnected()) {
                console.warn('Redis not connected, cannot delete room');
                return false;
            }
            const deletedCounts = await Promise.all([
                this.client.del(this.metadataKey(roomId)),
                this.client.del(this.playersKey(roomId)),
                this.client.del(this.gameStateKey(roomId)),
                this.client.del(this.chatKey(roomId))
            ]);
            const deleted = deletedCounts.reduce((sum, count) => sum + count, 0);
            await this.client.sRem('active_rooms', roomId);
            if (deleted > 0) {
                console.log(`🗑️ Room ${roomId} deleted from Redis`);
                return true;
            }
            return false;
        }
        catch (error) {
            console.error(`Failed to delete room ${roomId}:`, error);
            return false;
        }
    }
    async getAllActiveRooms() {
        try {
            if (!this.isConnected()) {
                return [];
            }
            const roomIds = await this.client.sMembers('active_rooms');
            return roomIds;
        }
        catch (error) {
            console.error('Failed to get active rooms:', error);
            return [];
        }
    }
    async updateRoomActivity(roomId) {
        try {
            if (!this.isConnected()) {
                return false;
            }
            const metadata = await this.getRoomMetadata(roomId);
            if (metadata) {
                metadata.lastActivity = Date.now();
                return await this.saveRoomMetadata(roomId, metadata);
            }
            return false;
        }
        catch (error) {
            console.error(`Failed to update room activity ${roomId}:`, error);
            return false;
        }
    }
    async cleanupExpiredRooms() {
        try {
            if (!this.isConnected()) {
                return 0;
            }
            const activeRoomIds = await this.getAllActiveRooms();
            let cleanedCount = 0;
            const now = Date.now();
            const TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours
            for (const roomId of activeRoomIds) {
                const metadata = await this.getRoomMetadata(roomId);
                if (metadata && (now - metadata.lastActivity) > TIMEOUT) {
                    await this.deleteRoom(roomId);
                    cleanedCount++;
                    console.log(`🧹 Cleaned up expired room: ${roomId}`);
                }
            }
            return cleanedCount;
        }
        catch (error) {
            console.error('Failed to cleanup expired rooms:', error);
            return 0;
        }
    }
    async healthCheck() {
        try {
            if (!this.isConnected()) {
                return { connected: false, roomCount: 0, error: 'Not connected to Redis' };
            }
            const roomCount = await this.client.sCard('active_rooms');
            return { connected: true, roomCount };
        }
        catch (error) {
            return {
                connected: false,
                roomCount: 0,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
}
exports.RedisService = RedisService;
