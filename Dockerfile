# Easy Backend v2 - one image, three services.
# Select the service with the SERVICE env var: all (default) | app | admin | socket
FROM node:20-alpine

RUN apk add --no-cache \
	python3 \
	make \
	g++ \
	bash \
	curl \
	ca-certificates \
	mongodb-tools && \
	mongodump --version

WORKDIR /usr/src/app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

RUN mkdir -p backups uploads logs && chmod 755 backups uploads logs

ENV PORT=8080
ENV SERVICE=all
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
	CMD curl -f http://localhost:${PORT:-8080}/health || exit 1

CMD ["sh", "-c", "PORT=${PORT:-8080} npm run start:${SERVICE:-all}"]
