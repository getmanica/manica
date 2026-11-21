use std::{path::Path, sync::Arc};

use crate::{
    checks::{Check, Status, fail, ok},
    config::{Config, load_config},
    plane::{Plane, PlaneError, http_client},
    vm::{
        backend::{VmBackend, platform},
        backends::BackendName,
    },
};

/// A group of checks, as printed under one heading. Checks of a section
/// that doesn't count (a VM backend the config doesn't use) don't fail
/// doctor.
#[derive(Debug)]
pub struct Section {
    pub title: String,
    pub checks: Vec<Check>,
    pub counts: bool,
}

/// Whether the plane is reachable and takes the token, through the
/// heartbeat, which only marks the agent seen (see `Plane::heartbeat`).
pub async fn check_plane(config: &Config) -> Check {
    let client = match http_client() {
        Ok(client) => client,
        Err(error) => return fail(format!("can't reach the plane: {error}")),
    };
    let plane = Plane::new(&config.plane, client);
    let origin = plane.origin().to_owned();
    match plane.heartbeat().await {
        Ok(()) => ok(format!("{origin} accepted the agent token")),
        Err(PlaneError::Unauthorized) => fail(format!("{origin} rejected the agent token"))
            .hint("regenerate it in the console and update plane.token (or MANICA_AGENT_TOKEN)"),
        Err(error) => fail(format!("{origin} can't be reached: {error}")),
    }
}

fn check_data_dir(dir: &Path) -> Check {
    let probe = dir.join(format!(".doctor-{}", std::process::id()));
    let written = std::fs::create_dir_all(dir)
        .and_then(|()| std::fs::write(&probe, ""))
        .and_then(|()| std::fs::remove_file(&probe));
    match written {
        Ok(()) => ok(format!("data directory {} is writable", dir.display())),
        Err(error) => fail(format!(
            "data directory {} isn't writable: {error}",
            dir.display()
        )),
    }
}

/// VM backends to check, by name.
pub type Backends = Vec<(BackendName, Arc<dyn VmBackend>)>;

/// Every backend the agent knows, as configured by default.
#[must_use]
pub fn all_backends() -> Backends {
    BackendName::ALL
        .iter()
        .map(|name| (*name, name.create()))
        .collect()
}

/// Checks what the agent needs to run jobs, and which VM backends this
/// machine can use: everything `manica-agent` would trip on, without taking
/// a job.
pub async fn diagnose(
    config_dir: &Path,
    backends: Backends,
    check_plane: impl AsyncFnOnce(&Config) -> Check,
) -> Vec<Section> {
    let mut sections = Vec::new();
    let config = match load_config(config_dir) {
        Ok(config) => {
            sections.push(Section {
                title: "Config".into(),
                checks: vec![ok(config_dir.join("config.toml").display().to_string())],
                counts: true,
            });
            Some(config)
        }
        Err(error) => {
            sections.push(Section {
                title: "Config".into(),
                checks: vec![fail(error.to_string())],
                counts: true,
            });
            None
        }
    };

    if let Some(config) = &config {
        sections.push(Section {
            title: "Plane".into(),
            checks: vec![check_plane(config).await],
            counts: true,
        });
    }

    let (os, arch) = platform();
    let mut machine = vec![ok(format!("{os}-{arch}"))];
    if let Some(config) = &config {
        machine.push(check_data_dir(&config.data_dir));
    }
    machine.push(ok(config
        .as_ref()
        .and_then(|config| config.vm.as_ref())
        .map_or_else(
            || "jobs run on this machine, as this user ([vm] isn’t set)".to_owned(),
            |vm| format!("jobs run in {} VMs cloned from {}", vm.backend, vm.image),
        )));
    sections.push(Section {
        title: "This machine".into(),
        checks: machine,
        counts: true,
    });

    let used = config.as_ref().and_then(|config| config.vm.as_ref());
    for (name, backend) in backends {
        let image = used
            .filter(|vm| vm.backend == name)
            .map(|vm| vm.image.as_str());
        let counts = used.is_some_and(|vm| vm.backend == name);
        sections.push(Section {
            title: if counts {
                format!("VM backend: {name}")
            } else {
                format!("VM backend: {name} (not used)")
            },
            checks: backend.diagnose(image).await,
            counts,
        });
    }
    sections
}

