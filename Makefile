.PHONY: dev production dev-console

dev:
	@mkdir -p -m 700 .oma-data
	@docker compose -f compose.yaml -f compose.vm.yaml -f compose.dev.yaml up --build --watch

production:
	@mkdir -p -m 700 .oma-data
	@docker compose -f compose.yaml -f compose.vm.yaml up --build --detach --wait

dev-console:
	@mkdir -p -m 700 .oma-data
	@docker compose -f compose.yaml -f compose.dev.yaml up --build --watch
