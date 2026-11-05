FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY contract.js ./
USER 10001:10001
CMD ["node", "/app/contract.js", "old-read", "name"]
