//! Readings of this machine's resources, as the poll reports them: CPU is
//! the busy fraction (0 to 1) of all cores since the previous reading; the
//! rest are bytes.
use std::path::PathBuf;

use async_trait::async_trait;
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};

use crate::{
    api::AgentMetrics,
    vm::command::{RunOptions, run_command},
};

#[async_trait]
pub trait Sampler: std::fmt::Debug + Send {
    async fn sample(&mut self) -> Result<AgentMetrics, String>;
}

/// The value of `label` in `vm_stat`'s output, in pages.
fn pages(output: &str, label: &str) -> Result<u64, String> {
    output
        .lines()
        .find_map(|line| {
            let value = line.strip_prefix(label)?.strip_prefix(':')?;
            value.trim().strip_suffix('.')?.parse().ok()
        })
        .ok_or_else(|| format!("vm_stat reported no \"{label}\""))
}

/// Used memory from `vm_stat`'s output, as Activity Monitor counts it.
///
/// macOS counts the file cache as used, so a plain reading of free memory
/// reads near full on a machine that isn't: used memory is app memory
/// (anonymous pages that can't be purged), wired and compressed.
///
/// # Errors
///
/// If the output lacks what it's read from.
pub fn parse_vm_stat(output: &str, total: u64) -> Result<u64, String> {
    let page_size: u64 = output
        .split_once("page size of ")
        .and_then(|(_, rest)| rest.split_whitespace().next()?.parse().ok())
        .filter(|size| *size > 0)
        .ok_or("vm_stat reported no page size")?;
    let used = pages(output, "Anonymous pages")?
        .saturating_sub(pages(output, "Pages purgeable")?)
        .saturating_add(pages(output, "Pages wired down")?)
        .saturating_add(pages(output, "Pages occupied by compressor")?)
        .saturating_mul(page_size);
    Ok(used.min(total))
}

/// Used memory from `/proc/meminfo`: Linux's `MemAvailable` counts the
/// reclaimable cache as free.
///
/// # Errors
///
/// If it lacks `MemAvailable`.
pub fn parse_meminfo(meminfo: &str, total: u64) -> Result<u64, String> {
    let available: u64 = meminfo
        .lines()
        .find_map(|line| {
            let value = line.strip_prefix("MemAvailable:")?.trim();
            value.strip_suffix("kB")?.trim().parse().ok()
        })
        .ok_or("/proc/meminfo reported no MemAvailable")?;
    Ok(total.saturating_sub(available.saturating_mul(1024)))
}

/// Reads this machine's metrics.
///
/// CPU is since the previous reading (the first since the sampler was
/// made); the disk is the one the data directory is on, where runner builds
/// and VMs live.
#[derive(Debug)]
pub struct SystemSampler {
    data_dir: PathBuf,
    system: System,
}

impl SystemSampler {
    /// # Errors
    ///
    /// If this machine's resources can't be read.
    pub fn new(data_dir: PathBuf) -> Result<Self, String> {
        let system = System::new_with_specifics(
            RefreshKind::nothing()
                .with_cpu(CpuRefreshKind::nothing().with_usage())
                .with_memory(MemoryRefreshKind::nothing().with_ram()),
        )
        .map_err(|error| format!("reading this machine's resources failed: {error}"))?;
        Ok(Self { data_dir, system })
    }

    async fn memory_used(&self, total: u64) -> Result<u64, String> {
        if cfg!(target_os = "macos") {
            let output = run_command(&["vm_stat".to_owned()], RunOptions::default())
                .await
                .map_err(|error| error.to_string())?;
            parse_vm_stat(&output.stdout, total)
        } else if cfg!(target_os = "linux") {
            let meminfo = tokio::fs::read_to_string("/proc/meminfo")
                .await
                .map_err(|error| format!("reading /proc/meminfo failed: {error}"))?;
            parse_meminfo(&meminfo, total)
        } else {
            Ok(total.saturating_sub(self.system.available_memory()))
        }
    }

