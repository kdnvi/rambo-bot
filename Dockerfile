FROM node:22-alpine

RUN apk add --no-cache curl

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENTRYPOINT ["sh", "entrypoint.sh"]
CMD ["node", "index.js"]
