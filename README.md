# Manica

> run GitHub Actions jobs on your own machines

Manica has two parts:

- **plane**: the control plane. A web console and API where you register a GitHub App, add your machines, and follow jobs. It receives `workflow_job` webhooks and hands queued jobs to agents.
- **agent** (`manica-agent`): a small daemon you run on each machine. It polls the plane, downloads the latest [actions/runner](https://github.com/actions/runner) build, and starts a just-in-time runner for each job it is given.

## Features

- one-click GitHub App creation from the console (via an app manifest), owned by your account or an organization
- organizations, with email and password sign-in
- an admin section for the plane's admins: list every user, make or remove admins, ban (for a while or until unbanned), sign out, and remove users
- register Linux and macOS machines (arm64 and x64) with a number of slots, meaning how many jobs they run at once
- `runs-on` label matching, with built-in labels for each machine's OS and arch plus custom ones (see [How jobs reach an agent](#how-jobs-reach-an-agent))
- just-in-time runners: each job gets a fresh runner, registered on the repository and unregistered afterwards
- a jobs view with status, repository, assigned agent, and labels
- recovers from missed webhooks: the plane asks GitHub to redeliver failed deliveries and checks stale jobs with the API
- graceful shutdown: the first `SIGINT`/`SIGTERM` lets running jobs finish, a second one stops them

Windows is not supported by the agent yet.

## How jobs reach an agent

The agent doesn't choose its jobs: it asks the plane for work, and the plane decides what it gets.

### Labels

Each agent has a set of labels. Some are built in and some are custom:

| Label                                           | Example (`mac-mini`, macOS arm64)        |
| ----------------------------------------------- | ---------------------------------------- |
| `self-hosted`, `manica`                         | `self-hosted`, `manica`                  |
| its OS (GitHub's name too)                      | `darwin`, `macos`                        |
| its arch (GitHub's name too)                    | `arm64` (x64 machines: `x86_64`, `x64`)  |
| every `<os>-<arch>` pair                        | `darwin-arm64`, `macos-arm64`            |
| its name                                        | `mac-mini`                               |
| custom labels set in the console (up to 32)     | `gpu`, `xcode-16`                        |

A job matches an agent when **every** label in its `runs-on` is in the agent's set. The agent may have extra labels the job doesn't ask for. Labels are compared case-insensitively, as on GitHub, so workflows written for GitHub's own self-hosted runners (`[self-hosted, macOS, X64]`) work unchanged.

### Queueing

When GitHub sends a `workflow_job` webhook, the plane stores the job only if at least one of the organization's agents matches its labels. Other jobs, such as `ubuntu-latest` ones meant for GitHub-hosted runners, are ignored. So a job queued before any agent matches it is never picked up, even if a matching agent is added later. Re-run the job in that case.

### Claiming

Each agent polls the plane every `poll_interval` seconds (5 by default). On each poll the plane:

1. Skips the agent if it is shutting down, or if no actions/runner build for its platform is known yet.
2. Counts the agent's free slots: its `slots` minus the runners it already has starting or running.
3. Takes that many queued jobs from the organization, oldest first, that match the agent's labels and that no other runner has reserved.
4. Registers a just-in-time runner for each of them on the job's repository, with the job's labels, and sends its config to the agent, which starts it.

The polls of a single agent run one at a time, and a job can be reserved by only one live runner. That way two agents never claim the same job, and one agent never fills the same slot twice.

### What GitHub does with the runner

GitHub gives a runner any queued job on that repository that its labels cover, which is not always the job the runner was reserved for. The plane records which job each runner actually started. The job that was skipped goes back to being free, and the next poll claims it. A runner that is still idle 30 seconds after its job stopped being queued (it was cancelled, or another runner took it) is unregistered, and its agent is told to stop it.

Runners are leased for a minute, and each poll renews the lease. If an agent stops polling, its runners expire. If an agent restarts and no longer holds a runner, the plane marks that runner as gone and cleans up its registration on GitHub.

## Running the plane

The plane is published as a container image, `ghcr.io/getmanica/plane` (linux/amd64 and linux/arm64). It needs Postgres and runs its migrations at startup.

```sh
docker run -p 3000:3000 \
  -e DATABASE_URL=postgres://manica:manica@db:5432/manica \
  -e BETTER_AUTH_URL=https://manica.example.com \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -e ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  ghcr.io/getmanica/plane
```

| Variable             | Required | Description                                                                                  |
| -------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | yes      | Postgres connection string                                                                   |
| `BETTER_AUTH_URL`    | yes      | URL the console is served from                                                               |
| `BETTER_AUTH_SECRET` | yes      | Session secret (`openssl rand -base64 32`)                                                   |
| `ENCRYPTION_KEY`     | yes      | Encrypts GitHub App credentials at rest (`openssl rand -base64 32`)                          |
| `PUBLIC_URL`         | no       | Base URL GitHub delivers webhooks to, defaults to `BETTER_AUTH_URL`. Must be publicly reachable |
| `PORT`               | no       | Defaults to `3000`                                                                           |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | no | Turn on signing in with GitHub, through a GitHub OAuth app whose callback URL is `$BETTER_AUTH_URL/api/auth/callback/github` |

Keep `ENCRYPTION_KEY` safe: losing it makes the stored GitHub App credentials unreadable.

### Setting up

1. Sign up in the console. You land in your personal organization.
2. Under **Forge apps**, create a GitHub App. GitHub asks you to confirm it, then to install it on the repositories that should use Manica. The app requests `actions: read`, `administration: write`, `organization_self_hosted_runners: write`, and `metadata: read`, and subscribes to `workflow_job`.
3. Under **Agents**, add a machine: pick its OS, arch, slots, and custom labels. Copy the token. It is shown only once (you can regenerate it later).
4. Install and start the agent on that machine (see below).
5. Target it from a workflow:

   ```yaml
   jobs:
     build:
       runs-on: [self-hosted, manica, macos, arm64]
   ```

### Admins

Admins manage every user of the plane from the console's **Admin** section. Being an admin is a plane-wide role, separate from the owner, admin and member roles inside an organization.

Nobody is an admin by default, not even the first user to sign up. Make the first one by hand, once they have signed up:

```sql
update "user" set role = 'admin' where email = 'you@example.com';
```

For example, with the Postgres from `compose.yaml`:

```sh
docker compose exec postgres psql -U manica -d manica \
  -c "update \"user\" set role = 'admin' where email = 'you@example.com';"
```

From then on, admins can make others admins from the console. The change applies on the user's next request; no need to sign in again.

## Installing the agent

Download the executable for your platform from the [releases](https://github.com/getmanica/manica/releases) (`manica-agent-<os>-<arch>`, checked against `SHA256SUMS`), or install it from npm:

```sh
npm install -g @manica/agent
```

Then create `~/.config/manica/config.toml` (or `$XDG_CONFIG_HOME/manica/config.toml`) and make it readable only by you (`chmod 600`):

```toml
[plane]
url = "https://manica.example.com"
token = "mna_..."

[agent]
# data_dir = "/var/lib/manica"
```

and run it:

```sh
manica-agent
```

### Configuration reference

| Key                   | Default                 | Description                                                         |
| --------------------- | ----------------------- | ------------------------------------------------------------------- |
| `plane.url`           |                         | URL of the plane (http or https)                                     |
| `plane.token`         |                         | The agent token from the console. `MANICA_AGENT_TOKEN` overrides it |
| `plane.poll_interval` | `5`                     | Seconds between polls for jobs (1 to 20)                             |
| `agent.data_dir`      | `$XDG_DATA_HOME/manica` | Where runner builds are downloaded and runners run                   |

Unknown keys are rejected. The CLI options are:

```
-c, --config-dir <dir>  Directory holding config.toml (default: $XDG_CONFIG_HOME/manica)
-h, --help              Show this help
-v, --version           Show the version
```

## Development

Bun + Turborepo monorepo: `apps/plane`, `apps/agent`, and shared TS configs in `packages/tsconfig`.

```sh
bun install
docker compose up -d                   # Postgres; set POSTGRES_PORT if 5432 is taken
cp apps/plane/.env.example apps/plane/.env   # fill in the secrets
bun run dev
```

GitHub must be able to reach the webhook URL, so in development run a tunnel that forwards every path (for example `cloudflared tunnel --url http://localhost:3000`) and set `PUBLIC_URL` to the URL it prints. smee.io doesn't work, because each app has its own webhook path.

```sh
bun run check-types
bun run lint
bun run format:check
bun run test   # plane tests use a throwaway database on DATABASE_URL's Postgres
```

Commits follow Conventional Commits. Releases are cut by release-please, with the plane and agent versions linked.
