import { WebSocketMessage, ClientGameState, ChatMessage, GameAction } from '../types/game';

export type GameClientEventType =
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'room_created'
  | 'room_joined'
  | 'player_joined'
  | 'player_left'
  | 'game_state_update'
  | 'chat_message'
  | 'game_error'
  | 'error';

export interface GameClientEvent {
  type: GameClientEventType;
  data?: any;
  error?: string;
  roomId?: string;
  playerId?: string;
  players?: Array<{id: string, name: string}>;
  gameState?: ClientGameState;
  chatMessages?: ChatMessage[];
  message?: ChatMessage;
  player?: {id: string, name: string};
  attempt?: number;
  nextDelayMs?: number;
}

export class GameClient {
  private ws: WebSocket | null = null;
  private eventHandlers: { [key in GameClientEventType]: ((event: GameClientEvent) => void)[] } = {
    connected: [],
    disconnected: [],
    reconnecting: [],
    room_created: [],
    room_joined: [],
    player_joined: [],
    player_left: [],
    game_state_update: [],
    chat_message: [],
    game_error: [],
    error: []
  };

  private serverUrl: string;
  private reconnectAttempts = 0;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private pingInterval: NodeJS.Timeout | null = null;
  private httpHeartbeatInterval: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shouldReconnect = true;
  private readonly httpHeartbeatIntervalMs = 2 * 60 * 1000; // 2 minutes
  private readonly pingIntervalMs = 3 * 60 * 1000; // 3 minutes

  // Connection state for automatic rejoining
  private currentRoomId: string | null = null;
  private currentPlayerId: string | null = null;
  private currentPlayerName: string | null = null;

  // Track auto-rejoin process to avoid premature session clearing
  private isAutoRejoining: boolean = false;

  // localStorage keys
  private readonly STORAGE_KEY = 'the-game-session';

  private pendingJoinRequest: { roomId: string; playerId: string; playerName: string } | null = null;

  constructor(serverUrl: string = 'wss://the-game-kr4u.onrender.com') {
    this.serverUrl = serverUrl;
    // Restore session state from localStorage on initialization
    this.loadSessionState();
  }

