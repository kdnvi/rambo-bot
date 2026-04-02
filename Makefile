APP_DIR := /opt/rambo-bot
SERVICE := rambo-bot

.PHONY: deplc update restart logs status

deplc: ## Deploy slash commands using .env.runtime
	sudo node --env-file=$(APP_DIR)/.env.runtime deploy-commands.js

update: ## Pull latest code and reinstall deps
	sudo git -C $(APP_DIR) pull
	sudo npm ci --omit=dev --prefix $(APP_DIR)
	sudo chown -R rambo:rambo $(APP_DIR)

restart: ## Restart the systemd service
	sudo systemctl restart $(SERVICE)

logs: ## Tail the service logs
	sudo journalctl -fu $(SERVICE)

status: ## Show service status
	sudo systemctl status $(SERVICE)

deploy: update deplc restart ## Full deploy: pull, deploy commands, restart

help: ## Show this help
	@grep -E '^[a-z][a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  \033[1m%-12s\033[0m %s\n", $$1, $$2}'
