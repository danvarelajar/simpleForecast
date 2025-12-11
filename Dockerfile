# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies (use npm install if lock file doesn't exist)
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copy source files
COPY tsconfig.json ./
COPY *.ts ./

# Build TypeScript
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install production dependencies only (use npm install if lock file doesn't exist)
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Expose port
EXPOSE 3000

# Set environment variable
ENV PORT=3000
ENV NODE_ENV=production

# Start the server
CMD ["npm", "start"]

