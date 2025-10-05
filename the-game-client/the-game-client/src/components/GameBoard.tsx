import React, { useState } from 'react';
import { ClientGameState, Card, Pile } from '../types/game';
import { GameClient } from '../services/GameClient';
import './GameBoard.css';

interface GameBoardProps {
  gameState: ClientGameState;
  gameClient: GameClient;
}

const GameBoard: React.FC<GameBoardProps> = ({ gameState, gameClient }) => {
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [highlightedPiles, setHighlightedPiles] = useState<Set<string>>(new Set());

  const isYourTurn = gameState.currentPlayerId === gameState.yourId;

  const canPlayCard = (card: Card, pile: Pile): boolean => {
    if (pile.type === 'ascending') {
      // For ascending piles: play higher cards OR exactly -10 for backward jump
      return card.value > pile.currentValue || card.value === pile.currentValue - 10;
    } else {
      // For descending piles: play lower cards OR exactly +10 for backward jump
      return card.value < pile.currentValue || card.value === pile.currentValue + 10;
    }
  };

  const getValidPilesForCard = (card: Card): Set<string> => {
    const validPiles = new Set<string>();
    gameState.piles.forEach(pile => {
      if (canPlayCard(card, pile)) {
        validPiles.add(pile.id);
      }
    });
    return validPiles;
  };

  const handleCardClick = (card: Card) => {
    if (!isYourTurn) return;

    if (selectedCard?.id === card.id) {
      // Deselect
      setSelectedCard(null);
      setHighlightedPiles(new Set());
    } else {
      // Select new card
      setSelectedCard(card);
      setHighlightedPiles(getValidPilesForCard(card));
    }
  };

  const handlePileClick = (pile: Pile) => {
    console.log('Pile clicked:', pile.id, 'Selected card:', selectedCard?.value, 'Is your turn:', isYourTurn);
    console.log('Highlighted piles:', Array.from(highlightedPiles));
    console.log('Can play card?', selectedCard && canPlayCard(selectedCard, pile));

    if (!isYourTurn || !selectedCard) return;

    if (highlightedPiles.has(pile.id)) {
      console.log('Playing card:', selectedCard.id, 'on pile:', pile.id);
      gameClient.playCard(selectedCard.id, pile.id);
      setSelectedCard(null);
      setHighlightedPiles(new Set());
    } else {
      console.log('Pile not in highlighted piles');
    }
  };

  const handleEndTurn = () => {
    if (!isYourTurn) return;

    if (gameState.cardsPlayed < gameState.minCardsToPlay) {
      alert(`You must play at least ${gameState.minCardsToPlay} cards before ending your turn.`);
      return;
    }

    gameClient.endTurn();
    setSelectedCard(null);
    setHighlightedPiles(new Set());
  };

  const handleUndo = () => {
    if (!isYourTurn || !gameState.canUndo) return;

    gameClient.undoMove();
    setSelectedCard(null);
    setHighlightedPiles(new Set());
  };

  const renderPile = (pile: Pile) => {
    const isHighlighted = highlightedPiles.has(pile.id);
    const isClickable = isYourTurn && selectedCard && highlightedPiles.has(pile.id);

    return (
      <div
        key={pile.id}
        className={`pile ${pile.type} ${isHighlighted ? 'highlighted' : ''} ${
          isClickable ? 'clickable' : ''
        }`}
        onClick={() => handlePileClick(pile)}
      >
        <div className="pile-header">
          <div className="pile-type">
            {pile.type === 'ascending' ? '↗️ Ascending' : '↘️ Descending'}
          </div>
          <div className="pile-target">
            Target: {pile.type === 'ascending' ? '99' : '2'}
          </div>
        </div>

        <div className="pile-current-value">
          {pile.currentValue}
        </div>

        <div className="pile-cards-count">
          {pile.cards.length} cards
        </div>

        {isHighlighted && selectedCard && (
          <div className="pile-preview">
            Will play: {selectedCard.value}
          </div>
        )}
      </div>
    );
  };

  const renderCard = (card: Card) => {
    const isSelected = selectedCard?.id === card.id;
    const hasValidMoves = getValidPilesForCard(card).size > 0;
    const isPlayable = isYourTurn && hasValidMoves;

    return (
      <div
        key={card.id}
        className={`card ${isSelected ? 'selected' : ''} ${
          isPlayable ? 'playable' : 'not-playable'
        } ${!isYourTurn ? 'disabled' : ''}`}
        onClick={() => handleCardClick(card)}
      >
        <div className="card-value">{card.value}</div>
        {!hasValidMoves && isYourTurn && (
          <div className="card-blocked">🚫</div>
        )}
      </div>
    );
  };

  if (gameState.status === 'won') {
    return (
      <div className="game-board victory">
        <div className="victory-message">
          <h2>🎉 Victory! 🎉</h2>
          <p>Congratulations! You've successfully played all cards!</p>
        </div>
      </div>
    );
  }

  if (gameState.status === 'lost') {
    return (
      <div className="game-board defeat">
        <div className="defeat-message">
          <h2>💔 Game Over 💔</h2>
          <p>No more valid moves available. Better luck next time!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="game-board">
      {/* Game Status Bar */}
      <div className="game-status-bar">
        <div className="status-left">
          <div className="turn-indicator">
            {isYourTurn ? (
              <span className="your-turn">🎯 Your Turn</span>
            ) : (
              <span className="waiting-turn">⏳ Waiting...</span>
            )}
          </div>
          <div className="cards-played">
            Cards Played: {gameState.cardsPlayed}/{gameState.minCardsToPlay}
          </div>
        </div>

        <div className="status-right">
          <div className="deck-count">
            Deck: {gameState.deckCount} cards
            {gameState.isDeckEmpty && <span className="deck-empty"> (Empty)</span>}
          </div>
        </div>
      </div>

      {/* Game Piles */}
      <div className="piles-container">
        <div className="piles-section">
          <h3>Game Piles</h3>
          <div className="piles-grid">
            {gameState.piles.map(renderPile)}
          </div>
        </div>
      </div>

      {/* Your Hand */}
      <div className="hand-container">
        <div className="hand-header">
          <h3>Your Hand ({gameState.yourHand.length} cards)</h3>
          {selectedCard && (
            <div className="selected-card-info">
              Selected: {selectedCard.value}
              <button
                className="deselect-button"
                onClick={() => {
                  setSelectedCard(null);
                  setHighlightedPiles(new Set());
                }}
              >
                ✕
              </button>
            </div>
          )}
        </div>

        <div className="hand">
          {gameState.yourHand.map(renderCard)}
        </div>
      </div>

      {/* Action Buttons */}
      {isYourTurn && (
        <div className="action-buttons">
          <button
            className="action-button undo-button"
            onClick={handleUndo}
            disabled={!gameState.canUndo}
            title={gameState.canUndo ? 'Undo last move' : 'No moves to undo'}
          >
            ↶ Undo
          </button>

          <button
            className="action-button end-turn-button"
            onClick={handleEndTurn}
            disabled={gameState.cardsPlayed < gameState.minCardsToPlay}
            title={
              gameState.cardsPlayed < gameState.minCardsToPlay
                ? `Play ${gameState.minCardsToPlay - gameState.cardsPlayed} more cards`
                : 'End your turn'
            }
          >
            End Turn
          </button>
        </div>
      )}

      {/* Instructions */}
      <div className="instructions">
        {isYourTurn ? (
          selectedCard ? (
            <p>Click on a highlighted pile to play your card ({selectedCard.value})</p>
          ) : (
            <p>Click on a card to select it, then click on a valid pile to play it</p>
          )
        ) : (
          <p>Wait for your turn. You can chat with other players while waiting!</p>
        )}
      </div>
    </div>
  );
};

export default GameBoard;