FROM node:22-alpine

RUN apk add --no-cache bash docker-cli

RUN npm install -g @openai/codex tsx

WORKDIR /app

COPY package*.json ./
RUN npm ci

VOLUME ["/workspace", "/root/.codex"]

EXPOSE 3001

CMD ["sh", "-c", "while true; do codex app-server --listen ws://127.0.0.1:9100; echo '[watchdog] app-server caiu, reiniciando...'; sleep 2; done & tsx src/index.ts"]