#[must_use]
pub fn format_sections(sections: &[Section]) -> String {
    sections
        .iter()
        .map(|section| {
            let mut lines = vec![section.title.clone()];
            for check in &section.checks {
                let symbol = match check.status {
                    Status::Ok => "✓",
                    Status::Warn => "!",
                    Status::Fail => "✗",
                };
                lines.push(format!("  {symbol} {}", check.message));
                if let Some(hint) = check.hint.as_ref().filter(|_| check.status != Status::Ok) {
                    lines.push(format!("      {hint}"));
                }
            }
            lines.join("\n")
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Whether every check that counts passed (warnings pass).
#[must_use]
pub fn healthy(sections: &[Section]) -> bool {
    sections
        .iter()
        .all(|section| !section.counts || !section.checks.iter().any(Check::failed))
}

#[cfg(test)]
mod tests {
    use crate::lines::lock;
    use std::{
        path::PathBuf,
        sync::{Arc, Mutex},
    };

    use async_trait::async_trait;
    use tokio_util::sync::CancellationToken;

    use super::*;
    use crate::{
        checks::warn,
        test_support::{temp_dir, write_config},
        vm::{
            backend::{ExecOptions, GuestProcess},
            errors::VmError,
        },
    };

    /// A backend that only diagnoses, recording the images it's asked about.
    #[derive(Debug)]
    struct Diagnosing {
        checks: Vec<Check>,
        images: Images,
    }

    #[async_trait]
    impl VmBackend for Diagnosing {
        fn name(&self) -> &'static str {
            "lima"
        }
        fn namespace(&self) -> &Path {
            Path::new("/unused")
        }
        async fn diagnose(&self, image: Option<&str>) -> Vec<Check> {
            lock(&self.images).push(image.map(str::to_owned));
            self.checks.clone()
        }
        async fn clone_vm(
            &self,
            _: &str,
            _: &str,
            _: Option<&CancellationToken>,
        ) -> Result<(), VmError> {
            Ok(())
        }
        async fn start(&self, _: &str, _: Option<&CancellationToken>) -> Result<(), VmError> {
            Ok(())
        }
        fn exec(&self, vm: &str, _: &[&str], _: ExecOptions) -> Result<GuestProcess, VmError> {
            Err(VmError::GuestCopy {
                vm: vm.to_owned(),
                reason: "doctor runs nothing in guests".to_owned(),
            })
        }
        async fn delete(&self, _: &str) -> Result<(), VmError> {
            Ok(())
        }
        async fn list(&self) -> Result<Vec<String>, VmError> {
            Ok(Vec::new())
        }
    }

    type Images = Arc<Mutex<Vec<Option<String>>>>;

    fn backend(checks: Vec<Check>) -> (Backends, Images) {
        let images = Images::default();
        let backend = Diagnosing {
            checks,
            images: Arc::clone(&images),
        };
        (vec![(BackendName::Lima, Arc::new(backend))], images)
    }

    fn config_dir(extra: &str) -> PathBuf {
        let dir = temp_dir();
        let data_dir = dir.join("data");
        write_config(
            &dir,
            &format!(
                "[plane]\nurl = \"http://plane.test\"\ntoken = \"mna_x\"\n\n[agent]\ndata_dir = \"{}\"\n{extra}",
                data_dir.display()
            ),
        );
        dir
    }

    async fn plane(_: &Config) -> Check {
        ok("http://plane.test accepted the agent token")
    }

    #[tokio::test]
    async fn a_config_without_vm_doesnt_fail_on_a_missing_backend() {
        let (backends, images) = backend(vec![fail("limactl not found").hint("install Lima")]);
        let sections = diagnose(&config_dir(""), backends, plane).await;
        assert!(healthy(&sections));
        assert_eq!(*lock(&images), [None]);
        let text = format_sections(&sections);
        assert!(
            text.contains("VM backend: lima (not used)\n  ✗ limactl not found\n      install Lima"),
            "{text}"
        );
        assert!(text.contains("jobs run on this machine"));
    }

    #[tokio::test]
    async fn the_backend_vm_uses_is_checked_with_its_image_and_counts() {
        let (backends, images) = backend(vec![
            ok("Lima 2.3.0"),
            fail("no Lima instance named golden"),
        ]);
        let sections = diagnose(
            &config_dir("\n[vm]\nbackend = \"lima\"\nimage = \"golden\"\n"),
            backends,
            plane,
        )
        .await;
        assert_eq!(*lock(&images), [Some("golden".to_owned())]);
        assert!(!healthy(&sections));
        assert!(format_sections(&sections).contains("VM backend: lima\n"));
    }

    #[tokio::test]
    async fn warnings_dont_fail() {
        let (backends, _) = backend(vec![warn("2 VMs running")]);
        let sections = diagnose(
            &config_dir("\n[vm]\nbackend = \"lima\"\nimage = \"golden\"\n"),
            backends,
            plane,
        )
        .await;
        assert!(healthy(&sections));
    }

    #[tokio::test]
    async fn a_missing_config_fails_and_the_rest_still_runs() {
        let (backends, _) = backend(vec![ok("Lima 2.3.0")]);
        let sections = diagnose(&temp_dir(), backends, plane).await;
        assert!(!healthy(&sections));
        let titles: Vec<&str> = sections
            .iter()
            .map(|section| section.title.as_str())
            .collect();
        assert_eq!(
            titles,
            ["Config", "This machine", "VM backend: lima (not used)"]
        );
    }
}
