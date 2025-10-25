import { createClient, RedisClientType } from 'redis';
import { ServerGameState } from '../types/game';

export interface StoredRoom {
  id: string;
  gameState: ServerGameState | null;
  players: Array<{ id: string; name: string }>;
  chatMessages: any[];
  maxPlayers: number;
  isStarted: boolean;
  createdAt: number;
  lastActivity: number;
}

export interface RedisServiceLike {
  connect(): Promise<void>;
  saveRoom(roomId: string, room: StoredRoom): Promise<boolean>;
  getRoom(roomId: string): Promise<StoredRoom | null>;
  cleanupExpiredRooms(): Promise<number>;
  healthCheck(): Promise<{ connected: boolean; roomCount: number; error?: string }>;
}

export class RedisService {
  private client: RedisClientType;
  private connected: boolean = false;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error('REDIS_URL environment variable is required');
    }

    this.client = createClient({
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

  async connect(): Promise<void> {
    try {
      await this.client.connect();
      console.log('🔑 Redis connection established');
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      console.warn('⚠️ Server will continue without Redis persistence');
      // Don't throw error - allow server to start without Redis
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.disconnect();
      console.log('🔌 Redis connection closed');
    } catch (error) {
      console.error('Error disconnecting from Redis:', error);
    }
  }

  isConnected(): boolean {
    return this.connected && this.client.isReady;
  }

  // Room storage methods
  async saveRoom(roomId: string, room: StoredRoom): Promise<boolean> {
    try {
      if (!this.isConnected()) {
        // Attempt to reconnect if not connected
        try {
          await this.connect();
        } catch (reconnectError) {
          console.warn('Redis not connected and reconnection failed, cannot save room');
          return false;
        }
      }

      const roomKey = `room:${roomId}`;
      const roomData = JSON.stringify(room);

      // Set room with 4 hour expiration (longer than the 2 hour cleanup)
      await this.client.setEx(roomKey, 4 * 60 * 60, roomData);

      // Also add to active rooms set for easier listing
      await this.client.sAdd('active_rooms', roomId);

      console.log(`💾 Room ${roomId} saved to Redis`);
      return true;
    } catch (error) {
      console.error(`Failed to save room ${roomId}:`, error);
      this.connected = false; // Mark as disconnected on error
      return false;
    }
  }

  async getRoom(roomId: string): Promise<StoredRoom | null> {
    try {
      if (!this.isConnected()) {
        // Attempt to reconnect if not connected
        try {
          await this.connect();
        } catch (reconnectError) {
          console.warn('Redis not connected and reconnection failed, cannot get room');
          return null;
        }
      }

      const roomKey = `room:${roomId}`;
      const roomData = await this.client.get(roomKey);

      if (!roomData) {
        console.log(`🔍 Room ${roomId} not found in Redis`);
        return null;
      }

      const room = JSON.parse(roomData) as StoredRoom;
      console.log(`📥 Room ${roomId} loaded from Redis`);
      return room;
    } catch (error) {
      console.error(`Failed to get room ${roomId}:`, error);
      this.connected = false; // Mark as disconnected on error
      return null;
    }
  }

  async deleteRoom(roomId: string): Promise<boolean> {
    try {
      if (!this.isConnected()) {
        console.warn('Redis not connected, cannot delete room');
        return false;
      }

      const roomKey = `room:${roomId}`;
      const deleted = await this.client.del(roomKey);
      await this.client.sRem('active_rooms', roomId);

      if (deleted > 0) {
        console.log(`🗑️ Room ${roomId} deleted from Redis`);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Failed to delete room ${roomId}:`, error);
      return false;
    }
  }

  async getAllActiveRooms(): Promise<string[]> {
    try {
      if (!this.isConnected()) {
        return [];
      }

      const roomIds = await this.client.sMembers('active_rooms');
      return roomIds;
    } catch (error) {
      console.error('Failed to get active rooms:', error);
      return [];
    }
  }

  async updateRoomActivity(roomId: string): Promise<boolean> {
    try {
      if (!this.isConnected()) {
        return false;
      }

      const room = await this.getRoom(roomId);
      if (room) {
        room.lastActivity = Date.now();
        return await this.saveRoom(roomId, room);
      }
      return false;
    } catch (error) {
      console.error(`Failed to update room activity ${roomId}:`, error);
      return false;
    }
  }

  async cleanupExpiredRooms(): Promise<number> {
    try {
      if (!this.isConnected()) {
        return 0;
      }

      const activeRoomIds = await this.getAllActiveRooms();
      let cleanedCount = 0;
      const now = Date.now();
      const TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours

      for (const roomId of activeRoomIds) {
        const room = await this.getRoom(roomId);
        if (room && (now - room.lastActivity) > TIMEOUT) {
          await this.deleteRoom(roomId);
          cleanedCount++;
          console.log(`🧹 Cleaned up expired room: ${roomId}`);
        }
      }

      return cleanedCount;
    } catch (error) {
      console.error('Failed to cleanup expired rooms:', error);
      return 0;
    }
  }

  // Health check
  async healthCheck(): Promise<{ connected: boolean; roomCount: number; error?: string }> {
    try {
      if (!this.isConnected()) {
        return { connected: false, roomCount: 0, error: 'Not connected to Redis' };
      }

      const roomCount = await this.client.sCard('active_rooms');
      return { connected: true, roomCount };
    } catch (error) {
      return {
        connected: false,
        roomCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}