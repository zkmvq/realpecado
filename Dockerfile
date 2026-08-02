FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip unzip git \
    postgresql postgresql-client \
    mariadb-server mariadb-client \
    redis-server \
    sqlite3 \
    curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# MongoDB community server (Debian 12 build). Tenta versoes conhecidas em cascata.
RUN set -eux; \
    for v in 7.0.14 7.0.12 6.0.14; do \
        if curl -fsSL "https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-debian12-${v}.tgz" -o /tmp/mongo.tgz; then \
            echo "Using MongoDB ${v}"; break; \
        fi; \
    done; \
    tar -xzf /tmp/mongo.tgz -C /tmp; \
    cp /tmp/mongodb-linux-x86_64-debian12-*/bin/mongod /usr/local/bin/; \
    cp /tmp/mongodb-linux-x86_64-debian12-*/bin/mongosh /usr/local/bin/ || true; \
    rm -rf /tmp/mongodb-linux-x86_64-debian12-* /tmp/mongo.tgz

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
