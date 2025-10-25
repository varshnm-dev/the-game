const assert = require('assert');
const WebSocket = require('ws');

const serverModule = require('../dist/server');
const GameServer = serverModule.default || serverModule;

class MockRedisService {
  constructor() {
    this.rooms = new Map();
  }

  async connect() {}

  async saveRoom(roomId, room) {
    this.rooms.set(roomId, JSON.parse(JSON.stringify(room)));
    return true;
  }

  async getRoom(roomId) {
    const room = this.rooms.get(roomId);
    return room ? JSON.parse(JSON.stringify(room)) : null;
  }

  async cleanupExpiredRooms() {
    return 0;
  }

  async healthCheck() {
    return { connected: true, roomCount: this.rooms.size };
  }
}

class MockSocket {
  constructor() {
    this.readyState = WebSocket.OPEN;
    this.sent = [];
  }

  send(data) {
    this.sent.push(data);
  }
}

async function testRoomRestorationReconnection() {
  const redis = new MockRedisService();
  const server = new GameServer({ redisService: redis, enableCleanupTimer: false, autoConnectRedis: false });

  const now = Date.now();
  const storedRoom = {
    id: 'ROOM1',
    gameState: {
      id: 'ROOM1',
      status: 'playing',
      players: [
        {
          id: 'p1',
          name: 'Alice',
          hand: [],
          isCurrentPlayer: true,
          connectionId: 'p1',
          isConnected: false
        },
        {
          id: 'p2',
          name: 'Bob',
          hand: [],
          isCurrentPlayer: false,
          connectionId: 'p2',
          isConnected: false
        }
      ],
      currentPlayerId: 'p1',
      piles: [],
      deck: [],
      cardsPlayed: 0,
      minCardsToPlay: 2,
      isDeckEmpty: false,
      moveHistory: [],
      canUndo: false,
      maxPlayers: 5,
      createdAt: now,
      lastActivity: now
    },
    players: [
      { id: 'p1', name: 'Alice' },
      { id: 'p2', name: 'Bob' }
    ],
    chatMessages: [],
    maxPlayers: 5,
    isStarted: true,
    createdAt: now,
    lastActivity: now
  };

  await redis.saveRoom(storedRoom.id, storedRoom);

  const rejoiningSocket = new MockSocket();
  const joinMessage = {
    type: 'join_room',
    roomId: storedRoom.id,
    playerId: 'p1',
    playerName: 'Alice'
  };

  await server.handleJoinRoom(rejoiningSocket, joinMessage);

  const room = server.rooms.get(storedRoom.id);
  assert(room, 'room should be restored into memory');

  assert.strictEqual(room.connections.size, 1, 'only the rejoining player should be connected');
  assert.strictEqual(room.connections.get('p1'), rejoiningSocket, 'rejoining socket should be registered');
  assert.strictEqual(room.players.size, 2, 'player metadata should be preserved for offline players');
  assert(room.players.has('p2'), 'offline player metadata should persist after restore');
  assert(!room.connections.has('p2'), 'offline players should not have placeholder connections');

  const storedAfter = await redis.getRoom(storedRoom.id);
  assert(storedAfter, 'room should still be persisted');
  assert.strictEqual(storedAfter.players.length, 2, 'persisted room should keep all player metadata');

  const closedSocket = new MockSocket();
  closedSocket.readyState = WebSocket.CLOSED;
  room.connections.set('p2', closedSocket);
  const beforeBroadcastCount = rejoiningSocket.sent.length;
  server.broadcastToRoom(storedRoom.id, { type: 'test_message' });
  const afterBroadcastCount = rejoiningSocket.sent.length;
  assert.strictEqual(afterBroadcastCount, beforeBroadcastCount + 1, 'connected players should receive broadcast');
  assert.strictEqual(closedSocket.sent.length, 0, 'closed sockets should not receive broadcast');
  assert(!room.connections.has('p2'), 'closed sockets should be pruned from the connection map');

  server.wss.close();
  server.server.close();
}

(async () => {
  try {
    await testRoomRestorationReconnection();
    console.log('✅ room restoration reconnection test passed');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
})();
