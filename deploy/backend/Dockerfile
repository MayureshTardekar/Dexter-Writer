# ==============================================================================
# Dexter Write — Standalone Node.js Compiler Backend (Docker for EC2)
# ==============================================================================
FROM node:20-slim

WORKDIR /app

# Install dependencies required for Tectonic and curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    fontconfig \
    libfontconfig1 \
    libgraphite2-3 \
    libharfbuzz0b \
    libicu72 \
    && rm -rf /var/lib/apt/lists/*

# Install Tectonic (Rust-based standalone TeX compiler)
ARG TECTONIC_VERSION=0.15.0
RUN curl -fsSL "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
    | tar -xz -C /usr/local/bin \
    && chmod +x /usr/local/bin/tectonic

# Copy backend files from lambda directory
COPY lambda/package.json ./
RUN npm install --omit=dev

COPY lambda/handler.mjs ./
COPY lambda/server.mjs ./

# Set environment
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

HEALTHCHECK --interval=20s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fs http://localhost:8080/health || exit 1

CMD ["node", "server.mjs"]

