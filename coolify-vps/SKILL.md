---
name: coolify-vps
description: Use when managing a self-hosted Coolify instance via its REST API — listing/creating/updating applications, services, databases, environment variables, deployments, and scheduled tasks. For self-hosted Coolify (not the app.coolify.io SaaS). Triggers on mentions of Coolify, Docker Compose deployments on a VPS, or managing services on a self-hosted server.
---

# Coolify API (self-hosted)

Manage a self-hosted Coolify instance via its REST API, using plain env-var auth. This targets a server you run yourself, not the `app.coolify.io` SaaS.

## Authentication

Two env vars must be set in the shell before running any command (e.g. loaded from a project `.env`):

- `COOLIFY_API_URL` — your instance's API base, e.g. `https://coolify.example.com/api/v1`
- `COOLIFY_API_KEY` — Bearer token from *Keys & Tokens → API Tokens* in the Coolify UI

To load them into the current shell (do this once per session):

```bash
set -a; source .env; set +a
```

**IMPORTANT:** the `COOLIFY_API_KEY` value MUST be quoted in `.env`, because Coolify tokens are Sanctum-format (`<id>|<random>`) and the `|` is a bash pipe operator. Correct line:

```
COOLIFY_API_KEY="1|abc123..."
```

Also ensure `.env` uses **LF line endings** (not CRLF). If sourcing fails with `^M: command not found`, fix with: `perl -i -pe 's/\r\n/\n/g' .env`.

Every API call uses:

```bash
curl -s -H "Authorization: Bearer $COOLIFY_API_KEY" "$COOLIFY_API_URL/<endpoint>"
```

If `COOLIFY_API_KEY` is empty or unset, no token has been generated yet — create one in the Coolify UI under *Keys & Tokens → API Tokens* (`https://<your-coolify-host>/security/api-tokens`).

## Quick Reference — Common API Calls

### List servers
```bash
curl -s -H "Authorization: Bearer $COOLIFY_API_KEY" "$COOLIFY_API_URL/servers"
```
Returns: `[].{uuid, name, ip}`

### List resources on a server
```bash
curl -s -H "Authorization: Bearer $COOLIFY_API_KEY" "$COOLIFY_API_URL/servers/{server_uuid}/resources"
```
Returns: `[].{type, uuid, name, status}`

### List projects
```bash
curl -s -H "Authorization: Bearer $COOLIFY_API_KEY" "$COOLIFY_API_URL/projects"
```
Returns: `[].{uuid, name, environments[]}`

### List services
```bash
curl -s -H "Authorization: Bearer $COOLIFY_API_KEY" "$COOLIFY_API_URL/services"
```

### List databases
```bash
curl -s -H "Authorization: Bearer $COOLIFY_API_KEY" "$COOLIFY_API_URL/databases"
```

### Get database details
```bash
curl -s -H "Authorization: Bearer $COOLIFY_API_KEY" "$COOLIFY_API_URL/databases/{uuid}"
```
Returns: `{name, environment_id, destination_id, ports_mappings, internal_db_url}`

### List applications
```bash
curl -s -H "Authorization: Bearer $COOLIFY_API_KEY" "$COOLIFY_API_URL/applications"
```

## Creating a Docker Compose Service

The `docker_compose_raw` field must be **base64 encoded**.

```bash
COMPOSE_B64=$(base64 <<'YAML'
services:
  myservice:
    image: myimage:latest
    restart: always
    ports:
      - "8080:80"
    environment:
      - MY_VAR=${MY_VAR}
    networks:
      - coolify
networks:
  coolify:
    external: true
YAML
)

curl -s -X POST \
  -H "Authorization: Bearer $COOLIFY_API_KEY" \
  -H 'Content-Type: application/json' \
  "$COOLIFY_API_URL/services" \
  -d "{
    \"name\": \"my-service\",
    \"project_uuid\": \"PROJECT_UUID\",
    \"server_uuid\": \"SERVER_UUID\",
    \"environment_name\": \"production\",
    \"docker_compose_raw\": \"$COMPOSE_B64\"
  }"
```

**Important:** Do NOT pass `"type": "docker-compose"` together with `docker_compose_raw` — use one or the other.

## Managing Environment Variables

Services use `/services/{uuid}/envs`; applications use `/applications/{uuid}/envs`. Same shape on both.

### List env vars
```bash
curl -s -H "Authorization: Bearer $COOLIFY_API_KEY" "$COOLIFY_API_URL/applications/{uuid}/envs"
```

### Create an env var (POST → 201)
```bash
curl -s -X POST \
  -H "Authorization: Bearer $COOLIFY_API_KEY" \
  -H 'Content-Type: application/json' \
  "$COOLIFY_API_URL/applications/{uuid}/envs" \
  -d '{"key": "MY_VAR", "value": "my-value", "is_preview": false}'
```

### Update an existing env var (PATCH, by key)
```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $COOLIFY_API_KEY" \
  -H 'Content-Type: application/json' \
  "$COOLIFY_API_URL/applications/{uuid}/envs" \
  -d '{"key": "MY_VAR", "value": "new-value"}'
```

Env var changes take effect on the **next deploy/restart**, not immediately. For docker-compose services, vars declared as `${VAR}` are auto-created with empty values — set them via PATCH before starting. Pass secret values via `--data-binary @file` (write the JSON to a temp file) so the value never lands in shell history / process args.

## Service Lifecycle

