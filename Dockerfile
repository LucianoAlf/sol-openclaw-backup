FROM node:22-alpine

RUN apk add --no-cache bash

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

VOLUME ["/workspace", "/root/.codex"]

EXPOSE 3001

CMD ["node", "dist/index.js"]
