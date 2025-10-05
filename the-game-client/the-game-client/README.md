# The Game - Frontend

A React TypeScript frontend for "The Game" - a cooperative multiplayer card game where players work together to play all cards (2-99) onto 4 piles.

## How to Play with Friends

1. **Create a room**: Enter your name and click "Create Room"
2. **Share the room code**: Send the 6-letter room code to your friends
3. **Friends join**: They enter the room code and their names
4. **Start playing**: Click "Start Game" and work together to win!

## Game Rules

- **Goal**: Cooperatively play all cards from 2 to 99
- **4 Piles**: 2 ascending (starting at 1) and 2 descending (starting at 100)
- **Your Turn**: Play at least 2 cards, then end turn to draw more
- **Special Rule**: Cards exactly ±10 can be played in reverse direction
- **Communication**: Give hints via chat, but don't say exact numbers!
- **Win Together**: Clear all cards to win, or lose if no valid moves remain

## Backend Server

This frontend connects to the WebSocket server at: `wss://the-game-kr4u.onrender.com`

The backend handles:
- Room creation and management
- Real-time multiplayer WebSocket connections
- Game logic and state management
- Chat system

## Local Development

```bash
npm install
npm start
```

## Deployment

Deployed as a static site on Render.com with automatic builds from this repository.

## Built With

- **React** with TypeScript
- **WebSocket** for real-time multiplayer
- **CSS3** with responsive design
- **Render.com** for hosting