    /// The volume the data directory is on: the space available to the
    /// agent, not the blocks only root can use, so a full disk reads as
    /// full. A fresh agent makes its data directory with its first job: it's
    /// made here if it isn't yet.
    #[allow(
        clippy::useless_conversion,
        reason = "statvfs's field types differ by platform"
    )]
    async fn disk(&self) -> Result<(u64, u64), String> {
        let dir = self.data_dir.clone();
        tokio::task::spawn_blocking(move || {
            std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
            let stats = nix::sys::statvfs::statvfs(&dir).map_err(|error| error.to_string())?;
            let unit = u64::from(stats.fragment_size());
            let total = u64::from(stats.blocks()).saturating_mul(unit);
            let available = u64::from(stats.blocks_available()).saturating_mul(unit);
            Ok((total.saturating_sub(available), total))
        })
        .await
        .map_err(|error| error.to_string())?
    }
}

#[async_trait]
impl Sampler for SystemSampler {
    async fn sample(&mut self) -> Result<AgentMetrics, String> {
        self.system.refresh_cpu_usage();
        self.system.refresh_memory();
        let cpu = f64::from(self.system.global_cpu_usage()) / 100.0;
        let memory_total = self.system.total_memory();
        let memory_used = self.memory_used(memory_total).await?;
        let (disk_used, disk_total) = self.disk().await?;
        let bytes = |value: u64| i64::try_from(value).unwrap_or(i64::MAX);
        Ok(AgentMetrics {
            cpu: if cpu.is_finite() {
                cpu.clamp(0.0, 1.0)
            } else {
                0.0
            },
            memory_used: bytes(memory_used),
            memory_total: bytes(memory_total),
            disk_used: bytes(disk_used),
            disk_total: bytes(disk_total),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::temp_dir;

    const GIB: u64 = 1 << 30;

    #[test]
    fn reads_used_memory_from_vm_stat_as_activity_monitor_does() {
        let output = "Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                     7133.
Pages active:                                 398940.
Pages inactive:                               396744.
Pages wired down:                             181591.
Pages purgeable:                                3289.
File-backed pages:                            269097.
Anonymous pages:                              527612.
Pages occupied by compressor:                 533445.
";
        // App memory (anonymous less purgeable), wired and compressed.
        let pages = 527_612 - 3289 + 181_591 + 533_445;
        assert_eq!(parse_vm_stat(output, 24 * GIB), Ok(pages * 16384));
        assert_eq!(parse_vm_stat(output, GIB), Ok(GIB));
        assert!(
            parse_vm_stat("Pages free: 1.", GIB)
                .unwrap_err()
                .contains("page size")
        );
    }

    #[test]
    fn reads_used_memory_from_proc_meminfo() {
        let meminfo = "MemTotal:  16384000 kB\nMemAvailable:  4194304 kB\n";
        assert_eq!(parse_meminfo(meminfo, 16 * GIB), Ok(12 * GIB));
        assert!(
            parse_meminfo("MemTotal: 1 kB\n", GIB)
                .unwrap_err()
                .contains("MemAvailable")
        );
    }

    #[tokio::test]
    async fn reads_this_machine() {
        let metrics = SystemSampler::new(std::env::temp_dir())
            .unwrap()
            .sample()
            .await
            .unwrap();
        assert!((0.0..=1.0).contains(&metrics.cpu));
        assert!(metrics.memory_used > 0);
        assert!(metrics.memory_used <= metrics.memory_total);
        assert!(metrics.disk_used > 0);
        assert!(metrics.disk_used <= metrics.disk_total);
    }

    #[tokio::test]
    async fn reads_the_disk_of_a_data_directory_no_job_has_made_yet() {
        let data_dir = temp_dir().join("not").join("yet");
        let metrics = SystemSampler::new(data_dir)
            .unwrap()
            .sample()
            .await
            .unwrap();
        assert!(metrics.disk_total > 0);
    }
}
