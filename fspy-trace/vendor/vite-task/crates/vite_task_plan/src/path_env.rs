use std::{
    env::{JoinPathsError, join_paths, split_paths},
    ffi::OsStr,
    iter,
    sync::Arc,
};

use rustc_hash::FxHashMap;
use vite_path::AbsolutePath;

/// Get the PATH environment variable from the given envs map.
/// On Windows, this function performs a case-insensitive search for "PATH".
/// On Unix, it performs a case-sensitive search.
#[must_use]
#[expect(clippy::implicit_hasher, reason = "function is specific to FxHashMap")]
pub fn get_path_env(envs: &FxHashMap<Arc<OsStr>, Arc<OsStr>>) -> Option<&Arc<OsStr>> {
    if cfg!(windows) {
        // On Windows, environment variable names are case-insensitive (e.g., "PATH", "Path", "path" are all the same)
        // However, Rust's HashMap keys are case-sensitive, so we need to find the existing PATH variable
        // regardless of its casing.
        envs.iter().find_map(
            |(name, value)| {
                if name.eq_ignore_ascii_case("path") { Some(value) } else { None }
            },
        )
    } else {
        // On Unix, environment variable names are case-sensitive
        envs.get(OsStr::new("PATH"))
    }
}

/// Prepend a path to the PATH environment variable.
///
/// # Errors
/// Returns an error if the paths cannot be joined.
#[expect(clippy::implicit_hasher, reason = "function is specific to FxHashMap")]
pub fn prepend_path_env(
    envs: &mut FxHashMap<Arc<OsStr>, Arc<OsStr>>,
    path_to_prepend: &AbsolutePath,
) -> Result<(), JoinPathsError> {
    // Add node_modules/.bin to PATH
    // On Windows, environment variable names are case-insensitive (e.g., "PATH", "Path", "path" are all the same)
    // However, Rust's HashMap keys are case-sensitive, so we need to find the existing PATH variable
    // regardless of its casing to avoid creating duplicate PATH entries with different casings.
    // For example, if the system has "Path", we should use that instead of creating a new "PATH" entry.
    let env_path = {
        if cfg!(windows)
            && let Some(existing_path) = envs.iter_mut().find_map(|(name, value)| {
                if name.eq_ignore_ascii_case("path") { Some(value) } else { None }
            })
        {
            // Found existing PATH variable (with any casing), use it
            existing_path
        } else {
            // On Unix or no existing PATH on Windows, create/get "PATH" entry
            envs.entry(Arc::from(OsStr::new("PATH")))
                .or_insert_with(|| Arc::<OsStr>::from(OsStr::new("")))
        }
    };

    let existing_paths = split_paths(env_path);
    let paths = iter::once(path_to_prepend.as_path().to_path_buf()).chain(existing_paths.filter(
        // remove duplicates
        |path| path != path_to_prepend.as_path(),
    ));

    let new_path_value = join_paths(paths)?;
    *env_path = new_path_value.into();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_envs(pairs: Vec<(&str, &str)>) -> FxHashMap<Arc<OsStr>, Arc<OsStr>> {
        pairs
            .into_iter()
            .map(|(k, v)| (Arc::from(OsStr::new(k)), Arc::from(OsStr::new(v))))
            .collect()
    }

    #[test]
    #[cfg(windows)]
    fn test_windows_path_case_insensitive_mixed_case() {
        let mut envs = create_test_envs(vec![("Path", "C:\\existing\\path")]);
        let path_to_prepend =
            AbsolutePath::new("C:\\workspace\\packages\\app\\node_modules\\.bin").unwrap();

        prepend_path_env(&mut envs, path_to_prepend).unwrap();

        // Verify that the original "Path" casing is preserved, not "PATH"
        assert!(envs.contains_key(OsStr::new("Path")));
        assert!(!envs.contains_key(OsStr::new("PATH")));

        // Verify the PATH value has node_modules/.bin prepended
        let path_value = envs.get(OsStr::new("Path")).unwrap();
        assert!(path_value.to_str().unwrap().contains("node_modules\\.bin"));
        assert!(path_value.to_str().unwrap().contains("C:\\existing\\path"));

        // Verify no duplicate PATH entry was created
        assert_eq!(
            envs.keys()
                .filter(|k| k.to_str().is_some_and(|s| s.eq_ignore_ascii_case("path")))
                .count(),
            1
        );
    }

    #[test]
    #[cfg(windows)]
    fn test_windows_path_case_insensitive_uppercase() {
        let mut envs = create_test_envs(vec![("PATH", "C:\\existing\\path")]);
        let path_to_prepend =
            AbsolutePath::new("C:\\workspace\\packages\\app\\node_modules\\.bin").unwrap();

        prepend_path_env(&mut envs, path_to_prepend).unwrap();

        // Verify the PATH value has node_modules/.bin prepended
        let path_value = envs.get(OsStr::new("PATH")).unwrap();
        assert!(path_value.to_str().unwrap().contains("node_modules\\.bin"));
        assert!(path_value.to_str().unwrap().contains("C:\\existing\\path"));
    }

    #[test]
    #[cfg(windows)]
    fn test_windows_path_created_when_missing() {
        let mut envs = create_test_envs(vec![]);
        let path_to_prepend =
            AbsolutePath::new("C:\\workspace\\packages\\app\\node_modules\\.bin").unwrap();

        prepend_path_env(&mut envs, path_to_prepend).unwrap();

        // Verify PATH was created with only node_modules/.bin
        let path_value = envs.get(OsStr::new("PATH")).unwrap();
        assert!(path_value.to_str().unwrap().contains("node_modules\\.bin"));
    }

    #[test]
    #[cfg(unix)]
    fn test_unix_path_case_sensitive() {
        let mut envs = create_test_envs(vec![("PATH", "/existing/path")]);
        let path_to_prepend =
            AbsolutePath::new("/workspace/packages/app/node_modules/.bin").unwrap();

        prepend_path_env(&mut envs, path_to_prepend).unwrap();

        // Verify "PATH" exists and the complete value has node_modules/.bin prepended
        let path_value = envs.get(OsStr::new("PATH")).unwrap();
        let path_str = path_value.to_str().unwrap();
        assert!(path_str.contains("node_modules/.bin"));
        assert!(path_str.contains("/existing/path"));

        // Verify that on Unix, the code uses exact "PATH" match (case-sensitive)
        assert!(!envs.contains_key(OsStr::new("Path")));
        assert!(!envs.contains_key(OsStr::new("path")));
    }

    #[test]
    #[cfg(unix)]
    fn test_prepend_paths_removes_duplicates() {
        let mut envs = create_test_envs(vec![("PATH", "/workspace/node_modules/.bin:/other/path")]);
        let path_to_prepend = AbsolutePath::new("/workspace/node_modules/.bin").unwrap();

        prepend_path_env(&mut envs, path_to_prepend).unwrap();

        let path_value = envs.get(OsStr::new("PATH")).unwrap();
        let path_str = path_value.to_str().unwrap();

        // Should only have one occurrence of node_modules/.bin (duplicates removed)
        let node_modules_count = path_str.matches("/workspace/node_modules/.bin").count();
        assert_eq!(node_modules_count, 1, "Duplicate paths should be removed");
    }
}
