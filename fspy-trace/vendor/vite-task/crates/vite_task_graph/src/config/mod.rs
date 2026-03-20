pub mod user;

use std::{collections::BTreeSet, sync::Arc};

use bincode::{Decode, Encode};
use monostate::MustBe;
use rustc_hash::FxHashSet;
use serde::Serialize;
pub use user::{
    EnabledCacheConfig, ResolvedGlobalCacheConfig, UserCacheConfig, UserGlobalCacheConfig,
    UserInputEntry, UserInputsConfig, UserRunConfig, UserTaskConfig,
};
use vite_path::AbsolutePath;
use vite_str::Str;

use crate::config::user::UserTaskOptions;

/// Task configuration resolved from `package.json` scripts and/or `vite.config.ts` tasks,
/// without considering external factors like additional args from cli or environment variables.
///
/// It should resolve as much as possible to the final form to save duplicated work when it's further resolved into a spawnable command later.
/// but must be independent of external factors.
///
/// For example, `cwd` is resolved to absolute ones (no external factor can change it),
/// but `command` is not parsed into program and args yet because environment variables in it may need to be expanded.
///
/// `depends_on` is not included here because it's represented by the edges of the task graph.
#[derive(Debug, Serialize)]
pub struct ResolvedTaskConfig {
    /// The command to run for this task, as a raw string.
    ///
    /// The command may contain environment variables that need to be expanded later.
    pub command: Str,

    pub resolved_options: ResolvedTaskOptions,
}

#[derive(Debug, Serialize)]
pub struct ResolvedTaskOptions {
    /// The working directory for the task
    pub cwd: Arc<AbsolutePath>,
    /// Cache-related config. None means caching is disabled.
    pub cache_config: Option<CacheConfig>,
}

