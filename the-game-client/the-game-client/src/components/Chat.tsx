import React, { useState, useEffect, useRef } from 'react';
import { ChatMessage } from '../types/game';
import './Chat.css';

interface ChatProps {
  messages: ChatMessage[];
  onSendMessage: (message: string, isHint: boolean) => void;
  currentPlayerId: string;
}

const Chat: React.FC<ChatProps> = ({
  messages,
  onSendMessage,
  currentPlayerId
}) => {
  const [messageText, setMessageText] = useState('');
  const [isHint, setIsHint] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedMessage = messageText.trim();
    if (!trimmedMessage) return;

    onSendMessage(trimmedMessage, isHint);
    setMessageText('');
  };

  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const renderMessage = (message: ChatMessage) => {
    const isOwnMessage = message.playerId === currentPlayerId;

    return (
      <div
        key={message.id}
        className={`chat-message ${isOwnMessage ? 'own-message' : ''} ${
          message.isHint ? 'hint-message' : ''
        }`}
      >
        <div className="message-header">
          <span className="message-author">
            {isOwnMessage ? 'You' : message.playerName}
          </span>
          <span className="message-time">{formatTime(message.timestamp)}</span>
          {message.isHint && <span className="hint-indicator">💡 Hint</span>}
        </div>
        <div className="message-text">{message.message}</div>
      </div>
    );
  };

  return (
    <div className="chat">
      <div className="chat-header">
        <h4>💬 Chat</h4>
        <div className="chat-rules">
          <small>💡 Give hints, but don't say exact card numbers!</small>
        </div>
      </div>

      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="empty-chat">
            <p>No messages yet. Start the conversation!</p>
            <div className="chat-suggestions">
              <p><strong>Suggestion examples:</strong></p>
              <ul>
                <li>"I can help with the high cards"</li>
                <li>"Someone needs to play on the descending piles"</li>
                <li>"I have some low numbers"</li>
                <li>"The ascending pile is blocked"</li>
              </ul>
            </div>
          </div>
        ) : (
          <>
            {messages.map(renderMessage)}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <div className="message-type-selector">
          <label className="message-type-option">
            <input
              type="radio"
              name="messageType"
              checked={!isHint}
              onChange={() => setIsHint(false)}
            />
            <span>💬 Chat</span>
          </label>
          <label className="message-type-option">
            <input
              type="radio"
              name="messageType"
              checked={isHint}
              onChange={() => setIsHint(true)}
            />
            <span>💡 Hint</span>
          </label>
        </div>

        <div className="input-row">
          <input
            type="text"
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder={
              isHint
                ? "Give a hint (no exact numbers!)"
                : "Type a message..."
            }
            maxLength={200}
            className="chat-input"
          />
          <button
            type="submit"
            disabled={!messageText.trim()}
            className="send-button"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
};

export default Chat;