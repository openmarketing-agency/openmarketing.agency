.PHONY: dev production dev-console

dev:
	@mkdir -p -m 700 .oma-data
	@if [ ! -f .env.camofox ]; then \
		key=$$(openssl rand -hex 32) && \
		(umask 077; set -C; printf 'CAMOFOX_API_KEY=%s\n' "$$key" > .env.camofox) || exit 1; \
	fi
	@env_files=$${COMPOSE_ENV_FILES:-}; \
	if [ -z "$$env_files" ] && [ -f .env ]; then env_files=.env; fi; \
	COMPOSE_ENV_FILES=".env.camofox$${env_files:+,$$env_files}" \
		docker compose -f compose.yaml -f compose.vm.yaml -f compose.dev.yaml -f compose.camofox.yaml up --build --watch

production:
	@mkdir -p -m 700 .oma-data
	@docker compose -f compose.yaml -f compose.vm.yaml up --build --detach --wait

dev-console:
	@mkdir -p -m 700 .oma-data
	@docker compose -f compose.yaml -f compose.dev.yaml up --build --watch