```bash
# Start
curl -s -X POST -H "Authorization: Bearer $COOLIFY_API_KEY" "$COOLIFY_API_URL/services/{uuid}/start"

# Stop
curl -s -X POST -H "Authorization: Bearer $COOLIFY_API_KEY" "$COOLIFY_API_URL/services/{uuid}/stop"

# Restart
curl -s -X POST -H "Authorization: Bearer $COOLIFY_API_KEY" "$COOLIFY_API_URL/services/{uuid}/restart"

# Update service config
curl -s -X PATCH \
  -H "Authorization: Bearer $COOLIFY_API_KEY" \
  -H 'Content-Type: application/json' \
  "$COOLIFY_API_URL/services/{uuid}" \
  -d '{"connect_to_docker_network": true}'
```

## Application Lifecycle

```bash
# List
curl -s -H "Authorization: Bearer $COOLIFY_API_KEY" "$COOLIFY_API_URL/applications"

# Deploy (by UUID)
curl -s -X POST -H "Authorization: Bearer $COOLIFY_API_KEY" "$COOLIFY_API_URL/deploy?uuid={uuid}"

# Logs
curl -s -H "Authorization: Bearer $COOLIFY_API_KEY" "$COOLIFY_API_URL/applications/{uuid}/logs?lines=200"
```

### Deployment status & the double-deploy gotcha
```bash
# Active/queued deployments
curl -s -H "Authorization: Bearer $COOLIFY_API_KEY" "$COOLIFY_API_URL/deployments"
# A specific deployment
curl -s -H "Authorization: Bearer $COOLIFY_API_KEY" "$COOLIFY_API_URL/deployments/{deployment_uuid}"
```
If auto-deploy-on-push is enabled, a `git push` to the deploy branch AND a manual `POST /deploy` will **both** queue. Coolify runs them sequentially per app (one `in_progress`, one `queued`) — harmless if your build is idempotent, but it rebuilds the same commit twice. There is no reliable API to cancel a *queued* deploy (`POST /deployments/{uuid}/cancel` only works while it's still cancellable); easiest is to trigger only one, or let the redundant one run.

## Scheduled Tasks (applications)

```bash
# List
curl -s -H "Authorization: Bearer $COOLIFY_API_KEY" "$COOLIFY_API_URL/applications/{uuid}/scheduled-tasks"

# Create (cron `frequency`, runs inside the app container)
curl -s -X POST \
  -H "Authorization: Bearer $COOLIFY_API_KEY" -H 'Content-Type: application/json' \
  "$COOLIFY_API_URL/applications/{uuid}/scheduled-tasks" \
  -d '{"name":"hourly-job","command":"your command here","frequency":"0 * * * *","timeout":600,"enabled":true}'
```
There is **no API "run now"** for a scheduled task — it fires on its cron. To trigger an immediate first run, invoke the work another way (an in-app endpoint/button, or wait for the next cron tick). Set `timeout` generously for long jobs (the field is per-task seconds).

## Networking

- Coolify containers run on a Docker network named `coolify`.
- Containers reach each other by their Coolify UUID as hostname (e.g., `a1b2c3d4...`).
- To join the network from a custom service, add to your docker-compose:
  ```yaml
  networks:
    - coolify
  networks:
    coolify:
      external: true
  ```
- `connect_to_docker_network: true` on the service also enables this.
- Database `internal_db_url` uses the container UUID as hostname.

## Wildcard domain (optional)

If your server is configured with a wildcard domain (e.g. `*.example.com → <your-vps-ip>` at your DNS provider), new apps auto-generate URLs like `<random>.example.com`, with Let's Encrypt certs issued on first HTTPS hit.

## Common Patterns

### Deploy alongside an existing PostgreSQL
1. Create the service with docker-compose (base64 encoded).
2. Join the `coolify` network to reach the DB by its container UUID.
3. Set `DB_HOST` to the PostgreSQL container's UUID via PATCH on `/services/{uuid}/envs`.

### Check container logs via SSH
```bash
ssh root@<your-vps-ip> "docker logs <CONTAINER_NAME> 2>&1 | tail -20"
```
Container names follow the pattern `{service}-{coolify_uuid}`.

### Restart the proxy (Traefik)
The Coolify proxy is a Traefik container managed by Coolify itself. Restart from the UI (Server → Proxy tab → *Restart Proxy*), or via API:
```bash
curl -s -X POST -H "Authorization: Bearer $COOLIFY_API_KEY" "$COOLIFY_API_URL/servers/{server_uuid}/proxy/restart"
```

## Important Notes

- Service start/stop/restart are **async** — responses say "queued"; poll the resource status after a delay to confirm.
- Deployments for services don't appear in `/deployments` (that's for applications only).
- If a service shows `exited` immediately, check container logs via SSH.
- Coolify manages container lifecycle — prefer the API over manual `docker run` so containers survive reboots.
- The Coolify UI is at your instance host (and is often still reachable on `http://<your-vps-ip>:8000` if HTTPS routing breaks).
- Token scope matters: read-only tokens can `GET` but not `POST`/`PATCH`/`DELETE`. If a write call returns 401/403, the token is too narrow.

## Setup

This skill expects `COOLIFY_API_URL` and `COOLIFY_API_KEY` in your environment (plain env vars — no external credential broker). Point `COOLIFY_API_URL` at your own instance's `/api/v1` base and generate a token in the Coolify UI.
