import { Card, Pile, ServerPlayer, ServerGameState, ClientGameState, PublicPlayer } from '../types/game';
import { v4 as uuidv4 } from 'uuid';

export class GameEngine {
  static createDeck(): Card[] {
    const deck: Card[] = [];
    for (let i = 2; i <= 99; i++) {
      deck.push({
        id: uuidv4(),
        value: i
      });
    }
    return this.shuffleDeck(deck);
  }

  static shuffleDeck(deck: Card[]): Card[] {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  static createInitialPiles(): Pile[] {
    return [
      { id: 'ascending-1', type: 'ascending', startValue: 1, currentValue: 1, cards: [] },
      { id: 'ascending-2', type: 'ascending', startValue: 1, currentValue: 1, cards: [] },
      { id: 'descending-1', type: 'descending', startValue: 100, currentValue: 100, cards: [] },
      { id: 'descending-2', type: 'descending', startValue: 100, currentValue: 100, cards: [] }
    ];
  }

  static getStartingHandSize(playerCount: number): number {
    if (playerCount === 1) return 8;
    if (playerCount === 2) return 7;
    return 6;
  }

  static initializeGame(roomId: string, playerData: {id: string, name: string, connectionId: string}[]): ServerGameState {
    if (playerData.length < 1 || playerData.length > 5) {
      throw new Error('Invalid number of players');
    }

    const deck = this.createDeck();
    const piles = this.createInitialPiles();
    const handSize = this.getStartingHandSize(playerData.length);
    
    const players: ServerPlayer[] = playerData.map((data, index) => {
      const hand: Card[] = [];
      for (let i = 0; i < handSize; i++) {
        const card = deck.pop();
        if (card) hand.push(card);
      }

      return {
        id: data.id,
        name: data.name,
        connectionId: data.connectionId,
        hand: hand.sort((a, b) => a.value - b.value),
        isCurrentPlayer: false, // Will be set below
        isConnected: true
      };
    });

    // Determine starting player based on best opening moves
    const startingPlayerIndex = this.determineStartingPlayer(players, piles);
    players[startingPlayerIndex].isCurrentPlayer = true;

    return {
      id: roomId,
      status: 'playing',
      players,
      currentPlayerId: players[startingPlayerIndex].id,
      piles,
      deck,
      cardsPlayed: 0,
      minCardsToPlay: 2,
      isDeckEmpty: false,
      moveHistory: [],
      canUndo: false,
      maxPlayers: 5,
      createdAt: Date.now(),
      lastActivity: Date.now()
    };
  }

  static canPlayCard(card: Card, pile: Pile): boolean {
    if (pile.type === 'ascending') {
      return card.value > pile.currentValue || card.value === pile.currentValue - 10;
    } else {
      return card.value < pile.currentValue || card.value === pile.currentValue + 10;
    }
  }

  static playCard(gameState: ServerGameState, playerId: string, cardId: string, pileId: string): ServerGameState {
    const newState = this.saveStateToHistory(gameState);
    const player = newState.players.find(p => p.id === playerId);
    const pile = newState.piles.find(p => p.id === pileId);
    
    if (!player || !pile) throw new Error('Invalid player or pile');
    if (playerId !== newState.currentPlayerId) throw new Error('Not your turn');

    const cardIndex = player.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) throw new Error('Card not in hand');

    const card = player.hand[cardIndex];
    if (!this.canPlayCard(card, pile)) throw new Error('Invalid move');

    player.hand.splice(cardIndex, 1);
    pile.cards.push(card);
    pile.currentValue = card.value;
    newState.cardsPlayed++;
    newState.lastActivity = Date.now();

    if (newState.deck.length === 0 && !newState.isDeckEmpty) {
      newState.isDeckEmpty = true;
      newState.minCardsToPlay = 1;
    }

    return newState;
  }

