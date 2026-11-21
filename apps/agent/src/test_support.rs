//! Stand-ins for what the agent drives: runner builds, limactl, the plane,
//! and HTTP servers.
use std::{
    collections::{BTreeMap, VecDeque},
    fmt::Write,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use async_trait::async_trait;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

use crate::{
    api::{AgentPoll, AgentPollResult, RunnerBuild, RunnerStart},
    lines::{Log, lock},
    plane::{PlaneApi, PlaneError},
};

pub(crate) fn temp_dir() -> PathBuf {
    crate::temp_dir::make_temp_dir(&std::env::temp_dir(), "manica-agent-test-").unwrap()
}

fn write_executable(path: &Path, content: &str) {
    std::fs::write(path, content).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

pub(crate) fn write_config(dir: &Path, content: &str) {
    let path = dir.join("config.toml");
    std::fs::write(&path, content).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
}

fn env_file(env: &[(&str, &str)]) -> String {
    env.iter().fold(String::new(), |mut file, (key, value)| {
        writeln!(file, "export {key}='{value}'").unwrap();
        file
    })
}

/// A stand-in for an actions/runner build: a run.sh that prints its config
/// and arguments, starts a child (as the real listener does), and exits
/// with $`EXIT_CODE` once that child is done, sleeping $SLEEP seconds there.
/// `env` sets those, through a file the build carries along: the agent
/// doesn't pass its environment into guests.
const RUN_SH: &str = r#"#!/bin/bash
DIR="$( cd -P "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
[ -f "$DIR/test.env" ] && . "$DIR/test.env"
echo "config=$ACTIONS_RUNNER_INPUT_JITCONFIG args=$*"
sleep "${SLEEP:-0}" &
echo $! > "$DIR/child.pid"
wait
exit "${EXIT_CODE:-0}"
"#;

pub(crate) fn create_build(env: &[(&str, &str)]) -> PathBuf {
    let dir = temp_dir();
    write_executable(&dir.join("run.sh"), RUN_SH);
    std::fs::write(dir.join("test.env"), env_file(env)).unwrap();
    dir
}

pub(crate) fn is_alive(pid: i32) -> bool {
    nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), None).is_ok()
}

