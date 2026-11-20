.PHONY: dev

dev:
	@mkdir -p -m 700 .oma-data
	@docker compose -f compose.yaml -f compose.dev.yaml up --build --watch
