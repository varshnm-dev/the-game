# Multi-stage build
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install --only=production

# Copy source and build
COPY . .
RUN npm run build

# Production image
FROM node:18-alpine AS production

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S gameserver -u 1001

# Copy built app and dependencies
COPY --from=builder --chown=gameserver:nodejs /app/dist ./dist
COPY --from=builder --chown=gameserver:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=gameserver:nodejs /app/package*.json ./

# Switch to non-root user
USER gameserver

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "http.get('http://localhost:3001/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# Start server
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]