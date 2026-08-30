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
- **Building from source needs more than 4 GB — the exact figure is unverified.**
  What is measured: a build with 3.8 GiB available to Docker is OOM-killed
  partway through, usually with no error message at all:

  ```
  ELIFECYCLE  Command failed.
  failed to solve: process "/bin/sh -c pnpm run generate"
  did not complete successfully: exit code: 1
  ```

  `packages/hoppscotch-selfhost-web` builds with `node --max_old_space_size=8192`,
  so V8 is *permitted* an 8 GB heap. That is a ceiling, not a reservation — the
  true peak may be well below it, and has not been measured here. Treat 8 GB as
  a safe upper bound rather than a hard requirement.

  Note that `NODE_OPTIONS=--max-old-space-size=...` will not rein this in: an
  explicit command-line flag takes precedence over `NODE_OPTIONS`, so the 8192
  in the package script wins. Lowering it means editing that `package.json`.

  **Don't build on a small machine — build in CI.** GitHub-hosted runners give
  16 GB on public repositories, comfortably above the ceiling, and push the
  result to a registry your server can pull from.

## 0. Choose which image to run

`deploy/docker-compose.image.yml` overlays the stack to run a pre-built image,
so nothing is compiled locally. `HOPP_IMAGE` in `.env` picks which one:

| `HOPP_IMAGE` | Runs |
| --- | --- |
| *(unset — the default)* | `ghcr.io/rosdyana/hoppscotch:latest`, this fork's build |
| `hoppscotch/hoppscotch:latest` | upstream's stock image, no fork changes |
| `ghcr.io/rosdyana/hoppscotch:1.0.0` | a pinned release of this fork |

Publishing the fork image is covered in "Building your own image" below. Until
your first tag exists, set `HOPP_IMAGE=hoppscotch/hoppscotch:latest` to run
stock upstream.

```bash
docker compose -f docker-compose.prod.yml -f deploy/docker-compose.image.yml pull
docker compose -f docker-compose.prod.yml -f deploy/docker-compose.image.yml up -d
```

Set `COMPOSE_FILE=docker-compose.prod.yml:deploy/docker-compose.image.yml` in
`.env` (the template already does) and you can drop the `-f` flags everywhere.

Everything else in this guide applies unchanged — any of these images reads the
same `.env`, because all configuration is applied at container start rather than
baked in at build time.

To build from source instead, use `docker-compose.prod.yml` alone with `build`
in place of `pull` — but read the memory note in Prerequisites first.

## 1. Configure

```bash
cd /opt/hoppscotch
cp deploy/env.prod.example .env

openssl rand -hex 16   # -> DATA_ENCRYPTION_KEY (exactly 32 chars)
openssl rand -hex 24   # -> POSTGRES_PASSWORD
```

Edit `.env`: paste both secrets, then replace every `hopp.example.com` with your
domain.

Then verify both, before starting anything:

```bash
# must print 0 — no placeholder domains left
grep -c 'hopp\.example\.com' .env

# must print exactly 32 — see below
printf '%s' "$(grep '^DATA_ENCRYPTION_KEY=' .env | cut -d= -f2-)" | wc -c
```

`DATA_ENCRYPTION_KEY` is used as **raw utf8 bytes** for aes-256-cbc, so it must
be 32 *characters*, not 32 bytes of entropy. `openssl rand -hex 16` is right;
`openssl rand -hex 32` gives 64 characters and `openssl rand -base64 32` gives
44, and both fail at boot with:

```
RangeError: Invalid key length ... code: 'ERR_CRYPTO_INVALID_KEYLEN'
```

Quoting the value in `.env` adds two characters and fails the same way.

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

## Building your own image (fork development)

If you are adding features to this fork, the upstream image will not contain
them — you need your own. Build it in CI, not locally.

`.github/workflows/build-fork-image.yml` builds the `aio` target for
`linux/amd64` and pushes to `ghcr.io/rosdyana/hoppscotch`. It authenticates with
the automatic `GITHUB_TOKEN`, so there are no secrets to configure.

```bash
git tag 1.0.0
git push origin 1.0.0
```

That publishes `:1.0.0`, `:1.0`, `:latest` and a `:sha-<commit>` tag. You can
also run it by hand from the Actions tab. Then on the server:

```bash
docker compose pull && docker compose up -d
```

`HOPP_IMAGE` in `.env` selects which image runs — it defaults to your fork's
`:latest`. Pin a release with `HOPP_IMAGE=ghcr.io/rosdyana/hoppscotch:1.0.0`, or
go back to stock with `HOPP_IMAGE=hoppscotch/hoppscotch:latest`.

**One-time GHCR setup.** New GHCR packages are private. Either make the package
public (repo → Packages → your package → Package settings → Change visibility),
or authenticate the server with a read-only token:

```bash
echo <PAT-with-read:packages> | docker login ghcr.io -u rosdyana --password-stdin
```

**Upstream's Docker Hub workflow is disabled in this fork.**
`.github/workflows/release-push-docker.yml` also triggers on `*.*.*` tags and
pushes to Docker Hub using `DOCKER_USERNAME`/`DOCKER_PASSWORD` secrets this fork
does not have, so every tag produced a failed run. It is disabled at the repo
level (Actions tab → the workflow → "..." → Disable workflow, or
`gh workflow disable 345562841`) rather than by editing the file, so syncing
from upstream stays conflict-free. Re-enable with `gh workflow enable` if you
ever add Docker Hub credentials.

**Don't develop against Docker images.** A full image build per change is far
too slow a loop. Run the app natively with `pnpm dev` against a Postgres
container while writing code, and use the image build only to deploy.

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

**`RangeError: Invalid key length` / `ERR_CRYPTO_INVALID_KEYLEN` at boot.**
`DATA_ENCRYPTION_KEY` is not 32 characters. Fix it in `.env`, then — only if you
have not completed onboarding yet — reset with `docker compose down -v && docker
compose up -d`, because the partial seed left the `InfraConfig` table unusable.
If you already have real data, restore from a dump instead of using `-v`.

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

**`FATAL: the database system is in recovery mode`, or `Consistent recovery
state has not been yet reached`, repeating in a restart loop.** Postgres is
replaying WAL after an unclean shutdown (host reboot, OOM kill, power loss). The
app container is not the problem and no migration has run yet - it fails before
reaching one.

`depends_on: condition: service_healthy` does **not** cover this: compose honours
it on `compose up`, but not when Docker's own `restart: unless-stopped` policy
brings a container back. So the app returns before Postgres is accepting
connections and the two crash-loop past each other. The app's `command` retries
`prisma migrate deploy` every 5s for exactly this reason, so on a current image
it waits the recovery out on its own.

Check how far along the database is:

```bash
docker compose -f docker-compose.prod.yml logs db --tail=50
```

`database system is ready to accept connections` means recovery finished and the
app will come up on its next attempt. Recovery is normally seconds to a couple of
minutes; if the log shows no progress after ~10 minutes, the data directory may
be damaged and you are into restore-from-backup territory.

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
