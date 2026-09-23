# ==============================================================================
# Dexter Write — Multi-Stage Production Dockerfile
# Client-first, 100% serverless Overleaf alternative
# ==============================================================================

# Stage 1: Build the production bundle
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci

# Copy source files
COPY . .

# Compile TypeScript and Vite production bundle
RUN npm run build

# Stage 2: Lightweight Nginx runner
FROM nginx:alpine AS runner

# Remove default welcome files
RUN rm -rf /usr/share/nginx/html/*

# Copy custom Nginx SPA configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy production build assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose HTTP port 80
EXPOSE 80

# Basic health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
