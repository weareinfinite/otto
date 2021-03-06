FROM node:12-alpine
WORKDIR /app

# Instal base packages
RUN set -ex && \
    apk update && \
    apk add ca-certificates && \
    update-ca-certificates && \
    apk add --no-cache \
    openssl \
    curl \
    git \
    build-base \
    libc6-compat \
    openssh-client

# Install additional app packages
RUN apk add --no-cache \
    sox \
    opus-tools # Used to decode Telegram Audio notes

# Install imagemagick
RUN apk add --no-cache imagemagick graphicsmagick

# Cleanup
RUN rm -rf /var/cache/apk/*

# Install node modules
COPY package.json yarn.lock tsconfig.json .eslintrc jest.config.js .prettierrc ./
RUN yarn install

# Copy my code
COPY ./src ./src
COPY ./src-client ./src-client
COPY ./etc ./etc

# Install workspaces packages
RUN yarn install

# Build code
RUN yarn build:server
RUN yarn build:client

# Clean src
RUN rm -rf ./src

ENTRYPOINT [ "yarn", "start:built" ]
VOLUME /app/cache /app/log /app/keys /app/tmp
EXPOSE 80
