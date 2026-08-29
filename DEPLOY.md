# Self-hosting Hoppscotch on a Debian server

A production deployment with everything in Docker — app, admin dashboard, backend,
webapp/bundle server, Postgres and migrations — behind Caddy on the host for TLS.

Everything is served from **one domain**:

| URL | Serves |
| --- | --- |
| `https://hopp.example.com/` | The Hoppscotch app |
| `https://hopp.example.com/admin` | Admin dashboard |
| `https://hopp.example.com/backend` | REST + GraphQL API |
| `https://hopp.example.com/desktop-app-server` | Desktop app bundles |

Files involved:

- `docker-compose.prod.yml` — the stack
- `deploy/env.prod.example` — environment template
- `deploy/Caddyfile.example` — host Caddy config

## Prerequisites

- Debian with Docker Engine and the Compose plugin (`docker compose version`)
- A domain with an A/AAAA record pointing at the server, ports 80 and 443 open
- **Running it needs ~0.5 GB RAM.** Measured on an idle instance and under a
  burst of concurrent requests: the app container settles at ~400 MiB and
  Postgres at ~110 MiB. A 4 GB server runs this comfortably with room for the
  host Caddy.
- **Building it from source needs 8 GB available to Docker**, plus ~15 GB disk —
  far more than running it. `packages/hoppscotch-selfhost-web` builds with
  `node --max_old_space_size=8192`, so V8 is permitted an 8 GB heap and grows
  into it rather than collecting early. Give the container less and the kernel
  kills it partway through, usually with no error message at all:

  ```
  ELIFECYCLE  Command failed.
  failed to solve: process "/bin/sh -c pnpm run generate"
  did not complete successfully: exit code: 1
  ```

  `NODE_OPTIONS=--max-old-space-size=...` will *not* rein this in: an explicit
  command-line flag takes precedence over `NODE_OPTIONS`, so the 8192 in the
  package script wins regardless.

  **On anything under 8 GB, don't build — use the pre-built image below.** That
  is the normal path, not a fallback; the source build is only worth it if you
  are modifying Hoppscotch itself.

## 0. Choose: pre-built image (recommended) or source build

CI publishes the `aio` target of this repo's `prod.Dockerfile` as
`hoppscotch/hoppscotch`. `deploy/docker-compose.image.yml` overlays the stack to
use it, so nothing is compiled locally:

```bash
docker compose -f docker-compose.prod.yml -f deploy/docker-compose.image.yml pull
docker compose -f docker-compose.prod.yml -f deploy/docker-compose.image.yml up -d
```

Everything else in this guide applies unchanged — the published image reads the
same `.env`, because all configuration is applied at container start rather than
baked in at build time. Upgrades become `pull` + `up -d`.

Set `COMPOSE_FILE=docker-compose.prod.yml:deploy/docker-compose.image.yml` in
`.env` to make plain `docker compose pull` / `docker compose up -d` use this
path — then you can drop the `-f` flags from every command below.

To build from source instead (8 GB required), use `docker-compose.prod.yml`
alone with `build` in place of `pull`, as shown in step 2.

## 1. Configure

```bash
cd /opt/hoppscotch
cp deploy/env.prod.example .env

openssl rand -hex 16   # -> DATA_ENCRYPTION_KEY (exactly 32 chars)
openssl rand -hex 24   # -> POSTGRES_PASSWORD
```

Edit `.env`: paste both secrets, then replace every `hopp.example.com` with your
domain.

```bash
grep -c 'hopp\.example\.com' .env   # must print 0 when you're done
```

## 2. Start it

Assuming you set `COMPOSE_FILE` in step 0, so `docker compose` already points at
the right files:

```bash
docker compose pull        # or: docker compose build   (source build, 8 GB)
docker compose up -d
docker compose ps          # both services -> healthy
```

The app container runs `prisma migrate deploy` before starting, so the schema is
always applied before the backend boots. Nothing is exposed to the network yet —
the stack listens on `127.0.0.1:3080` only.

First boot takes a minute or two (migrations, then the Nest bootstrap) and the
container reports `unhealthy` in the meantime. That is expected; see
Troubleshooting.

Smoke-test it before putting Caddy in front:

```bash
curl -fsS  http://127.0.0.1:3080/backend/ping        # Success
curl -fsSI http://127.0.0.1:3080/       | head -1    # 200  app
curl -fsSI http://127.0.0.1:3080/admin/ | head -1    # 200  admin dashboard
```

## 3. Put Caddy in front

