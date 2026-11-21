//! Errors driving a VM backend fails with. A job whose VM fails is given up
//! on and reported as exited; the agent keeps going.

#[derive(Debug, thiserror::Error)]
pub enum VmError {
    #[error(
        "{} {}{}",
        argv.iter().take(2).cloned().collect::<Vec<_>>().join(" "),
        exit_code.map_or_else(|| "could not be started".to_owned(), |code| format!("exited with {code}")),
        last_lines(stderr)
    )]
    Command {
        argv: Vec<String>,
        /// None if it couldn't be started at all.
        exit_code: Option<i32>,
        stderr: String,
    },

    /// A job's VM would share something with the host (a directory,
    /// forwarded credentials), from the backend's own config: it isn't
    /// started.
    #[error("{vm} isn't isolated from the host: {}", reasons.join("; "))]
    Isolation { vm: String, reasons: Vec<String> },

    #[error("Copying the runner into {vm} failed: {reason}")]
    GuestCopy { vm: String, reason: String },

    /// VMs of finished jobs that couldn't be deleted: no new job starts
    /// until they are, so they can't pile up past what the Mac can run.
    #[error("VMs of finished jobs couldn't be deleted yet: {}", vms.join(", "))]
    Cleanup { vms: Vec<String> },

    #[error("{command} printed what isn't JSON: {reason}")]
    InvalidOutput { command: String, reason: String },
}

/// The last `count` of `items`, or all of them if there are fewer.
pub fn last<T>(items: &[T], count: usize) -> &[T] {
    items
        .get(items.len().saturating_sub(count)..)
        .unwrap_or(items)
}

fn last_lines(stderr: &str) -> String {
    if stderr.is_empty() {
        return String::new();
    }
    let lines: Vec<&str> = stderr.split('\n').collect();
    format!(": {}", last(&lines, 3).join(" "))
}
