# How to Play "The Game" Online with Friends

## Quick Setup (5 minutes)

### Step 1: Create a Room
1. Go to the game website (once deployed)
2. Enter your name
3. Click **"Create Room"**
4. You'll get a **room code** like "AB3X7F"

### Step 2: Invite Friends
1. Send the **room code** to your friends (via text, Discord, etc.)
2. Each friend goes to the game website
3. They enter their name and the **room code**
4. Click **"Join Room"**

### Step 3: Start Playing
1. Wait for everyone to join (up to 5 players total)
2. The room creator clicks **"Start Game"**
3. Game begins automatically!

## How to Play "The Game"

### Goal
Work together to play all cards (2-99) onto 4 piles before running out of moves.

### The 4 Piles:
- **2 Ascending piles**: Start at 1, play higher numbers (2, 3, 4...)
- **2 Descending piles**: Start at 100, play lower numbers (99, 98, 97...)

### Special Rule:
You can play a card that's **exactly 10 lower** on ascending piles or **10 higher** on descending piles.

### Your Turn:
1. **Play at least 2 cards** (1 card when deck is empty)
2. Click a card from your hand
3. Click which pile to play it on
4. Click **"End Turn"** when done

### Team Communication:
- Use the chat to give hints: "I can help with the 60s pile"
- **Don't say exact numbers!** That's against the rules 😉

### Win/Lose Together:
- **Win**: All cards played successfully
- **Lose**: Someone can't make a valid move

## Technical Notes

The game uses WebSockets for real-time multiplayer, but the UI handles everything automatically. No technical knowledge needed - just click and play!

## Game Rules Summary

- **Players**: 1-5 (cooperative)
- **Cards**: Numbers 2-99
- **Hand Size**: 8 cards (1 player), 7 cards (2 players), 6 cards (3+ players)
- **Turn**: Play minimum 2 cards, then draw back to hand size
- **Special Move**: Play exactly ±10 to reverse pile direction temporarily
- **Communication**: Hints allowed, exact numbers forbidden