ARG NODE_IMAGE
ARG LAB_IMAGE
FROM ${NODE_IMAGE} AS headers
FROM ${LAB_IMAGE} AS dependencies
COPY --from=headers /usr/local/include/node /opt/node-headers/include/node
WORKDIR /opt/deps
COPY deps/ ./
RUN npm ci --ignore-scripts --legacy-peer-deps --no-audit --no-fund && \
    npm_config_python=/opt/evaluators/webarena/bin/python npm_config_nodedir=/opt/node-headers npm rebuild sqlite3 --build-from-source
RUN ./node_modules/.bin/playwright install chromium

FROM dependencies AS agent
COPY seeds/ /opt/seeds/
COPY session.mjs command.mjs dev.mjs backend-policy.mjs /opt/webbench/
RUN mkdir -p /workspace/task && chmod -R a+rwX /workspace /opt/seeds
WORKDIR /workspace/task
ENTRYPOINT ["node", "/opt/webbench/session.mjs"]

FROM dependencies AS verifier
COPY verifier/ /opt/verifier/
COPY seeds/ /opt/seeds/
COPY verify.mjs /opt/webbench/
WORKDIR /opt/verifier
ENTRYPOINT ["node", "/opt/webbench/verify.mjs"]
