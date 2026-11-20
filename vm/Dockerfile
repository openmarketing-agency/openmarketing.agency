ARG OMA_AGENT_IMAGE=ghcr.io/openmarketing-agency/oma-agent:v0.1.6@sha256:f5bbfe76cad85b2af582c7d43e089daa59d43006186a8f92f35b81af5bbae0dd
FROM docker.io/oven/bun:1.4.4 AS bun

FROM ${OMA_AGENT_IMAGE} AS agent
USER root

FROM agent AS playbook-build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /opt/oma
COPY vm/installer/package.json vm/installer/bun.lock ./installer/
RUN cd installer && bun install --frozen-lockfile --production
COPY vm/installer/src ./installer/src
COPY vm/installer/schemas ./installer/schemas
COPY playbooks ./playbooks
COPY skills ./skills
COPY vm/prepare-seed.sh vm/oma-soul.md ./
RUN install -d -o hermes -g hermes -m 0700 /opt/oma/seed
USER hermes
RUN --network=none bash /opt/oma/prepare-seed.sh

FROM agent AS omactl-package
ARG OMACTL_TAG=v0.1.0
ARG OMACTL_SHA256=24bbb2443de35879b8952f9db8cb61e2f59b5d4e2bc33bba5eb6f10d71f03f40
WORKDIR /tmp/omactl
RUN curl -fsSL --retry 3 "https://github.com/openmarketing-agency/omactl/releases/download/$OMACTL_TAG/omactl-linux-x64.tar.gz" -o package.tar.gz \
    && printf '%s  package.tar.gz\n' "$OMACTL_SHA256" | sha256sum -c - \
    && tar -xzf package.tar.gz --no-same-owner \
    && test -x bin/omactl && test -s catalog/catalog.json

FROM agent
# The base's /usr/bin/tini is a dispatcher to s6. Use the Debian init binary.
RUN apt-get update && apt-get install -y --no-install-recommends \
        tini docker.io docker-cli docker-compose iptables kmod \
    && usermod -aG docker hermes \
    && rm -rf /var/lib/apt/lists/*
COPY --from=omactl-package /tmp/omactl/bin/omactl /usr/local/bin/omactl
COPY --from=omactl-package /tmp/omactl/catalog /opt/omactl/catalog
COPY --from=omactl-package /tmp/omactl/LICENSE /opt/omactl/LICENSE
COPY --from=playbook-build /opt/oma/playbooks /opt/oma/playbooks
COPY --from=playbook-build /opt/oma/skills /opt/oma/skills
COPY --from=playbook-build --chown=hermes:hermes /opt/oma/seed /opt/oma/seed
COPY vm/bootstrap.py vm/start.sh /opt/oma/

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
