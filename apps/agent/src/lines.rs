//! Where lines of output go: the agent's own log, a runner's output, a
//! test's buffer.
use std::{
    fmt,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
};

use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};

/// Somewhere lines go.
#[derive(Clone)]
pub struct Log(Arc<dyn Fn(&str) + Send + Sync>);

impl fmt::Debug for Log {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Log")
    }
}

impl Log {
    pub fn new(log: impl Fn(&str) + Send + Sync + 'static) -> Self {
        Self(Arc::new(log))
    }

    /// The agent's own log, on stdout.
    #[must_use]
    pub fn stdout() -> Self {
        Self::new(info)
    }

    /// A log that drops everything.
    #[must_use]
    pub fn none() -> Self {
        Self::new(|_| {})
    }

    pub fn line(&self, line: &str) {
        (self.0)(line);
    }

    /// The same log, each line prefixed.
    #[must_use]
    pub fn prefixed(&self, prefix: String) -> Self {
        let log = self.clone();
        Self::new(move |line| log.line(&format!("{prefix}{line}")))
    }
}

/// A line of the agent's own log, on stdout.
#[expect(clippy::print_stdout, reason = "the agent's log is its stdout")]
pub fn info(line: &str) {
    println!("{line}");
}

/// A problem, on stderr.
#[expect(clippy::print_stderr, reason = "the agent's problems go to its stderr")]
pub fn error(line: &str) {
    eprintln!("{line}");
}

/// Calls `log` with each line `stream` carries, until it closes. Lines are
/// decoded as UTF-8, lossily.
pub async fn forward_lines(stream: impl AsyncRead + Unpin, log: Log) {
    let mut reader = BufReader::new(stream);
    let mut line = Vec::new();
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line).await {
            Ok(0) | Err(_) => return,
            Ok(_) => {
                if line.last() == Some(&b'\n') {
                    line.pop();
                }
                log.line(&String::from_utf8_lossy(&line));
            }
        }
    }
}

/// Locks `mutex`, even if a thread panicked holding it: what it guards here
/// stays consistent whatever a panicking thread did (and release builds
/// abort on panic anyway).
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}
