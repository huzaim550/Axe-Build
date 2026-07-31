# Container runtime is swappable: `make up DOCKER=podman` works too.
DOCKER  ?= docker
COMPOSE ?= $(DOCKER) compose

.PHONY: up down logs nuke clean-cache ps

up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down --remove-orphans

ps:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs -f

# Remove containers, ALL named volumes, and the built images. Host ends up pristine.
nuke:
	DOCKER=$(DOCKER) bash scripts/nuke.sh

# Wipe only the npm/gradle caches (when disk gets tight). Build history and
# artifacts are untouched. Containers must be stopped to release the volumes.
clean-cache:
	$(COMPOSE) down --remove-orphans
	$(DOCKER) volume rm -f mybuild_gradle-cache mybuild_npm-cache mybuild_ccache
	@echo "Caches cleared. Run 'make up' to start again."
	@echo "Note: the next build will be slow again while these refill."