  private saveSessionState(): void {
    if (this.currentRoomId && this.currentPlayerId && this.currentPlayerName) {
      const sessionState = {
        roomId: this.currentRoomId,
        playerId: this.currentPlayerId,
        playerName: this.currentPlayerName,
        timestamp: Date.now()
      };
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(sessionState));
      } catch (error) {
        console.warn('Failed to save session state:', error);
      }
    }
  }

  private loadSessionState(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const sessionState = JSON.parse(stored);
        // Check if session is not too old (expire after 24 hours)
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        if (Date.now() - sessionState.timestamp < maxAge) {
          this.currentRoomId = sessionState.roomId;
          this.currentPlayerId = sessionState.playerId;
          this.currentPlayerName = sessionState.playerName;
          console.log('Restored session state from localStorage');
        } else {
          console.log('Session state expired, clearing');
          this.clearSessionState();
        }
      }
    } catch (error) {
      console.warn('Failed to load session state:', error);
      this.clearSessionState();
    }
  }

  private clearSessionState(): void {
    this.currentRoomId = null;
    this.currentPlayerId = null;
    this.currentPlayerName = null;
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch (error) {
      console.warn('Failed to clear session state:', error);
    }
  }

  connect(): void {
    try {
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return;
      }

      this.shouldReconnect = true;
      this.ws = new WebSocket(this.serverUrl);

      this.ws.onopen = () => {
        console.log('Connected to game server');
        this.reconnectAttempts = 0;
        this.clearReconnectTimer();
        this.startPingInterval();
        this.startHttpHeartbeat();
        this.emit('connected', { type: 'connected' });

        // Auto-rejoin room if we were in one before disconnection
        if (this.pendingJoinRequest) {
          this.flushPendingJoinRequest();
        } else if (this.currentRoomId && this.currentPlayerId && this.currentPlayerName) {
          console.log(`Auto-rejoining room ${this.currentRoomId} as ${this.currentPlayerName}`);
          this.isAutoRejoining = true;
          this.queueJoinRequest(this.currentRoomId!, this.currentPlayerId!, this.currentPlayerName!);
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('Error parsing message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('Disconnected from game server');
        this.stopPingInterval();
        this.stopHttpHeartbeat();
        this.emit('disconnected', { type: 'disconnected' });
        this.ws = null;
        this.attemptReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.emit('error', { type: 'error', error: 'Connection error' });
      };
    } catch (error) {
      console.error('Failed to connect:', error);
      this.emit('error', { type: 'error', error: 'Failed to connect to server' });
    }
  }

  disconnect(): void {
    this.stopPingInterval();
    this.stopHttpHeartbeat();
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.pendingJoinRequest = null;
    this.isAutoRejoining = false;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private startPingInterval(): void {
    // Send ping every few minutes to keep connection alive
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.send({ type: 'ping' } as any);
        } catch (error) {
          console.warn('Failed to send ping:', error);
        }
      }
    }, this.pingIntervalMs);
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private startHttpHeartbeat(): void {
    this.stopHttpHeartbeat();
    const baseUrl = this.getHttpBaseUrl();

    this.httpHeartbeatInterval = setInterval(() => {
      fetch(`${baseUrl}/health`, { cache: 'no-store', keepalive: true })
        .catch(error => {
          console.warn('HTTP heartbeat failed:', error);
        });
    }, this.httpHeartbeatIntervalMs);
  }

  private stopHttpHeartbeat(): void {
    if (this.httpHeartbeatInterval) {
      clearInterval(this.httpHeartbeatInterval);
      this.httpHeartbeatInterval = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private attemptReconnect(): void {
    if (!this.shouldReconnect) {
      return;
    }

    this.reconnectAttempts++;
    const backoffDelay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    console.log(`Attempting to reconnect in ${backoffDelay}ms (attempt ${this.reconnectAttempts})`);

    this.emit('reconnecting', {
      type: 'reconnecting',
      attempt: this.reconnectAttempts,
      nextDelayMs: backoffDelay
    });

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      if (!this.shouldReconnect) {
        return;
      }
      try {
        this.connect();
      } catch (error) {
        console.error('Reconnection attempt failed:', error);
        this.attemptReconnect();
      }
    }, backoffDelay);
  }

  private queueJoinRequest(roomId: string, playerId: string, playerName: string): void {
    this.pendingJoinRequest = { roomId, playerId, playerName };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.flushPendingJoinRequest();
    } else {
      console.warn('WebSocket not ready, join request queued until connection is open');
    }
  }

  private flushPendingJoinRequest(): void {
    if (!this.pendingJoinRequest) {
      return;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const { roomId, playerId, playerName } = this.pendingJoinRequest;

    try {
      this.send({
        type: 'join_room',
        roomId,
        playerId,
        playerName
      });
      this.pendingJoinRequest = null;
    } catch (error) {
      console.error('Failed to flush pending join request:', error);
    }
  }

  private handleMessage(message: any): void {
    switch (message.type) {
      case 'room_created':
        // Store room state for auto-rejoin and persistence
        this.currentRoomId = message.roomId;
        this.currentPlayerId = message.playerId;
        this.saveSessionState();
        this.emit('room_created', {
          type: 'room_created',
          roomId: message.roomId,
          playerId: message.playerId,
          players: message.players
        });
        break;

      case 'room_joined':
        // Store room state for auto-rejoin and persistence
        this.currentRoomId = message.roomId;
        this.currentPlayerId = message.playerId;
        this.saveSessionState();

        // Clear auto-rejoin flag on successful join
        if (this.isAutoRejoining) {
          console.log('Auto-rejoin successful');
          this.isAutoRejoining = false;
        }

        this.pendingJoinRequest = null;

        this.emit('room_joined', {
          type: 'room_joined',
          roomId: message.roomId,
          playerId: message.playerId,
          players: message.players
        });
        break;

      case 'player_joined':
        this.emit('player_joined', {
          type: 'player_joined',
          player: message.player
        });
        break;

      case 'player_left':
        this.emit('player_left', {
          type: 'player_left',
          playerId: message.playerId
        });
        break;

      case 'game_state_update':
        this.emit('game_state_update', {
          type: 'game_state_update',
          gameState: message.gameState,
          chatMessages: message.chatMessages
        });
        break;

      case 'chat_message':
        this.emit('chat_message', {
          type: 'chat_message',
          message: message.message
        });
        break;

      case 'game_error':
        this.emit('game_error', {
          type: 'game_error',
          error: message.error
        });
        break;

      case 'error':
        this.emit('error', {
          type: 'error',
          error: message.error
        });
        break;

      case 'pong':
        // Pong response to ping - just ignore it, connection is alive
        break;

      default:
        console.warn('Unknown message type:', message.type);
    }
  }

  private emit(eventType: GameClientEventType, event: GameClientEvent): void {
    this.eventHandlers[eventType].forEach(handler => handler(event));
  }

  on(eventType: GameClientEventType, handler: (event: GameClientEvent) => void): void {
    this.eventHandlers[eventType].push(handler);
  }

  off(eventType: GameClientEventType, handler: (event: GameClientEvent) => void): void {
    const handlers = this.eventHandlers[eventType];
    const index = handlers.indexOf(handler);
    if (index > -1) {
      handlers.splice(index, 1);
    }
  }

  private send(message: WebSocketMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('Failed to send message:', error);
        this.emit('error', { type: 'error', error: 'Failed to send message to server' });
      }
    } else {
      console.warn('WebSocket not connected, message queued for after reconnection');
      // For non-critical messages like ping, just ignore
      if (message.type !== 'ping') {
        this.emit('error', { type: 'error', error: 'Not connected to server' });
      }
    }
  }

  createRoom(playerName: string): void {
    const playerId = this.generatePlayerId();
    // Store player name for auto-rejoin
    this.currentPlayerName = playerName;
    this.send({
      type: 'create_room',
      playerId,
      playerName
    });
  }

  joinRoom(roomId: string, playerName: string): void {
    // For auto-rejoin, use existing playerId if available
    const playerId = this.currentPlayerId || this.generatePlayerId();
    // Store player name for auto-rejoin
    this.currentPlayerName = playerName;
    this.queueJoinRequest(roomId, playerId, playerName);
  }

  leaveRoom(): void {
    // Clear stored room state when leaving
    this.currentRoomId = null;
    this.currentPlayerId = null;
    this.currentPlayerName = null;
    this.pendingJoinRequest = null;
    this.isAutoRejoining = false;
    this.clearSessionState();
    this.send({
      type: 'leave_room'
    });
  }

  playCard(cardId: string, pileId: string): void {
    const action: GameAction = {
      type: 'play_card',
      playerId: '', // Server will fill this
      cardId,
      pileId,
      timestamp: Date.now()
    };

    this.send({
      type: 'game_action',
      action
    });
  }

  endTurn(): void {
    const action: GameAction = {
      type: 'end_turn',
      playerId: '', // Server will fill this
      timestamp: Date.now()
    };

    this.send({
      type: 'game_action',
      action
    });
  }

  undoMove(): void {
    const action: GameAction = {
      type: 'undo_move',
      playerId: '', // Server will fill this
      timestamp: Date.now()
    };

    this.send({
      type: 'game_action',
      action
    });
  }

  sendChatMessage(message: string, isHint: boolean = false): void {
    const chatMessage: Partial<ChatMessage> = {
      message,
      isHint,
      timestamp: Date.now()
    };

    this.send({
      type: 'chat_message',
      message: chatMessage as ChatMessage
    });
  }

  async startGame(roomId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.getHttpBaseUrl()}/api/room/${roomId}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const result = await response.json();
      return result.success;
    } catch (error) {
      console.error('Failed to start game:', error);
      return false;
    }
  }

  async startGameWithPlayer(roomId: string, startingPlayerId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.getHttpBaseUrl()}/api/room/${roomId}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ startingPlayerId })
      });

      const result = await response.json();
      return result.success;
    } catch (error) {
      console.error('Failed to start game with specific player:', error);
      return false;
    }
  }

  selectStartingPlayer(startingPlayerId: string): void {
    this.send({
      type: 'select_starting_player',
      startingPlayerId
    });
  }

  private generatePlayerId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  private getHttpBaseUrl(): string {
    if (this.serverUrl.startsWith('wss://')) {
      return this.serverUrl.replace('wss://', 'https://');
    }

    if (this.serverUrl.startsWith('ws://')) {
      return this.serverUrl.replace('ws://', 'http://');
    }

    return this.serverUrl;
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // Public methods to access persisted session state
  hasPersistedSession(): boolean {
    return !!(this.currentRoomId && this.currentPlayerId && this.currentPlayerName);
  }

  getPersistedSession(): { roomId: string; playerId: string; playerName: string } | null {
    if (this.hasPersistedSession()) {
      return {
        roomId: this.currentRoomId!,
        playerId: this.currentPlayerId!,
        playerName: this.currentPlayerName!
      };
    }
    return null;
  }

  // Method to manually clear session (useful for "New Game" functionality)
  clearSession(): void {
    this.clearSessionState();
  }

  // Check if currently in auto-rejoin process
  isAutoRejoinInProgress(): boolean {
    return this.isAutoRejoining;
  }
}