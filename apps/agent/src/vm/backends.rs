use std::sync::Arc;

use super::{
    backend::VmBackend,
    lima::{Lima, LimaOptions},
};

/// The VM backends the agent can drive, by the name `[vm] backend` takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackendName {
    Lima,
}

impl BackendName {
    pub const ALL: &[Self] = &[Self::Lima];

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Lima => "lima",
        }
    }

    #[must_use]
    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL
            .iter()
            .copied()
            .find(|backend| backend.as_str() == name)
    }

    /// The backend, as configured by default (for Lima, the limactl on PATH
    /// and `$LIMA_HOME`).
    #[must_use]
    pub fn create(self) -> Arc<dyn VmBackend> {
        match self {
            Self::Lima => Arc::new(Lima::new(LimaOptions::default())),
        }
    }
}

impl std::fmt::Display for BackendName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}
