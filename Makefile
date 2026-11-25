.PHONY: dev production dev-console

dev: dev-console

production:
	@mkdir -p -m 700 .oma-data
	@docker compose -f compose.yaml up --build --detach --wait

dev-console:
	@mkdir -p -m 700 .oma-data
	@docker compose -f compose.yaml -f compose.dev.yaml up --build --watch
