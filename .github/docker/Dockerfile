# Build with `npm ci && npm run build` before invoking Docker, as in the
# container-images workflow. Local workspaces keep fork changes out of npm.
FROM node:22-alpine3.23 AS dependencies
WORKDIR /service
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY mods ./mods
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-alpine3.23 AS connect
WORKDIR /service
RUN apk add --no-cache tini
COPY --from=dependencies /service/node_modules ./node_modules
COPY --from=dependencies /service/mods/common ./mods/common
COPY --from=dependencies /service/mods/processor ./mods/processor
COPY --from=dependencies /service/mods/location ./mods/location
COPY --from=dependencies /service/mods/connect ./mods/connect
ENTRYPOINT ["tini", "-v", "-e", "143", "--"]
CMD ["node", "mods/connect/dist/runner.js"]

FROM dependencies AS prisma
# Match the Prisma version in package-lock.json and retain its CLI for offline
# migrations at startup. Generation runs on Alpine, matching the runtime.
RUN npm install --prefix /prisma --no-audit --no-fund prisma@6.19.1 \
    && /prisma/node_modules/.bin/prisma generate --schema=mods/pgdata/schema.prisma

FROM alpine:3.23 AS java
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk
WORKDIR /work
RUN apk add --no-cache openjdk17-jdk
COPY .scripts/custom-jre.sh ./
RUN sh custom-jre.sh

FROM node:22-alpine3.23 AS one
WORKDIR /service
ENV JAVA_HOME=/service/jre \
    EDGEPORT_RUNNER=/service/edgeport.sh \
    PATH_TO_CERTS=/etc/routr/certs \
    LOG4J2=/etc/routr/log4j2.yaml \
    PKCS12_PASSWORD=changeme \
    TLS_ON=false \
    VERIFY_CLIENT_CERT=false \
    CA_CERT_SUBJECT="/CN=Self Signed CA" \
    SERVER_CERT_SUBJECT="/CN=localhost" \
    DATABASE_URL=postgres://postgres:postgres@localhost:5432/routr \
    IGNORE_LOOPBACK_FROM_LOCALNETS=true \
    START_INTERNAL_DB=true
RUN apk add --no-cache openssl postgresql su-exec tini \
    && addgroup -g 5000 fonoster \
    && adduser -D -G fonoster -u 5000 fonoster \
    && mkdir -p /etc/routr/certs /var/lib/postgresql/data /run/postgresql \
    && chown -R postgres:postgres /var/lib/postgresql /run/postgresql
COPY --from=prisma /service/node_modules ./node_modules
COPY --from=prisma /service/mods/common ./mods/common
COPY --from=prisma /service/mods/processor ./mods/processor
COPY --from=prisma /service/mods/connect ./mods/connect
COPY --from=prisma /service/mods/dispatcher ./mods/dispatcher
COPY --from=prisma /service/mods/location ./mods/location
COPY --from=prisma /service/mods/pgdata ./mods/pgdata
COPY --from=prisma /service/mods/rtprelay ./mods/rtprelay
COPY --from=prisma /service/mods/one ./mods/one
COPY --from=prisma /prisma /prisma
COPY --from=java /work/jre ./jre
COPY mods/edgeport/libs ./libs
COPY mods/edgeport/edgeport.sh ./
COPY mods/edgeport/etc/log4j2.yaml /etc/routr/log4j2.yaml
COPY etc/edgeport.yaml config/edgeport.yaml
COPY mods/pgdata/schema.prisma ./schema.prisma
COPY mods/pgdata/migrations ./migrations
COPY .scripts/convert-to-p12.sh .scripts/generate-certs.sh ./
COPY .github/docker/start-one.sh ./start-one.sh
RUN chmod +x edgeport.sh convert-to-p12.sh generate-certs.sh start-one.sh \
    && chown -R fonoster:fonoster /service /etc/routr
ENTRYPOINT ["tini", "-v", "-e", "143", "--"]
CMD ["./start-one.sh"]
