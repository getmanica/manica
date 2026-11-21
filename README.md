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

The plane is published as a container image, `ghcr.io/getmanica/plane` (linux/amd64 and linux/arm64), running on Node. It needs Postgres.

The plane doesn't migrate its database on its own, and refuses to start while migrations are pending. Run them from the same image before starting it, and before each upgrade (for example as a pre-deploy step):

```sh
docker run --rm --env-file plane.env ghcr.io/getmanica/plane dist/migrate.js
docker run -p 3000:3000 --env-file plane.env ghcr.io/getmanica/plane
```

with `plane.env` holding the variables below, for example:

```sh
DATABASE_URL=postgres://manica:manica@db:5432/manica
BETTER_AUTH_URL=https://manica.example.com
BETTER_AUTH_SECRET=...   # openssl rand -base64 32
ENCRYPTION_KEY=...       # openssl rand -base64 32
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
| `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET` | no | Turn on billing: plans with limits on organizations, agents and forge apps, managed under **Admin > Plans**. The webhook endpoint is `$BETTER_AUTH_URL/api/auth/stripe/webhook`, with the `checkout.session.completed` and `customer.subscription.*` events. Off, nothing is limited |

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
| `vm.backend`          |                         | Run each job in a VM, with this backend (`lima`). See [Running jobs in VMs](#running-jobs-in-vms-macos) |
| `vm.image`            |                         | The stopped VM jobs are cloned from                                  |

Unknown keys are rejected. The CLI options are:

```
doctor                  Check the config, the plane, and which VM backends this machine can run jobs with, then exit
-c, --config-dir <dir>  Directory holding config.toml (default: $XDG_CONFIG_HOME/manica)
-h, --help              Show this help
-v, --version           Show the version
```

`manica-agent doctor` checks everything the agent needs without taking a job: that the config loads, that the plane takes the token, that the data directory is writable, and, for each VM backend, whether it's installed and whether the configured image can be cloned. It exits with 1 if jobs couldn't run. A backend the config doesn't use is reported but doesn't fail it.

### Running jobs in VMs (macOS)

By default jobs run on the agent's machine, as the agent's user. With a `[vm]` section, each job runs instead in a fresh macOS VM cloned from a golden VM you prepare, and the VM is deleted once the job is done: nothing a job does outlives it, and it can't read the host's files or the agent's token. The agent drives a VM tool you install; it doesn't ship one.

Backends: `lima` ([Lima](https://lima-vm.io) 2.3 or later, which runs macOS guests on Apple silicon).

macOS runs at most **2 VMs at once** per Mac (Virtualization.framework refuses a third, as Apple's license allows two), whichever tool started them, so give a VM agent at most 2 slots. Budget about 4 GB of RAM per VM: macOS guests under 3 GB may never boot.

#### Preparing the golden VM (Lima)

The golden VM is the stopped VM every job is cloned from: what's installed in it is what jobs get. Make it as the user the agent runs as (Lima keeps VMs in `~/.lima`, or `$LIMA_HOME`), on the Mac the agent runs on. Expect about 50 minutes the first time, mostly downloading Apple's restore image, and about 55 GB of disk: about 28 GB for the VM and 24 GB for the restore image, which Lima keeps in `~/Library/Caches/lima` (with it there, making the VM again takes about 5 minutes).

1. Create and start it. Lima downloads the macOS restore image from Apple (checked against a pinned checksum), installs it, and boots it. Use at least 3 GB of memory: smaller macOS guests may never boot.

   ```sh
   limactl create --name=manica-golden --cpus=4 --memory=4 \
     --set '.osOpts.Darwin.suppressFirstLoginSetup=true' template:macos
   limactl start manica-golden
   ```

   `suppressFirstLoginSetup` (Lima 2.3+) skips the setup screens of the first login. `template:macos` is the newest macOS Lima knows; pin one with `template:macos-27`. It can't be newer than the host's macOS.

2. Give the guest user password-less sudo, as GitHub's hosted runners have (many `setup-*` actions expect it). The VM is thrown away after each job, so this only reaches inside it. The user's password is in `~/password` in the guest:

   ```sh
   limactl shell manica-golden sh -c 'sudo -S -p "" sh -c "echo \"$(whoami) ALL=(ALL) NOPASSWD: ALL\" > /etc/sudoers.d/manica-jobs && chmod 440 /etc/sudoers.d/manica-jobs" < ~/password'
   ```

3. Install what your jobs need. The image is plain macOS: no developer tools, no Homebrew. The Command Line Tools (clang, git, make) install without a GUI with `softwareupdate`:

   ```sh
   limactl shell manica-golden sh -c '
     sudo touch /tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress
     label=$(softwareupdate -l | sed -n "s/^\* Label: \(Command Line Tools.*\)$/\1/p" | tail -1)
     sudo softwareupdate -i "$label"
     sudo rm /tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress'
   ```

   Install Xcode, Homebrew (or start from `template:homebrew-macos` in step 1), and anything else the same way you would on a Mac, from `limactl shell manica-golden`. Xcode is large: check the VM's disk (100 GB by default, allocated as used).

4. Stop it. Jobs are cloned from it stopped:

   ```sh
   limactl stop manica-golden
   ```

5. Point the agent at it, and check:

   ```toml
   [vm]
   backend = "lima"
   image = "manica-golden"
   ```

   ```sh
   manica-agent doctor
   ```

To update the golden VM later, let running jobs finish first (stop the agent once, which drains it): while it's started, jobs can't be cloned from it. Then start it, change what you need, stop it, and start the agent again.

For each job, the agent clones the golden VM so that it shares nothing with the host or with other jobs: no host directories (Lima's macOS template shares your home directory read-only otherwise), disks, devices, audio or microphone, no forwarded SSH agent or X11, no shared networks, and no access to the host's loopback services (which include the SSH ports of other jobs' VMs). It refuses to start the clone if Lima's global config (`~/.lima/_config/default.yaml` or `override.yaml`) adds any of them back. Services on the host that listen on all interfaces stay reachable from jobs through its LAN address, as from any machine on the network. It starts the VM (about 15 s), copies in the runner build it downloaded and verified (about 15 s), runs it with its config on stdin, and deletes the VM when the job is done. If a VM can't be deleted, no new job starts until it is.

VMs it makes are named `manica-runner-` followed by the first 12 characters of the runner's id, without dashes; on start, the agent deletes any left over by a previous one, so the golden VM's name can't start with `manica-runner-`. For the same reason only one agent at a time can use a Lima home: a second one refuses to start.

## Development

Bun + Turborepo monorepo: `apps/plane` (TypeScript), `apps/agent` (Rust), and shared TS configs in `packages/tsconfig`.

```sh
mise install                           # Bun, Node and Rust, at the versions in mise.toml
bun install
docker compose up -d                   # Postgres; set POSTGRES_PORT if 5432 is taken
cp apps/plane/.env.example apps/plane/.env   # fill in the secrets
bun run --cwd apps/plane db:migrate    # again after pulling new migrations
bun run dev
```

Bun is the package manager and task runner; the plane itself runs on Node (TanStack Start, served by Vite in development). The agent is a Rust crate in the `apps/agent` workspace, whose scripts run cargo, so the commands below cover it too; its types for the plane's API are generated from the spec the plane's tests keep in `apps/plane/openapi/agent.json` (`bun run test -u` updates it).

GitHub must be able to reach the webhook URL, so in development run a tunnel that forwards every path (for example `cloudflared tunnel --url http://localhost:3000`) and set `PUBLIC_URL` to the URL it prints. smee.io doesn't work, because each app has its own webhook path.

```sh
bun run check-types
bun run lint
bun run format:check
bun run test   # plane tests use a throwaway database on DATABASE_URL's Postgres
```

Commits follow Conventional Commits. Releases are cut by release-please, with the plane and agent versions linked.