  static endTurn(gameState: ServerGameState): ServerGameState {
    if (gameState.cardsPlayed < gameState.minCardsToPlay) {
      throw new Error('Must play minimum cards');
    }

    const newState = JSON.parse(JSON.stringify(gameState)) as ServerGameState;
    const currentPlayerIndex = newState.players.findIndex(p => p.id === newState.currentPlayerId);
    const currentPlayer = newState.players[currentPlayerIndex];

    // Draw cards
    if (!newState.isDeckEmpty && newState.deck.length > 0) {
      const targetHandSize = this.getStartingHandSize(newState.players.length);
      while (currentPlayer.hand.length < targetHandSize && newState.deck.length > 0) {
        const card = newState.deck.pop();
        if (card) currentPlayer.hand.push(card);
      }
      currentPlayer.hand.sort((a, b) => a.value - b.value);
    }

    // Next player
    const nextPlayerIndex = (currentPlayerIndex + 1) % newState.players.length;
    newState.players[currentPlayerIndex].isCurrentPlayer = false;
    newState.players[nextPlayerIndex].isCurrentPlayer = true;
    newState.currentPlayerId = newState.players[nextPlayerIndex].id;
    newState.cardsPlayed = 0;
    newState.lastActivity = Date.now();

    // Check game status
    newState.status = this.checkGameStatus(newState);
    newState.canUndo = false; // Can't undo across turns

    return newState;
  }

  static saveStateToHistory(gameState: ServerGameState): ServerGameState {
    const stateToSave = JSON.parse(JSON.stringify(gameState)) as ServerGameState;
    stateToSave.moveHistory = [];
    stateToSave.canUndo = false;
    
    const newState = JSON.parse(JSON.stringify(gameState)) as ServerGameState;
    newState.moveHistory = [...gameState.moveHistory, stateToSave];
    
    if (newState.moveHistory.length > 10) {
      newState.moveHistory = newState.moveHistory.slice(-10);
    }
    
    newState.canUndo = true;
    return newState;
  }

  static undoLastMove(gameState: ServerGameState): ServerGameState {
    if (!gameState.canUndo || gameState.moveHistory.length === 0) {
      throw new Error('Cannot undo');
    }

    const previousState = gameState.moveHistory[gameState.moveHistory.length - 1];
    const restoredState = JSON.parse(JSON.stringify(previousState)) as ServerGameState;
    
    restoredState.moveHistory = gameState.moveHistory.slice(0, -1);
    restoredState.canUndo = restoredState.moveHistory.length > 0;
    restoredState.lastActivity = Date.now();
    
    return restoredState;
  }

  static checkGameStatus(gameState: ServerGameState): 'playing' | 'won' | 'lost' {
    const totalCardsInHands = gameState.players.reduce((sum, player) => sum + player.hand.length, 0);
    if (totalCardsInHands === 0 && gameState.deck.length === 0) {
      return 'won';
    }

    const currentPlayer = gameState.players.find(p => p.id === gameState.currentPlayerId);
    if (currentPlayer && !this.hasValidMoves(currentPlayer, gameState.piles)) {
      return 'lost';
    }

    return 'playing';
  }

  static hasValidMoves(player: ServerPlayer, piles: Pile[]): boolean {
    return player.hand.some(card => piles.some(pile => this.canPlayCard(card, pile)));
  }

  static determineStartingPlayer(players: ServerPlayer[], piles: Pile[]): number {
    let bestPlayerIndex = 0;
    let bestScore = -1;

    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      let score = 0;

      // Count how many cards can be played immediately
      for (const card of player.hand) {
        for (const pile of piles) {
          if (this.canPlayCard(card, pile)) {
            score++;
          }
        }
      }

      // Bonus points for having extreme values (2, 3, 98, 99) which are great starting cards
      const extremeCards = player.hand.filter(card =>
        card.value <= 3 || card.value >= 98
      ).length;
      score += extremeCards * 2;

      // Bonus for having cards that can start chains (near pile starting values)
      const chainStarters = player.hand.filter(card =>
        card.value <= 10 || card.value >= 90
      ).length;
      score += chainStarters;

      if (score > bestScore) {
        bestScore = score;
        bestPlayerIndex = i;
      }
    }

    return bestPlayerIndex;
  }

  static createClientGameState(serverState: ServerGameState, playerId: string): ClientGameState {
    const player = serverState.players.find(p => p.id === playerId);
    
    return {
      id: serverState.id,
      status: serverState.status,
      players: serverState.players.map(p => ({
        id: p.id,
        name: p.name,
        handCount: p.hand.length,
        isCurrentPlayer: p.isCurrentPlayer,
        isConnected: p.isConnected
      })),
      currentPlayerId: serverState.currentPlayerId,
      piles: serverState.piles,
      deckCount: serverState.deck.length,
      cardsPlayed: serverState.cardsPlayed,
      minCardsToPlay: serverState.minCardsToPlay,
      isDeckEmpty: serverState.isDeckEmpty,
      canUndo: serverState.canUndo,
      maxPlayers: serverState.maxPlayers,
      yourHand: player ? player.hand : [],
      yourId: playerId
    };
  }
}