pub(crate) async fn wait_for(mut check: impl AsyncFnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !check().await {
        assert!(Instant::now() < deadline, "timed out waiting");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// Lines logged, for tests to look at.
#[derive(Clone, Default)]
pub(crate) struct Lines(Arc<Mutex<Vec<String>>>);

impl Lines {
    pub(crate) fn log(&self) -> Log {
        let lines = Arc::clone(&self.0);
        Log::new(move |line| lock(&lines).push(line.to_owned()))
    }

    pub(crate) fn all(&self) -> Vec<String> {
        lock(&self.0).clone()
    }

    pub(crate) fn contains(&self, line: &str) -> bool {
        lock(&self.0).iter().any(|logged| logged == line)
    }
}

#[derive(Debug, Default)]
struct PlaneState {
    replies: VecDeque<Result<AgentPollResult, PlaneError>>,
    polls: Vec<AgentPoll>,
    exits: Vec<(String, Option<i64>)>,
    failing_exits: usize,
}

/// A plane answering polls with the replies queued, then with nothing to
/// do, and taking exits.
#[derive(Debug, Default)]
pub(crate) struct FakePlane(Mutex<PlaneState>);

impl FakePlane {
    pub(crate) fn result(
        start: Vec<RunnerStart>,
        cancel: Vec<String>,
        runner: Option<RunnerBuild>,
    ) -> AgentPollResult {
        AgentPollResult {
            cancel,
            lease_seconds: 60,
            runner,
            start,
        }
    }

    pub(crate) fn reply(&self, reply: Result<AgentPollResult, PlaneError>) {
        lock(&self.0).replies.push_back(reply);
    }

    /// The next `count` exits fail to be reported.
    pub(crate) fn fail_exits(&self, count: usize) {
        lock(&self.0).failing_exits = count;
    }

    pub(crate) fn polls(&self) -> Vec<AgentPoll> {
        lock(&self.0).polls.clone()
    }

    pub(crate) fn exits(&self) -> Vec<(String, Option<i64>)> {
        lock(&self.0).exits.clone()
    }
}

#[async_trait]
impl PlaneApi for FakePlane {
    async fn poll(&self, poll: &AgentPoll) -> Result<AgentPollResult, PlaneError> {
        let mut state = lock(&self.0);
        state.polls.push(poll.clone());
        state
            .replies
            .pop_front()
            .unwrap_or_else(|| Ok(Self::result(vec![], vec![], None)))
    }

    async fn exited(&self, runner: &str, exit_code: Option<i64>) -> Result<(), PlaneError> {
        let mut state = lock(&self.0);
        if state.failing_exits > 0 {
            state.failing_exits -= 1;
            drop(state);
            return Err(PlaneError::Network("plane down".into()));
        }
        state.exits.push((runner.to_owned(), exit_code));
        drop(state);
        Ok(())
    }
}

/// A stand-in for limactl. It records each call's arguments in calls.log and
/// keeps its instances as one JSON object per line in instances.jsonl (what
/// `limactl list --json` prints). `shell` runs the command on this machine,
/// with HOME set to a directory per instance: a "guest" home. `FAKE_LIMA`_*
/// variables, set in fake.env, make it misbehave, as the script shows.
const FAKE_LIMACTL: &str = r#"#!/bin/bash
DIR="$( cd -P "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
[ -f "$DIR/fake.env" ] && . "$DIR/fake.env"
printf '%s\n' "$*" >> "$DIR/calls.log"
case "$1" in
  --version) echo "limactl version ${FAKE_LIMA_VERSION:-2.3.0}" ;;
  list)
    if [ "$2" = --json ] && [ -n "$3" ]; then grep "\"name\":\"$3\"" "$DIR/instances.jsonl"
    elif [ "$2" = --json ]; then cat "$DIR/instances.jsonl" 2>/dev/null
    else sed -E 's/.*"name":"([^"]+)".*/\1/' "$DIR/instances.jsonl" 2>/dev/null; fi ;;
  clone)
    [ -n "$FAKE_LIMA_FAIL_CLONE" ] && { echo "clone failed" >&2; exit 1; }
    vm="${@: -1}"
    # What Lima's global config (default.yaml, override.yaml) adds back.
    mounts=""; [ -n "$FAKE_LIMA_GLOBAL_MOUNT" ] && mounts='{"location":"/Users/host"}'
    forward=false; [ -n "$FAKE_LIMA_FORWARD_AGENT" ] && forward=true
    disks=""; [ -n "$FAKE_LIMA_DISK" ] && disks='"data"'
    loopback=false; [ -n "$FAKE_LIMA_HOST_LOOPBACK" ] && loopback=true
    mic=false; [ -n "$FAKE_LIMA_MICROPHONE" ] && mic=true
    echo "{\"name\":\"$vm\",\"status\":\"Stopped\",\"config\":{\"mounts\":[$mounts],\"additionalDisks\":[$disks],\"ssh\":{\"forwardAgent\":$forward},\"audio\":{\"microphone\":$mic},\"networkOpts\":{\"hostLoopback\":$loopback}}}" >> "$DIR/instances.jsonl"
    mkdir -p "$DIR/guests/$vm" ;;
  start)
    if [ -n "$FAKE_LIMA_START_SLEEP" ]; then exec sleep "$FAKE_LIMA_START_SLEEP"; fi ;;
  delete)
    [ -n "$FAKE_LIMA_FAIL_DELETE" ] && { echo "delete failed" >&2; exit 1; }
    vm="${@: -1}"
    grep -v "\"name\":\"$vm\"" "$DIR/instances.jsonl" > "$DIR/instances.tmp"
    mv "$DIR/instances.tmp" "$DIR/instances.jsonl" ;;
  shell)
    # shell --workdir / <vm> <command...>
    vm="$4"; shift 4
    mkdir -p "$DIR/guests/$vm"
    # In a session of its own, as over SSH: the runner's process group.
    cd / && HOME="$DIR/guests/$vm" exec perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV or die' -- "$@" ;;
  *) echo "unexpected: $*" >&2; exit 2 ;;
esac
"#;

/// An instance, as Lima lists it. Empty fields are left out.
#[derive(Clone, Copy)]
pub(crate) struct Instance {
    pub name: &'static str,
    pub status: &'static str,
    pub vm_type: &'static str,
    pub os: &'static str,
    pub memory: &'static str,
}

impl Instance {
    pub(crate) fn named(name: &'static str, status: &'static str) -> Self {
        Self {
            name,
            status,
            vm_type: "",
            os: "",
            memory: "",
        }
    }

    fn json(&self) -> String {
        let mut instance = serde_json::Map::new();
        instance.insert("name".into(), self.name.into());
        let mut config = serde_json::Map::new();
        let set = |map: &mut serde_json::Map<String, serde_json::Value>, key: &str, value: &str| {
            if !value.is_empty() {
                map.insert(key.into(), value.into());
            }
        };
        set(&mut instance, "status", self.status);
        set(&mut instance, "vmType", self.vm_type);
        set(&mut config, "os", self.os);
        set(&mut config, "memory", self.memory);
        if !config.is_empty() {
            instance.insert("config".into(), config.into());
        }
        serde_json::Value::Object(instance).to_string()
    }
}

/// A golden macOS instance, as Lima lists it.
pub(crate) fn golden() -> Instance {
    Instance {
        name: "golden",
        status: "Stopped",
        vm_type: "vz",
        os: "Darwin",
        memory: "4GiB",
    }
}

