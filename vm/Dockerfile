ARG OMA_AGENT_IMAGE=ghcr.io/openmarketing-agency/oma-agent:v0.1.22

FROM ${OMA_AGENT_IMAGE} AS agent
USER root

FROM agent AS omactl-package
ARG OMACTL_TAG=v0.1.0
ARG OMACTL_SHA256=24bbb2443de35879b8952f9db8cb61e2f59b5d4e2bc33bba5eb6f10d71f03f40
ARG OMACTL_SOURCE_COMMIT=cacffcfbc4562e3c0119bfcd57e03659ac984613
WORKDIR /tmp/omactl
# The pinned release publishes only an x64 package. Build its ARM64 counterpart from the same source.
# Use the base image's architecture so this also works with Docker's legacy builder.
RUN set -eu; \
    case "$(dpkg --print-architecture)" in \
      amd64) \
        curl -fsSL --retry 3 "https://github.com/openmarketing-agency/omactl/releases/download/$OMACTL_TAG/omactl-linux-x64.tar.gz" -o package.tar.gz; \
        printf '%s  package.tar.gz\n' "$OMACTL_SHA256" | sha256sum -c -; \
        tar -xzf package.tar.gz --no-same-owner ;; \
      arm64) \
        curl -fsSL --retry 3 https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-linux-aarch64.zip -o bun.zip; \
        printf '%s  bun.zip\n' baa6bb36f51d6e58561e02bbea825038a9df454f673d6d776e8bbf86f8c7850e | sha256sum -c -; \
        python3 -m zipfile -e bun.zip .; \
        install -m 0755 bun-linux-aarch64/bun /usr/local/bin/bun; \
        git init -q source; \
        git -C source fetch --depth 1 https://github.com/openmarketing-agency/omactl.git "$OMACTL_SOURCE_COMMIT"; \
        git -C source checkout -q --detach FETCH_HEAD; \
        (cd source && bun install --frozen-lockfile && bun run build --current); \
        install -D -m 0755 source/dist/omactl-linux-arm64 bin/omactl; \
        cp -a source/catalog source/LICENSE . ;; \
      *) echo 'omactl requires linux/amd64 or linux/arm64' >&2; exit 1 ;; \
    esac; \
    test -s catalog/catalog.json; \
    bin/omactl version --json | python3 -c 'import json, sys; assert json.load(sys.stdin)["data"]["version"] == sys.argv[1]' "${OMACTL_TAG#v}"

FROM agent
# The base's /usr/bin/tini is a dispatcher to s6. Use the Debian init binary.
RUN apt-get update && apt-get install -y --no-install-recommends \
        tini docker.io docker-cli docker-compose iptables kmod \
    && usermod -aG docker hermes \
    && rm -rf /var/lib/apt/lists/*
COPY --from=omactl-package /tmp/omactl/bin/omactl /usr/local/bin/omactl
COPY --from=omactl-package /tmp/omactl/catalog /opt/omactl/catalog
COPY --from=omactl-package /tmp/omactl/LICENSE /opt/omactl/LICENSE
COPY vm/bootstrap.py vm/register_campaign_suggestions.py vm/start.sh vm/sync_standalone.py vm/workspace.py /opt/oma/
RUN /opt/hermes/.venv/bin/python /opt/oma/register_campaign_suggestions.py \
    /opt/hermes/hermes_cli/oma_campaigns/schemas/campaign.schema.json

ARG OMA_AGENT_IMAGE
ARG OMACTL_TAG=v0.1.0
ARG OMA_SOURCE_COMMIT=local
ARG OMA_VM_VERSION=local
LABEL org.opencontainers.image.source="https://github.com/openmarketing-agency/openmarketing.agency" \
      org.opencontainers.image.version="$OMA_VM_VERSION" \
      org.opencontainers.image.base.name="$OMA_AGENT_IMAGE" \
      agency.openmarketing.omactl.version="$OMACTL_TAG" \
      agency.openmarketing.playbooks.revision="$OMA_SOURCE_COMMIT"
ENV HOME=/opt/data HERMES_HOME=/opt/data HERMES_DIR=/opt/hermes PYTHONPATH=/opt/hermes \
    GATEWAY_MULTIPLEX_PROFILES=true HERMES_DASHBOARD=1 \
    HERMES_DASHBOARD_HOST=0.0.0.0 HERMES_DASHBOARD_PORT=9119
WORKDIR /opt/oma
EXPOSE 8642 9119 9080
ENTRYPOINT ["/usr/bin/tini", "-s", "-g", "--", "/bin/bash", "/opt/oma/start.sh"]
CMD []
