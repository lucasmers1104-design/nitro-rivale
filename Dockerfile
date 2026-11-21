# Nitro Rivale – Spiel + Mehrspieler-Server in einem Container
# Bauen:   docker build -t nitro-rivale .
# Starten: docker run -p 8080:8080 nitro-rivale   → http://localhost:8080

# 1) Spiel bündeln (Three.js + Rapier + Code → eine index.html)
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY build.mjs template.html ./
COPY src ./src
COPY dist/sounds ./dist/sounds
RUN node build.mjs

# 2) Schlankes Laufzeit-Image: nur Node, Server und das gebaute Spiel
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/app/data
COPY server ./server
COPY --from=build /src/dist ./dist
# Spielstände: in Coolify als Persistent Storage (Volume Mount) auf /app/data legen
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "server/server.mjs"]