pub(crate) struct FakeLimactl {
    dir: PathBuf,
    env: Mutex<BTreeMap<String, String>>,
}

impl FakeLimactl {
    pub(crate) fn new(instances: &[Instance]) -> Self {
        let dir = temp_dir();
        write_executable(&dir.join("limactl"), FAKE_LIMACTL);
        let lines = instances.iter().fold(String::new(), |mut lines, instance| {
            writeln!(lines, "{}", instance.json()).unwrap();
            lines
        });
        std::fs::write(dir.join("instances.jsonl"), lines).unwrap();
        Self {
            dir,
            env: Mutex::default(),
        }
    }

    pub(crate) fn limactl(&self) -> String {
        self.dir.join("limactl").display().to_string()
    }

    pub(crate) fn guest_home(&self, vm: &str) -> PathBuf {
        self.dir.join("guests").join(vm)
    }

    fn write_env(&self, env: &BTreeMap<String, String>) {
        let pairs: Vec<(&str, &str)> = env.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        std::fs::write(self.dir.join("fake.env"), env_file(&pairs)).unwrap();
    }

    pub(crate) fn set(&self, key: &str, value: &str) {
        let env = {
            let mut env = lock(&self.env);
            env.insert(key.into(), value.into());
            env.clone()
        };
        self.write_env(&env);
    }

    pub(crate) fn unset(&self, key: &str) {
        let env = {
            let mut env = lock(&self.env);
            env.remove(key);
            env.clone()
        };
        self.write_env(&env);
    }

    pub(crate) fn calls(&self) -> Vec<String> {
        std::fs::read_to_string(self.dir.join("calls.log"))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }
}

pub(crate) struct Reply {
    status: u16,
    content_type: &'static str,
    body: Vec<u8>,
}

impl Reply {
    pub(crate) fn json(status: u16, body: &str) -> Self {
        Self {
            status,
            content_type: "application/json",
            body: body.as_bytes().to_vec(),
        }
    }
}

#[derive(Default)]
struct ServerState {
    replies: VecDeque<Reply>,
    /// What every request without a queued reply gets.
    fallback: Vec<u8>,
    received: Vec<String>,
}

/// A bare HTTP/1.1 server on a free port, answering one request per
/// connection, and recording them.
pub(crate) struct Server {
    address: std::net::SocketAddr,
    state: Arc<Mutex<ServerState>>,
}

impl Server {
    /// Serves `body` to every request.
    pub(crate) async fn start(body: Vec<u8>) -> Self {
        Self::with(ServerState {
            fallback: body,
            ..Default::default()
        })
        .await
    }

    /// Answers requests with `replies`, in order.
    pub(crate) async fn replying(replies: Vec<Reply>) -> Self {
        Self::with(ServerState {
            replies: replies.into(),
            ..Default::default()
        })
        .await
    }

    async fn with(state: ServerState) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let state = Arc::new(Mutex::new(state));
        let serving = Arc::clone(&state);
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let state = Arc::clone(&serving);
                tokio::spawn(async move {
                    let mut request = Vec::new();
                    let mut buffer = [0; 8192];
                    let body_start = loop {
                        let Ok(read) = stream.read(&mut buffer).await else {
                            return;
                        };
                        if read == 0 {
                            return;
                        }
                        request.extend_from_slice(&buffer[..read]);
                        if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                            break end + 4;
                        }
                    };
                    let head = String::from_utf8_lossy(&request[..body_start]).to_lowercase();
                    let length: usize = head
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length:"))
                        .and_then(|length| length.trim().parse().ok())
                        .unwrap_or(0);
                    while request.len() < body_start + length {
                        let Ok(read) = stream.read(&mut buffer).await else {
                            return;
                        };
                        if read == 0 {
                            break;
                        }
                        request.extend_from_slice(&buffer[..read]);
                    }
                    let reply = {
                        let mut state = lock(&state);
                        state
                            .received
                            .push(String::from_utf8_lossy(&request).into_owned());
                        state.replies.pop_front().unwrap_or_else(|| Reply {
                            status: 200,
                            content_type: "application/octet-stream",
                            body: state.fallback.clone(),
                        })
                    };
                    let head = format!(
                        "HTTP/1.1 {} X\r\ncontent-type: {}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                        reply.status,
                        reply.content_type,
                        reply.body.len()
                    );
                    // A client gone already doesn't need the reply.
                    drop(stream.write_all(head.as_bytes()).await);
                    drop(stream.write_all(&reply.body).await);
                    drop(stream.shutdown().await);
                });
            }
        });
        Self { address, state }
    }

    pub(crate) fn url(&self, path: &str) -> String {
        format!("http://{}/{path}", self.address)
    }

    pub(crate) fn requests(&self) -> usize {
        lock(&self.state).received.len()
    }

    pub(crate) fn received(&self) -> Vec<String> {
        lock(&self.state).received.clone()
    }
}
