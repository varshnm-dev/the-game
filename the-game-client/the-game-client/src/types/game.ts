export interface Card {
  id: string;
  value: number;
}

export interface Pile {
  id: string;
  type: 'ascending' | 'descending';
  startValue: number;
  currentValue: number;
  cards: Card[];
}

export interface ServerPlayer {
  id: string;
  name: string;
  hand: Card[];
  isCurrentPlayer: boolean;
  connectionId: string;
  isConnected: boolean;
}

export interface PublicPlayer {
  id: string;
  name: string;
  handCount: number;
  isCurrentPlayer: boolean;
  isConnected: boolean;
}

export interface ServerGameState {
  id: string;
  status: 'waiting' | 'cards_dealt' | 'playing' | 'won' | 'lost';
  players: ServerPlayer[];
  currentPlayerId: string;
  piles: Pile[];
  deck: Card[];
  cardsPlayed: number;
  minCardsToPlay: number;
  isDeckEmpty: boolean;
  moveHistory: ServerGameState[];
  canUndo: boolean;
  maxPlayers: number;
  createdAt: number;
  lastActivity: number;
}

export interface ClientGameState {
  id: string;
  status: 'waiting' | 'cards_dealt' | 'playing' | 'won' | 'lost';
  players: PublicPlayer[];
  currentPlayerId: string;
  piles: Pile[];
  deckCount: number;
  cardsPlayed: number;
  minCardsToPlay: number;
  isDeckEmpty: boolean;
  canUndo: boolean;
  maxPlayers: number;
  yourHand: Card[];
  yourId: string;
}

export interface GameAction {
  type: 'play_card' | 'end_turn' | 'undo_move' | 'send_message';
  playerId: string;
  cardId?: string;
  pileId?: string;
  message?: string;
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  message: string;
  timestamp: number;
  isHint: boolean;
}

export interface WebSocketMessage {
  type: 'join_room' | 'create_room' | 'game_action' | 'chat_message' | 'leave_room' | 'select_starting_player';
  roomId?: string;
  playerId?: string;
  playerName?: string;
  action?: GameAction;
  message?: ChatMessage;
  startingPlayerId?: string;
  data?: any;
}