impl ResolvedTaskOptions {
    /// Resolves from user-defined options and the directory path where the options are defined.
    /// For user-defined tasks or scripts in package.json, `dir` is the package directory
    /// For synthetic tasks, `dir` is the cwd of the original command (e.g. the cwd of `vp lint`).
    ///
    /// # Errors
    ///
    /// Returns [`ResolveTaskConfigError`] if a glob pattern is invalid or resolves
    /// outside the workspace root.
    pub fn resolve(
        user_options: UserTaskOptions,
        dir: &Arc<AbsolutePath>,
        workspace_root: &AbsolutePath,
    ) -> Result<Self, ResolveTaskConfigError> {
        let cwd: Arc<AbsolutePath> = match user_options.cwd_relative_to_package {
            Some(ref cwd) if !cwd.as_str().is_empty() => dir.join(cwd).into(),
            _ => Arc::clone(dir),
        };
        let cache_config = match user_options.cache_config {
            UserCacheConfig::Disabled { cache: MustBe!(false) } => None,
            UserCacheConfig::Enabled { cache: _, enabled_cache_config } => {
                let mut untracked_env: FxHashSet<Str> =
                    enabled_cache_config.untracked_env.unwrap_or_default().into_iter().collect();
                untracked_env.extend(DEFAULT_UNTRACKED_ENV.iter().copied().map(Str::from));

                let input_config = ResolvedInputConfig::from_user_config(
                    enabled_cache_config.input.as_ref(),
                    dir,
                    workspace_root,
                )?;

                Some(CacheConfig {
                    env_config: EnvConfig {
                        fingerprinted_envs: enabled_cache_config
                            .env
                            .map(|e| e.into_vec().into_iter().collect())
                            .unwrap_or_default(),
                        untracked_env,
                    },
                    input_config,
                })
            }
        };
        Ok(Self { cwd, cache_config })
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct CacheConfig {
    pub env_config: EnvConfig,
    pub input_config: ResolvedInputConfig,
}

/// Resolved input configuration for cache fingerprinting.
///
/// This is the normalized form after parsing user config.
/// - `includes_auto`: Whether automatic file tracking is enabled
/// - `positive_globs`: Glob patterns for files to include (without `!` prefix)
/// - `negative_globs`: Glob patterns for files to exclude (without `!` prefix)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Encode, Decode)]
pub struct ResolvedInputConfig {
    /// Whether automatic file tracking is enabled
    pub includes_auto: bool,

    /// Positive glob patterns (files to include), relative to the workspace root.
    /// Sorted for deterministic cache keys.
    pub positive_globs: BTreeSet<Str>,

    /// Negative glob patterns (files to exclude, without the `!` prefix), relative to the workspace root.
    /// Sorted for deterministic cache keys.
    pub negative_globs: BTreeSet<Str>,
}

impl ResolvedInputConfig {
    /// Default configuration: auto-inference enabled, no explicit patterns
    #[must_use]
    pub const fn default_auto() -> Self {
        Self {
            includes_auto: true,
            positive_globs: BTreeSet::new(),
            negative_globs: BTreeSet::new(),
        }
    }

    /// Resolve from user configuration, making glob patterns workspace-root-relative.
    ///
    /// - `None`: defaults to auto-inference (`[{auto: true}]`)
    /// - `Some([])`: no inputs, inference disabled
    /// - `Some([...])`: explicit patterns resolved to workspace-root-relative
    ///
    /// # Errors
    ///
    /// Returns [`ResolveTaskConfigError`] if a glob pattern is invalid or resolves
    /// outside the workspace root.
    pub fn from_user_config(
        user_inputs: Option<&UserInputsConfig>,
        package_dir: &AbsolutePath,
        workspace_root: &AbsolutePath,
    ) -> Result<Self, ResolveTaskConfigError> {
        let Some(entries) = user_inputs else {
            // None means default to auto-inference
            return Ok(Self::default_auto());
        };

        let mut includes_auto = false;
        let mut positive_globs = BTreeSet::new();
        let mut negative_globs = BTreeSet::new();

        for entry in entries {
            match entry {
                UserInputEntry::Auto { auto: true } => includes_auto = true,
                UserInputEntry::Auto { auto: false } => {} // Ignore {auto: false}
                UserInputEntry::Glob(pattern) => {
                    if let Some(negated) = pattern.strip_prefix('!') {
                        let resolved = resolve_glob_to_workspace_relative(
                            negated,
                            package_dir,
                            workspace_root,
                        )?;
                        negative_globs.insert(resolved);
                    } else {
                        let resolved = resolve_glob_to_workspace_relative(
                            pattern.as_str(),
                            package_dir,
                            workspace_root,
                        )?;
                        positive_globs.insert(resolved);
                    }
                }
            }
        }

        Ok(Self { includes_auto, positive_globs, negative_globs })
    }
}

/// Resolve a single glob pattern to be workspace-root-relative.
///
/// The algorithm:
/// 1. Partition the glob into an invariant prefix and a variant part
/// 2. Join the invariant prefix with `package_dir` and clean the path
/// 3. Strip the `workspace_root` prefix from the cleaned path
/// 4. Re-escape the stripped prefix and rejoin with the variant
fn resolve_glob_to_workspace_relative(
    pattern: &str,
    package_dir: &AbsolutePath,
    workspace_root: &AbsolutePath,
) -> Result<Str, ResolveTaskConfigError> {
    // A trailing `/` is shorthand for all files under that directory
    let expanded: Str;
    let pattern = if pattern.ends_with('/') {
        expanded = vite_str::format!("{pattern}**");
        expanded.as_str()
    } else {
        pattern
    };

    let glob = wax::Glob::new(pattern).map_err(|source| ResolveTaskConfigError::InvalidGlob {
        pattern: Str::from(pattern),
        source: Box::new(source),
    })?;
    let (invariant_prefix, variant) = glob.partition();

    let joined = package_dir.join(&invariant_prefix).clean();
    let stripped = joined.strip_prefix(workspace_root).map_err(|_| {
        ResolveTaskConfigError::GlobOutsideWorkspace { pattern: Str::from(pattern) }
    })?;

    // Re-escape the prefix path for use in a glob pattern
    let stripped = stripped.ok_or_else(|| ResolveTaskConfigError::GlobOutsideWorkspace {
        pattern: Str::from(pattern),
    })?;

    let escaped_prefix = wax::escape(stripped.as_str());

    let result = match variant {
        Some(variant_glob) if escaped_prefix.is_empty() => {
            Str::from(variant_glob.to_string().as_str())
        }
        Some(variant_glob) => vite_str::format!("{escaped_prefix}/{variant_glob}"),
        None if escaped_prefix.is_empty() => Str::from("**"),
        None => Str::from(escaped_prefix.as_ref()),
    };

    Ok(result)
}

#[derive(Debug, Clone, Serialize)]
pub struct EnvConfig {
    /// environment variable names to be fingerprinted and passed to the task, with defaults populated
    pub fingerprinted_envs: FxHashSet<Str>,
    /// environment variable names to be passed to the task without fingerprinting, with defaults populated
    pub untracked_env: FxHashSet<Str>,
}

#[derive(Debug, thiserror::Error)]
pub enum ResolveTaskConfigError {
    /// A glob pattern resolves to a path outside the workspace root
    #[error("glob pattern '{pattern}' resolves outside the workspace root")]
    GlobOutsideWorkspace { pattern: Str },

    /// A glob pattern is invalid
    #[error("invalid glob pattern '{pattern}'")]
    InvalidGlob {
        pattern: Str,
        #[source]
        source: Box<wax::BuildError>,
    },
}

impl ResolvedTaskConfig {
    /// Resolve from package.json script only (no config entry for this task).
    ///
    /// Always resolves with caching enabled (default settings).
    /// The global cache config is applied at plan time, not here.
    ///
    /// # Errors
    ///
    /// Returns [`ResolveTaskConfigError`] if glob resolution fails.
    pub fn resolve_package_json_script(
        package_dir: &Arc<AbsolutePath>,
        package_json_script: &str,
        workspace_root: &AbsolutePath,
    ) -> Result<Self, ResolveTaskConfigError> {
        Ok(Self {
            command: package_json_script.into(),
            resolved_options: ResolvedTaskOptions::resolve(
                UserTaskOptions::default(),
                package_dir,
                workspace_root,
            )?,
        })
    }

    /// Resolves from user config and package dir.
    ///
    /// # Errors
    ///
    /// Returns [`ResolveTaskConfigError`] if glob resolution fails.
    pub fn resolve(
        user_config: UserTaskConfig,
        package_dir: &Arc<AbsolutePath>,
        workspace_root: &AbsolutePath,
    ) -> Result<Self, ResolveTaskConfigError> {
        Ok(Self {
            command: Str::from(user_config.command.as_ref()),
            resolved_options: ResolvedTaskOptions::resolve(
                user_config.options,
                package_dir,
                workspace_root,
            )?,
        })
    }
}

// Exact matches for common environment variables
// Referenced from Turborepo's implementation:
// https://github.com/vercel/turborepo/blob/06ba8e2f7b8d7c7ff99edff7114e2584713e18c4/crates/turborepo-env/src/lib.rs#L20
#[doc(hidden)] // exported for redacting snapshots in tests
pub const DEFAULT_UNTRACKED_ENV: &[&str] = &[
    // System and shell
    "HOME",
    "USER",
    "TZ",
    "LANG",
    "SHELL",
    "PWD",
    "PATH",
    // Linux/X11 session
    "XDG_RUNTIME_DIR",
    "XAUTHORITY",
    "DBUS_SESSION_BUS_ADDRESS",
    // CI/CD environments
    "CI",
    // Node.js specific
    "NODE_OPTIONS",
    "COREPACK_*",
    "NPM_CONFIG_STORE_DIR",
    "PNPM_HOME",
    // Library paths
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "DYLD_FALLBACK_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "LIBPATH",
    // Terminal/display
    "COLORTERM",
    "TERM",
    "TERM_PROGRAM",
    "DISPLAY",
    "FORCE_COLOR",
    "NO_COLOR",
    // Temporary directories
    "TMP",
    "TEMP",
    // Vercel specific
    "VERCEL",
    "VERCEL_*",
    "NEXT_*",
    "USE_OUTPUT_FOR_EDGE_FUNCTIONS",
    "NOW_BUILDER",
    "VC_MICROFRONTENDS_CONFIG_FILE_NAME",
    // GitHub Actions
    "GITHUB_*",
    "RUNNER_*",
    // Windows specific
    "APPDATA",
    "PROGRAMDATA",
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "WINDIR",
    "ProgramFiles",
    "ProgramFiles[(]x86[)]", // Parens escaped for glob syntax (Turborepo uses literal `ProgramFiles(x86)`)
    // IDE specific (exact matches)
    "ELECTRON_RUN_AS_NODE",
    "JB_INTERPRETER",
    "_JETBRAINS_TEST_RUNNER_RUN_SCOPE_TYPE",
    "JB_IDE_*",
    // VSCode specific
    "VSCODE_*",
    // Docker specific
    "DOCKER_*",
    "BUILDKIT_*",
    "COMPOSE_*",
    // Playwright specific
    "PLAYWRIGHT_*",
    // Token patterns
    "*_TOKEN",
];

#[cfg(test)]
mod tests {
    use vite_path::AbsolutePathBuf;

    use super::*;

    fn test_paths() -> (AbsolutePathBuf, AbsolutePathBuf) {
        if cfg!(windows) {
            (
                AbsolutePathBuf::new("C:\\workspace\\packages\\my-pkg".into()).unwrap(),
                AbsolutePathBuf::new("C:\\workspace".into()).unwrap(),
            )
        } else {
            (
                AbsolutePathBuf::new("/workspace/packages/my-pkg".into()).unwrap(),
                AbsolutePathBuf::new("/workspace".into()).unwrap(),
            )
        }
    }

    #[test]
    fn test_resolved_input_config_default_auto() {
        let config = ResolvedInputConfig::default_auto();
        assert!(config.includes_auto);
        assert!(config.positive_globs.is_empty());
        assert!(config.negative_globs.is_empty());
    }

    #[test]
    fn test_resolved_input_config_from_none() {
        let (pkg, ws) = test_paths();
        // None means default to auto-inference
        let config = ResolvedInputConfig::from_user_config(None, &pkg, &ws).unwrap();
        assert!(config.includes_auto);
        assert!(config.positive_globs.is_empty());
        assert!(config.negative_globs.is_empty());
    }

    #[test]
    fn test_resolved_input_config_empty_array() {
        let (pkg, ws) = test_paths();
        // Empty array means no inputs, inference disabled
        let user_inputs = vec![];
        let config = ResolvedInputConfig::from_user_config(Some(&user_inputs), &pkg, &ws).unwrap();
        assert!(!config.includes_auto);
        assert!(config.positive_globs.is_empty());
        assert!(config.negative_globs.is_empty());
    }

    #[test]
    fn test_resolved_input_config_auto_only() {
        let (pkg, ws) = test_paths();
        let user_inputs = vec![UserInputEntry::Auto { auto: true }];
        let config = ResolvedInputConfig::from_user_config(Some(&user_inputs), &pkg, &ws).unwrap();
        assert!(config.includes_auto);
        assert!(config.positive_globs.is_empty());
        assert!(config.negative_globs.is_empty());
    }

    #[test]
    fn test_resolved_input_config_auto_false_ignored() {
        let (pkg, ws) = test_paths();
        let user_inputs = vec![UserInputEntry::Auto { auto: false }];
        let config = ResolvedInputConfig::from_user_config(Some(&user_inputs), &pkg, &ws).unwrap();
        assert!(!config.includes_auto);
        assert!(config.positive_globs.is_empty());
        assert!(config.negative_globs.is_empty());
    }

    #[test]
    fn test_resolved_input_config_globs_only() {
        let (pkg, ws) = test_paths();
        // Globs without auto means inference disabled
        let user_inputs = vec![
            UserInputEntry::Glob("src/**/*.ts".into()),
            UserInputEntry::Glob("package.json".into()),
        ];
        let config = ResolvedInputConfig::from_user_config(Some(&user_inputs), &pkg, &ws).unwrap();
        assert!(!config.includes_auto);
        assert_eq!(config.positive_globs.len(), 2);
        // Globs should now be workspace-root-relative
        assert!(config.positive_globs.contains("packages/my-pkg/src/**/*.ts"));
        assert!(config.positive_globs.contains("packages/my-pkg/package.json"));
        assert!(config.negative_globs.is_empty());
    }

    #[test]
    fn test_resolved_input_config_negative_globs() {
        let (pkg, ws) = test_paths();
        let user_inputs = vec![
            UserInputEntry::Glob("src/**".into()),
            UserInputEntry::Glob("!src/**/*.test.ts".into()),
        ];
        let config = ResolvedInputConfig::from_user_config(Some(&user_inputs), &pkg, &ws).unwrap();
        assert!(!config.includes_auto);
        assert_eq!(config.positive_globs.len(), 1);
        assert!(config.positive_globs.contains("packages/my-pkg/src/**"));
        assert_eq!(config.negative_globs.len(), 1);
        assert!(config.negative_globs.contains("packages/my-pkg/src/**/*.test.ts"));
    }

    #[test]
    fn test_resolved_input_config_mixed() {
        let (pkg, ws) = test_paths();
        let user_inputs = vec![
            UserInputEntry::Glob("package.json".into()),
            UserInputEntry::Auto { auto: true },
            UserInputEntry::Glob("!node_modules/**".into()),
        ];
        let config = ResolvedInputConfig::from_user_config(Some(&user_inputs), &pkg, &ws).unwrap();
        assert!(config.includes_auto);
        assert_eq!(config.positive_globs.len(), 1);
        assert!(config.positive_globs.contains("packages/my-pkg/package.json"));
        assert_eq!(config.negative_globs.len(), 1);
        assert!(config.negative_globs.contains("packages/my-pkg/node_modules/**"));
    }

    #[test]
    fn test_resolved_input_config_globs_with_auto() {
        let (pkg, ws) = test_paths();
        // Globs with auto keeps inference enabled
        let user_inputs =
            vec![UserInputEntry::Glob("src/**/*.ts".into()), UserInputEntry::Auto { auto: true }];
        let config = ResolvedInputConfig::from_user_config(Some(&user_inputs), &pkg, &ws).unwrap();
        assert!(config.includes_auto);
    }

    #[test]
    fn test_resolved_input_config_dotdot_resolution() {
        let (pkg, ws) = test_paths();
        let user_inputs = vec![UserInputEntry::Glob("../shared/src/**".into())];
        let config = ResolvedInputConfig::from_user_config(Some(&user_inputs), &pkg, &ws).unwrap();
        assert_eq!(config.positive_globs.len(), 1);
        assert!(
            config.positive_globs.contains("packages/shared/src/**"),
            "expected 'packages/shared/src/**', got {:?}",
            config.positive_globs
        );
    }

    #[test]
    fn test_resolved_input_config_outside_workspace_error() {
        let (pkg, ws) = test_paths();
        let user_inputs = vec![UserInputEntry::Glob("../../../outside/**".into())];
        let result = ResolvedInputConfig::from_user_config(Some(&user_inputs), &pkg, &ws);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ResolveTaskConfigError::GlobOutsideWorkspace { .. }));
    }
}
