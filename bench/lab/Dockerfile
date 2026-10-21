ARG NODE_IMAGE
ARG PYTHON_IMAGE
FROM ${NODE_IMAGE} AS node
FROM ${PYTHON_IMAGE}
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && \
    ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx && \
    apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates build-essential && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /opt/lab
COPY lab/package.json lab/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund && \
    ./node_modules/.bin/playwright install --with-deps chromium && \
    rm -rf /var/lib/apt/lists/*
RUN python -m venv /opt/evaluators/harbor && \
    /opt/evaluators/harbor/bin/pip install --no-cache-dir harbor==0.24.0 && \
    python -m venv /opt/evaluators/swebench && \
    /opt/evaluators/swebench/bin/pip install --no-cache-dir swebench==5.0.2 && \
    python -m venv /opt/evaluators/webarena && \
    /opt/evaluators/webarena/bin/pip install --no-cache-dir webarena-verified==1.2.3
COPY harness /opt/harness
COPY runtime.js receipt.json ./
COPY lab/container.mjs ./
ENV PATH="/opt/lab/node_modules/.bin:${PATH}"
WORKDIR /workspace/task
ENTRYPOINT ["node", "/opt/lab/container.mjs"]
CMD ["doctor"]
