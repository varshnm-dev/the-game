# The Game - Online Multiplayer Server

WebSocket-based backend server for "The Game" board game with real-time multiplayer support and player privacy.

## 🎮 Features

### Core Multiplayer
- **Real-time WebSocket communication**
- **Room-based game sessions** (up to 5 players)
- **Player privacy** - Other players only see hand counts, not actual cards
- **Turn-based gameplay** with server-side validation
- **Undo functionality** with move history
- **Chat system** with hint support

### Security & Privacy
- **Card privacy**: Players only see their own cards
- **Server-side game state**: All game logic runs on server
- **Input validation**: Prevents cheating and invalid moves
- **Connection management**: Handles player disconnections gracefully

### Performance & Scalability
- **Room cleanup**: Automatic removal of inactive rooms
- **Connection pooling**: Efficient WebSocket management
- **Message broadcasting**: Optimized state updates
- **Health monitoring**: Built-in health check endpoint

## 🚀 Quick Start

### Development
```bash
cd the-game-server
npm install
npm run dev
```

### Production
```bash
npm install
npm run build
npm start
```

### Docker
```bash
# Build and run with Docker Compose
docker-compose up --build

# Or build manually
docker build -t the-game-server .
docker run -p 3001:3001 the-game-server
```

## 📡 API Endpoints

### HTTP API
- `GET /health` - Server health check
- `GET /api/room/:roomId` - Get room information
- `POST /api/room` - Create new room

### WebSocket Messages

#### Client → Server
```json
{
  "type": "create_room",
  "playerId": "player_123",
  "playerName": "Alice"
}

{
  "type": "join_room",
  "roomId": "ABC123",
  "playerId": "player_456",
  "playerName": "Bob"
}

{
  "type": "game_action",
  "action": {
    "type": "play_card",
    "playerId": "player_123",
    "cardId": "card_456",
    "pileId": "ascending-1",
    "timestamp": 1234567890
  }
}
```

#### Server → Client
```json
{
  "type": "game_state_update",
  "gameState": {
    "id": "ABC123",
    "status": "playing",
    "players": [
      {
        "id": "player_123",
        "name": "Alice",
        "handCount": 6,
        "isCurrentPlayer": true,
        "isConnected": true
      }
    ],
    "yourHand": [
      {"id": "card_1", "value": 15},
      {"id": "card_2", "value": 23}
    ],
    "yourId": "player_123"
  }
}
```

## 🏗️ Architecture

### Game State Management
- **Server-side authority**: All game state stored on server
- **Client synchronization**: Players receive only their view of the game
- **Move validation**: Server validates all moves before applying
- **History tracking**: Last 10 moves stored for undo functionality

### Player Privacy Implementation
```typescript
// Server stores full player data
interface ServerPlayer {
  id: string;
  name: string;
  hand: Card[];  // Full hand visible to server
  isCurrentPlayer: boolean;
  connectionId: string;
  isConnected: boolean;
}

// Clients receive limited player data
interface PublicPlayer {
  id: string;
  name: string;
  handCount: number;  // Only count, not actual cards
  isCurrentPlayer: boolean;
  isConnected: boolean;
}
```

### Connection Lifecycle
1. **Connect**: WebSocket connection established
2. **Join/Create Room**: Player joins existing or creates new room
3. **Game Start**: When enough players join
4. **Gameplay**: Real-time turn-based actions
5. **Disconnect Handling**: Graceful player removal
6. **Room Cleanup**: Automatic cleanup of empty/inactive rooms

## 🌐 Deployment Guide

### Option 1: Heroku
```bash
# Install Heroku CLI
heroku create your-game-server

# Set environment variables
heroku config:set NODE_ENV=production
heroku config:set PORT=3001

# Deploy
git push heroku main
```

### Option 2: DigitalOcean/AWS/GCP
```bash
# Build Docker image
docker build -t the-game-server .

# Push to container registry
docker tag the-game-server your-registry/the-game-server
docker push your-registry/the-game-server

# Deploy with docker-compose
docker-compose up -d
```

### Option 3: Railway
```bash
# Install Railway CLI
railway login
railway init
railway up
```

### Option 4: Vercel (Serverless)
```bash
npm install -g vercel
vercel --prod
```

## 🔧 Configuration

### Environment Variables
```bash
NODE_ENV=production
PORT=3001
CORS_ORIGIN=https://your-frontend-domain.com
MAX_ROOMS=1000
CLEANUP_INTERVAL=600000  # 10 minutes
ROOM_TIMEOUT=7200000     # 2 hours
```

### Client Configuration
Update your client's multiplayer service:
```typescript
const multiplayerService = new OnlineMultiplayerService({
  serverUrl: 'https://your-server-domain.com'
});
```

## 📊 Monitoring

### Health Check
```bash
curl https://your-server.com/health
```

Response:
```json
{
  "status": "healthy",
  "rooms": 5,
  "connections": 12
}
```

### Logs
- Connection events
- Room creation/destruction
- Game actions
- Error tracking

## 🔒 Security Features

### Rate Limiting
- API endpoints: 10 requests/second per IP
- WebSocket connections: 5/second per IP
- Message flooding protection

### Input Validation
- All game actions validated server-side
- Player authentication per room
- Move legality checking

### CORS Configuration
- Configurable allowed origins
- Credentials support for authenticated sessions

## 🚢 Production Deployment Steps

1. **Server Setup**:
   ```bash
   cd the-game-server
   npm install
   npm run build
   ```

2. **Environment Configuration**:
   ```bash
   export NODE_ENV=production
   export PORT=3001
   export CORS_ORIGIN=https://your-domain.com
   ```

3. **Start Server**:
   ```bash
   npm start
   # Or with PM2 for production
   npm install -g pm2
   pm2 start dist/server.js --name "the-game-server"
   ```

4. **Update Client**:
   ```typescript
   // Update client configuration
   const config = {
     serverUrl: 'https://your-server.com'
   };
   ```

5. **SSL Certificate** (recommended):
   ```bash
   # Using Let's Encrypt
   certbot --nginx -d your-domain.com
   ```

## 💾 Database (Optional)

For persistent game stats and user accounts:

```typescript
// Optional database schema
interface GameStats {
  playerId: string;
  gamesPlayed: number;
  gamesWon: number;
  averageCardsPlayed: number;
  createdAt: Date;
}

interface UserProfile {
  id: string;
  username: string;
  email: string;
  stats: GameStats;
}
```

## 🧪 Testing

```bash
# Run tests
npm test

# Load testing with WebSocket connections
npm run test:load
```

This server provides a complete multiplayer solution with proper player privacy, real-time communication, and production-ready deployment options!