```bash
sudo apt install -y caddy
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo sed -i 's/hopp\.example\.com/YOUR-DOMAIN/g' /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy issues the certificate on first request. Verify:

```bash
curl -fsSI https://YOUR-DOMAIN/ | head -1
```

Only 80 and 443 need to be reachable from outside.

## 4. First-boot setup

Open `https://YOUR-DOMAIN/admin` and complete the onboarding flow: create the
admin account, configure SMTP, and enable any OAuth providers you want.

These are **not** environment variables — they live in the Postgres
`infra_config` table (encrypted with `DATA_ENCRYPTION_KEY`) and can only be set
through the dashboard. The same goes for JWT/session secrets, which are
generated automatically, plus token lifetimes and rate limits.

## Two things you cannot undo

**`DATA_ENCRYPTION_KEY` is permanent.** It encrypts the JWT and session secrets
stored in the database. Once the instance has booted once, changing it makes
every subsequent boot fail with `"DATA_ENCRYPTION_KEY" value changed in .env
file`. Back it up alongside your database dumps.

**`docker compose down -v` deletes your data.** The `-v` removes the `db-data`
volume and with it every workspace, collection and user. Plain `down` is safe.

## Operating it

```bash
# Logs
docker compose -f docker-compose.prod.yml logs -f hoppscotch

# Restart after editing .env — domain and URL changes need no rebuild,
# the VITE_* values are injected into the SPAs at container start
docker compose -f docker-compose.prod.yml up -d --force-recreate hoppscotch

# Backup (do this before any upgrade; keep DATA_ENCRYPTION_KEY with it)
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U hoppscotch hoppscotch | gzip > hoppscotch-$(date +%F).sql.gz

# Restore into an empty database
gunzip -c hoppscotch-YYYY-MM-DD.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T db psql -U hoppscotch hoppscotch

# Upgrade (pre-built image)
docker compose pull
docker compose up -d                               # migrations run on start

# Upgrade (source build)
git pull && docker compose build && docker compose up -d

# Database shell
docker compose -f docker-compose.prod.yml exec db psql -U hoppscotch hoppscotch
```

## Troubleshooting

**Frontend can't reach the API / CORS errors in the console.** A `VITE_*` value
or `WHITELISTED_ORIGINS` still points at `localhost`. The values are inlined
into `index.html` (not the JS chunks) at container start, so check there:

```bash
curl -s http://127.0.0.1:3080/ | grep -o 'VITE_BACKEND_API_URL[^,]*'
```

It must show your domain. If it shows `localhost` or an unsubstituted
placeholder, fix `.env` and recreate the container. The admin dashboard has its
own copy — check `curl -s http://127.0.0.1:3080/admin/` the same way.

**Login appears to succeed but you're logged straight back out.** `VITE_BASE_URL`
is `http://`, so the backend isn't issuing `Secure` cookies. It must be `https://`.

**Container shows `unhealthy` for the first minute or two.** Expected on a cold
start, and it clears on its own. The image's healthcheck uses
`--start-period=15s`, but migrations plus the Nest bootstrap take longer than
that on modest hardware, so the first few probes fail before the backend is
listening. Only worry if it is still unhealthy after ~5 minutes.

**Container never reaches `healthy`.** `docker compose -f docker-compose.prod.yml
logs hoppscotch`. The migration step runs first, so a database connection problem
shows up there before the app logs anything.

**`Database connection failed: Connection terminated due to connection timeout`,
in a restart loop.** The `connect_timeout` in `DATABASE_URL` is in
**milliseconds**, despite Postgres's own parameter of that name being in
seconds. The backend reads it straight into pg's `connectionTimeoutMillis`. If
you hand-edit `DATABASE_URL`, don't copy the `connect_timeout=300` from upstream's
`docker-compose.yml` — that gives the pool 300ms and it will crash-loop on a cold
start. `docker-compose.prod.yml` uses `30000` (30 seconds).

## Notes and limits

- The backend uses an in-memory GraphQL PubSub, so it runs as a **single
  instance**. Don't scale the `hoppscotch` service to more than one replica.
- The desktop-app bundle signing key is persisted in the `webapp-server-data`
  volume. Losing it invalidates bundles cached by desktop clients, which then
  re-download — it isn't fatal, but keep the volume.
- Mock servers need wildcard DNS and a wildcard certificate; see the commented
  block in `deploy/Caddyfile.example`.
- `docker-compose.yml` (profile-driven, for local development) and
  `docker-compose.deploy.yml` (upstream's internal CI) are unrelated to this
  setup and are left untouched.
