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
- **8 GB RAM and ~15 GB free disk to build from source.** The build compiles a Go
  toolchain, Caddy from source, the native `isolated-vm` addon and both frontend
  bundles. 4 GB is *not* enough — the selfhost-web Vite build
  (`prod.Dockerfile:224`, `pnpm run generate`) gets OOM-killed with:

  ```
  failed to solve: ResourceExhausted: process "/bin/sh -c pnpm run generate"
  did not complete successfully: cannot allocate memory
  ```

  On a smaller server you have two options. Add swap so the peak is absorbed:

  ```bash
  sudo fallocate -l 8G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  ```

  Or skip the build entirely and use the image CI publishes from this same
  Dockerfile — in `docker-compose.prod.yml`, comment out the `build:` block and
  change `image:` to `hoppscotch/hoppscotch:latest`. Nothing else changes,
  because all configuration is applied at container start rather than build time.
  Upgrades then become `docker compose pull && docker compose up -d`.

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

## 2. Build and start

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps          # both services -> healthy
```

The app container runs `prisma migrate deploy` before starting, so the schema is
always applied before the backend boots. Nothing publishes to the network yet —
the stack listens on `127.0.0.1:3080` only.

Smoke-test it locally before putting Caddy in front:

```bash
curl -fsS  http://127.0.0.1:3080/backend/ping
curl -fsSI http://127.0.0.1:3080/       | head -1     # 200
curl -fsSI http://127.0.0.1:3080/admin/ | head -1     # 200
```

Setting `COMPOSE_FILE=docker-compose.prod.yml` in `.env` (it's in the template,
commented out) lets you drop the `-f` from every command.

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

# Upgrade
git pull
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d    # migrations run on start

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
