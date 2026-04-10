DOCKER_IMAGE ?= $(shell grep '"name"' package.json 2>/dev/null | sed 's/.*: "//;s/".*//' || echo rambo-bot)
DOCKER_HUB_USER ?= $(shell echo $$DOCKER_HUB_USER)
IMAGE := $(DOCKER_HUB_USER)/$(DOCKER_IMAGE)
TAG ?= latest

.PHONY: build run deploy-commands docker-build docker-push deploy fmt vet

build: ## Build the bot binary
	go build -o rambo-bot .

run: ## Run locally (requires .env variables exported)
	go run .

fmt: ## Format all Go code
	gofmt -w .

vet: ## Run go vet
	go vet ./...

deploy-commands: ## Register slash commands with Discord
	go run ./cmd/deploy-commands/

docker-build: ## Build Docker image
	docker build -t $(IMAGE):$(TAG) .

docker-push: ## Push image to Docker Hub
	docker push $(IMAGE):$(TAG)

deploy: docker-build docker-push ## Build and push Docker image

help: ## Show this help
	@grep -E '^[a-z][a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  \033[1m%-18s\033[0m %s\n", $$1, $$2}'
