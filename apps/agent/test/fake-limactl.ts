import { chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tempDir } from './build'

// A stand-in for limactl. It records each call's arguments in calls.log and
// keeps its instances as one JSON object per line in instances.jsonl (what
// `limactl list --json` prints). `shell` runs the command on this machine,
// with HOME set to a directory per instance: a "guest" home. FAKE_LIMA_*
// variables make it misbehave, as the script shows.
const SCRIPT = `#!/bin/bash
DIR="$( cd -P "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
printf '%s\\n' "$*" >> "$DIR/calls.log"
case "$1" in
  --version) echo "limactl version \${FAKE_LIMA_VERSION:-2.3.0}" ;;
  list)
    if [ "$2" = --json ] && [ -n "$3" ]; then grep "\\"name\\":\\"$3\\"" "$DIR/instances.jsonl"
    elif [ "$2" = --json ]; then cat "$DIR/instances.jsonl" 2>/dev/null
    else sed -E 's/.*"name":"([^"]+)".*/\\1/' "$DIR/instances.jsonl" 2>/dev/null; fi ;;
  clone)
    [ -n "$FAKE_LIMA_FAIL_CLONE" ] && { echo "clone failed" >&2; exit 1; }
    vm="\${@: -1}"
    # What Lima's global config (default.yaml, override.yaml) adds back.
    mounts=""; [ -n "$FAKE_LIMA_GLOBAL_MOUNT" ] && mounts='{"location":"/Users/host"}'
    forward=false; [ -n "$FAKE_LIMA_FORWARD_AGENT" ] && forward=true
    disks=""; [ -n "$FAKE_LIMA_DISK" ] && disks='"data"'
    loopback=false; [ -n "$FAKE_LIMA_HOST_LOOPBACK" ] && loopback=true
    mic=false; [ -n "$FAKE_LIMA_MICROPHONE" ] && mic=true
    echo "{\\"name\\":\\"$vm\\",\\"status\\":\\"Stopped\\",\\"config\\":{\\"mounts\\":[$mounts],\\"additionalDisks\\":[$disks],\\"ssh\\":{\\"forwardAgent\\":$forward},\\"audio\\":{\\"microphone\\":$mic},\\"networkOpts\\":{\\"hostLoopback\\":$loopback}}}" >> "$DIR/instances.jsonl"
    mkdir -p "$DIR/guests/$vm" ;;
  start)
    if [ -n "$FAKE_LIMA_START_SLEEP" ]; then exec sleep "$FAKE_LIMA_START_SLEEP"; fi ;;
  delete)
    [ -n "$FAKE_LIMA_FAIL_DELETE" ] && { echo "delete failed" >&2; exit 1; }
    vm="\${@: -1}"
    grep -v "\\"name\\":\\"$vm\\"" "$DIR/instances.jsonl" > "$DIR/instances.tmp"
    mv "$DIR/instances.tmp" "$DIR/instances.jsonl" ;;
  shell)
    # shell --workdir / <vm> <command...>
    vm="$4"; shift 4
    mkdir -p "$DIR/guests/$vm"
    # In a session of its own, as over SSH: the runner's process group.
    cd / && HOME="$DIR/guests/$vm" exec perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV or die' -- "$@" ;;
  *) echo "unexpected: $*" >&2; exit 2 ;;
esac
`

export type Instance = {
  name: string
  status?: string
  vmType?: string
  config?: { os?: string; memory?: string }
}

export const createFakeLimactl = async (instances: Instance[] = []) => {
  const dir = await tempDir()
  const limactl = join(dir, 'limactl')
  await Bun.write(limactl, SCRIPT)
  await chmod(limactl, 0o755)
  await Bun.write(
    join(dir, 'instances.jsonl'),
    instances.map((instance) => `${JSON.stringify(instance)}\n`).join(''),
  )
  return {
    limactl,
    dir,
    guestHome: (vm: string) => join(dir, 'guests', vm),
    calls: async () =>
      (
        await Bun.file(join(dir, 'calls.log'))
          .text()
          .catch(() => '')
      )
        .split('\n')
        .filter(Boolean),
  }
}

// A golden macOS instance, as Lima lists it.
export const golden: Instance = {
  name: 'golden',
  status: 'Stopped',
  vmType: 'vz',
  config: { os: 'Darwin', memory: '4GiB' },
}
