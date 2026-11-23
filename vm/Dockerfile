ARG OMA_AGENT_IMAGE=ghcr.io/openmarketing-agency/oma-agent:v0.1.20@sha256:5aad65f8ffd1555c519300b71394316a69bfdef336861ba3e608c3b3d29e8aa7

FROM ${OMA_AGENT_IMAGE} AS agent
USER root

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
COPY vm/bootstrap.py vm/campaign-compatibility.patch vm/register_campaign_suggestions.py vm/start.sh vm/sync_standalone.py vm/workspace.py /opt/oma/
RUN git -C /opt/hermes apply /opt/oma/campaign-compatibility.patch
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
