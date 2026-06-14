.DEFAULT_GOAL := build

# Deployment config/secrets live in .env (gitignored). See .env.example.
-include .env

REQUIRED_DEPLOY_VARS := DEPLOY_RSYNC_HOST DEPLOY_SSH_HOST DEPLOY_ROOT DEPLOY_USER DEPLOY_GROUP

.PHONY: build webapp fmt dos2unix clean deploy deploy-fspermissions deploy-reload check-deploy-env bench-fe bench-fe-concurrency

# webapp-perf harness root (shared infra: serve/, bench/, lib/coord.sh, results/).
WEBAPP_PERF_ROOT ?= /home/ubuntu24/webapp-perf

# Frontend perf bench (serial: serializes serve+Playwright+size-report under the bench mutex).
# Authoritative post-merge integrity check for the webapp-perf Round-2 work.
#   make bench-fe DIST=$(PWD)/common/webapp/dist LABEL=postmerge
DIST ?= $(PWD)/common/webapp/dist
LABEL ?= fe-run
bench-fe:
	bash $(WEBAPP_PERF_ROOT)/bench/run-fe.sh "$(DIST)" "$(LABEL)"

# tileLoadConcurrency knee sweep under the 1 Gbit/s cap (from U-D). Serializes the whole
# serve+bench cycle via the single-holder `bench` mutex (lib/coord.sh acquire_lock), like
# bench-fe. Apply the network cap first with bench/throttle.sh; SWEEP_* env tune the run.
# Result: $(WEBAPP_PERF_ROOT)/results/sweep.json.
bench-fe-concurrency:
	@bash -c 'set -euo pipefail; \
		ROOT="$(WEBAPP_PERF_ROOT)"; \
		source "$$ROOT/lib/coord.sh"; \
		acquire_lock bench 1800 || { echo "bench-fe-concurrency: could not acquire bench lock" >&2; exit 1; }; \
		log_event sweep "bench lock acquired (concurrency sweep)"; \
		trap "release_lock bench" EXIT; \
		bash "$$ROOT/bench/sweep.sh" $(SWEEP_ARGS)'

check-deploy-env:
	@$(foreach v,$(REQUIRED_DEPLOY_VARS),$(if $(value $(v)),,$(error $(v) is not set — copy .env.example to .env and fill it in)))

deploy: check-deploy-env deploy-fspermissions
	rsync -rltvz --delete --exclude='maps' --omit-dir-times \
		--chmod=Dug=rwx,Do=rx,Dg+s,Fug=rw,Fo=r \
		dist/webapp/ $(DEPLOY_RSYNC_HOST):$(DEPLOY_ROOT)/
	$(MAKE) deploy-reload

# Graceful nginx reload — MUST run after every deploy. The webroot serves with
# `open_file_cache_valid 3600s`, so after rsync --delete swaps in new hashed
# assets, nginx keeps serving the previous (cached) index.html for up to an hour;
# it points at the just-deleted asset hashes → 404 until the cache revalidates.
# A reload flushes open_file_cache instantly (and is graceful: no dropped conns).
deploy-reload: check-deploy-env
	ssh $(DEPLOY_SSH_HOST) 'sudo nginx -t && sudo systemctl reload nginx'

# Repair/normalize webroot ownership & permissions so both `admin` and the unprivileged
# `user` (deploy account) can write via the shared www-data group. Idempotent; runs as a
# deploy prerequisite. The `maps` subtree is pruned (managed by the render process).
deploy-fspermissions: check-deploy-env
	printf '%s\n' \
		'set -euo pipefail' \
		'ROOT=$(DEPLOY_ROOT)' \
		'usermod -aG $(DEPLOY_GROUP) $(DEPLOY_USER)' \
		'find "$$ROOT" -path "$$ROOT/maps" -prune -o -print0        | xargs -0 chgrp $(DEPLOY_GROUP)' \
		'find "$$ROOT" -path "$$ROOT/maps" -prune -o -type d -print0 | xargs -0 chmod 2775' \
		'find "$$ROOT" -path "$$ROOT/maps" -prune -o -type f -print0 | xargs -0 chmod 664' \
		| ssh $(DEPLOY_SSH_HOST) 'sudo bash -s'

build: dos2unix
	git submodule update --init --recursive
	rm -rf ./dist
	mkdir -p ./dist
	DOCKER_BUILDKIT=1 docker buildx build \
		--file Dockerfile.build \
		--target export \
		--output type=local,dest=./dist \
		.

webapp: dos2unix
	rm -rf ./dist/webapp
	mkdir -p ./dist/webapp
	DOCKER_BUILDKIT=1 docker buildx build \
		--file Dockerfile.webapp \
		--target export \
		--output type=local,dest=./dist/webapp \
		.

dos2unix:
	@command -v dos2unix >/dev/null 2>&1 || { \
		echo "ERROR: dos2unix is not installed. Install it with: sudo apt-get install dos2unix"; \
		exit 1; \
	}
	@find . -type f \
		-not -path './.git/*' \
		-not -path './build/*' -not -path '*/build/*' \
		-not -path '*/.gradle/*' \
		-not -path '*/node_modules/*' \
		-not -path './dist/*' \
		-print0 | xargs -0 -r dos2unix -q

format:
	cd common/webapp && npm run format

clean:
	rm -rf ./dist
