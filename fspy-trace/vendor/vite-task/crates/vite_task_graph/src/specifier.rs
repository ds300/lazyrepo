use std::{convert::Infallible, fmt::Display, str::FromStr};

use serde::Serialize;
use vite_str::Str;

/// Parsed task specifier (`"packageName#taskName"` or `"taskName"`)
///
/// For `taskName`, `package_name` will be `None`.
/// For `#taskName`, `package_name` will be `Some("")`. It's valid to have an empty package name.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
pub struct TaskSpecifier {
    pub package_name: Option<Str>,
    pub task_name: Str,
}

impl Display for TaskSpecifier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(package_name) = &self.package_name {
            write!(f, "{package_name}#")?;
        }
        write!(f, "{}", self.task_name)
    }
}

impl TaskSpecifier {
    #[must_use]
    pub fn parse_raw(raw_specifier: &str) -> Self {
        if let Some((package_name, task_name)) = raw_specifier.rsplit_once('#') {
            Self { package_name: Some(Str::from(package_name)), task_name: Str::from(task_name) }
        } else {
            Self { package_name: None, task_name: Str::from(raw_specifier) }
        }
    }
}

impl FromStr for TaskSpecifier {
    type Err = Infallible;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self::parse_raw(s))
    }
}
