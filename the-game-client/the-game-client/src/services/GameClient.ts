import { WebSocketMessage, ClientGameState, ChatMessage, GameAction } from '../types/game';

export type GameClientEventType =
  | 'connected'
  | 'disconnected'
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
}

export class GameClient {
  private ws: WebSocket | null = null;
  private eventHandlers: { [key in GameClientEventType]: ((event: GameClientEvent) => void)[] } = {
    connected: [],
    disconnected: [],
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
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(serverUrl: string = 'wss://the-game-kr4u.onrender.com') {
    this.serverUrl = serverUrl;
  }

  connect(): void {
    try {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.onopen = () => {
        console.log('Connected to game server');
        this.reconnectAttempts = 0;
        this.startPingInterval();
        this.emit('connected', { type: 'connected' });
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
        this.emit('disconnected', { type: 'disconnected' });
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
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private startPingInterval(): void {
    // Send ping every 5 minutes to keep connection alive
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping' } as any);
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        console.log(`Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        this.connect();
      }, this.reconnectDelay * this.reconnectAttempts);
    }
  }

  private handleMessage(message: any): void {
    switch (message.type) {
      case 'room_created':
        this.emit('room_created', {
          type: 'room_created',
          roomId: message.roomId,
          playerId: message.playerId,
          players: message.players
        });
        break;

      case 'room_joined':
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
      this.ws.send(JSON.stringify(message));
    } else {
      console.error('WebSocket not connected');
      this.emit('error', { type: 'error', error: 'Not connected to server' });
    }
  }

  createRoom(playerName: string): void {
    const playerId = this.generatePlayerId();
    this.send({
      type: 'create_room',
      playerId,
      playerName
    });
  }

  joinRoom(roomId: string, playerName: string): void {
    const playerId = this.generatePlayerId();
    this.send({
      type: 'join_room',
      roomId,
      playerId,
      playerName
    });
  }

  leaveRoom(): void {
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
      const response = await fetch(`${this.serverUrl.replace('wss://', 'https://').replace('ws://', 'http://')}/api/room/${roomId}/start`, {
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
      const response = await fetch(`${this.serverUrl.replace('wss://', 'https://').replace('ws://', 'http://')}/api/room/${roomId}/start`, {
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

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}