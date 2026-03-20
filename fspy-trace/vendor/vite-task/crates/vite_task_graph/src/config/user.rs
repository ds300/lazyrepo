//! Configuration structures for user-defined tasks in `vite.config.*`

use std::sync::Arc;

use monostate::MustBe;
use rustc_hash::FxHashMap;
use serde::Deserialize;
#[cfg(all(test, not(clippy)))]
use ts_rs::TS;
use vite_path::RelativePathBuf;
use vite_str::Str;

/// A single input entry in the `input` array.
///
/// Inputs can be either glob patterns (strings) or auto-inference directives (`{auto: true}`).
#[derive(Debug, Deserialize, PartialEq, Eq, Clone)]
// TS derive macro generates code using std types that clippy disallows; skip derive during linting
#[cfg_attr(all(test, not(clippy)), derive(TS))]
#[serde(untagged)]
pub enum UserInputEntry {
    /// Glob pattern (positive or negative starting with `!`)
    Glob(Str),
    /// Auto-inference directive
    Auto {
        /// Automatically track which files the task reads
        auto: bool,
    },
}

/// The inputs configuration for cache fingerprinting.
///
/// Default (when field omitted): `[{auto: true}]` - infer from file accesses.
pub type UserInputsConfig = Vec<UserInputEntry>;

/// Cache-related fields of a task defined by user in `vite.config.*`
#[derive(Debug, Deserialize, PartialEq, Eq)]
// TS derive macro generates code using std types that clippy disallows; skip derive during linting
#[cfg_attr(all(test, not(clippy)), derive(TS), ts(optional_fields))]
#[serde(untagged, deny_unknown_fields, rename_all = "camelCase")]
pub enum UserCacheConfig {
    /// Cache is enabled
    Enabled {
        /// Whether to cache the task
        #[cfg_attr(all(test, not(clippy)), ts(type = "true", optional))]
        cache: Option<MustBe!(true)>,

        #[serde(flatten)]
        enabled_cache_config: EnabledCacheConfig,
    },
    /// Cache is disabled
    Disabled {
        /// Whether to cache the task
        #[cfg_attr(all(test, not(clippy)), ts(type = "false"))]
        cache: MustBe!(false),
    },
}

impl UserCacheConfig {
    /// Create an enabled cache config with the given `EnabledCacheConfig`.
    #[must_use]
    pub const fn with_config(config: EnabledCacheConfig) -> Self {
        Self::Enabled { cache: Some(MustBe!(true)), enabled_cache_config: config }
    }

    /// Create a disabled cache config.
    #[must_use]
    pub const fn disabled() -> Self {
        Self::Disabled { cache: MustBe!(false) }
    }
}

/// Cache configuration fields when caching is enabled
#[derive(Debug, Deserialize, PartialEq, Eq)]
// TS derive macro generates code using std types that clippy disallows; skip derive during linting
#[cfg_attr(all(test, not(clippy)), derive(TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct EnabledCacheConfig {
    /// Environment variable names to be fingerprinted and passed to the task.
    pub env: Option<Box<[Str]>>,

    /// Environment variable names to be passed to the task without fingerprinting.
    pub untracked_env: Option<Vec<Str>>,

    /// Files to include in the cache fingerprint.
    ///
    /// - Omitted: automatically tracks which files the task reads
    /// - `[]` (empty): disables file tracking entirely
    /// - Glob patterns (e.g. `"src/**"`) select specific files
    /// - `{auto: true}` enables automatic file tracking
    /// - Negative patterns (e.g. `"!dist/**"`) exclude matched files
    ///
    /// Patterns are relative to the package directory.
    #[serde(default)]
    #[cfg_attr(all(test, not(clippy)), ts(inline))]
    pub input: Option<UserInputsConfig>,
}

/// Options for user-defined tasks in `vite.config.*`, excluding the command.
#[derive(Debug, Deserialize, PartialEq, Eq)]
// TS derive macro generates code using std types that clippy disallows; skip derive during linting
#[cfg_attr(all(test, not(clippy)), derive(TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct UserTaskOptions {
    /// The working directory for the task, relative to the package root (not workspace root).
    #[serde(rename = "cwd")]
    pub cwd_relative_to_package: Option<RelativePathBuf>,

    /// Dependencies of this task. Use `package-name#task-name` to refer to tasks in other packages.
    pub depends_on: Option<Arc<[Str]>>,

    /// Cache-related fields
    #[serde(flatten)]
    pub cache_config: UserCacheConfig,
}

impl Default for UserTaskOptions {
    /// The default user task options for package.json scripts.
    fn default() -> Self {
        Self {
            // Runs in the package root
            cwd_relative_to_package: None,
            // No dependencies
            depends_on: None,
            // Caching enabled with no fingerprinted env
            cache_config: UserCacheConfig::Enabled {
                cache: None,
                enabled_cache_config: EnabledCacheConfig {
                    env: None,
                    untracked_env: None,
                    input: None,
                },
            },
        }
    }
}

/// Full user-defined task configuration in `vite.config.*`, including the command and options.
#[derive(Debug, Deserialize, PartialEq, Eq)]
// TS derive macro generates code using std types that clippy disallows; skip derive during linting
#[cfg_attr(all(test, not(clippy)), derive(TS), ts(optional_fields, rename = "Task"))]
#[serde(rename_all = "camelCase")]
pub struct UserTaskConfig {
    /// The command to run for the task.
    pub command: Box<str>,

    /// Fields other than the command
    #[serde(flatten)]
    pub options: UserTaskOptions,
}

/// Root-level cache configuration.
///
/// Controls caching behavior for the entire workspace.
///
/// - `true` is equivalent to `{ scripts: true, tasks: true }` — enables caching for both
///   package.json scripts and task entries.
/// - `false` is equivalent to `{ scripts: false, tasks: false }` — disables all caching.
/// - When omitted, defaults to `{ scripts: false, tasks: true }`.
///
/// This option can only be set in the workspace root's config file.
/// Setting it in a package's config will result in an error.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
// TS derive macro generates code using std types that clippy disallows; skip derive during linting
#[cfg_attr(all(test, not(clippy)), derive(TS), ts(optional_fields))]
#[serde(untagged, deny_unknown_fields)]
pub enum UserGlobalCacheConfig {
    Bool(bool),
    /// Detailed cache configuration with separate control for scripts and tasks.
    Detailed {
        /// Enable caching for package.json scripts not defined in the `tasks` map.
        ///
        /// When `false`, package.json scripts will not be cached.
        /// When `true`, package.json scripts will be cached with default settings.
        ///
        /// Default: `false`
        scripts: Option<bool>,

        /// Global cache kill switch for task entries.
        ///
        /// When `false`, overrides all tasks to disable caching, even tasks with `cache: true`.
        /// When `true`, respects each task's individual `cache` setting
        /// (each task's `cache` defaults to `true` if omitted).
        ///
        /// Default: `true`
        tasks: Option<bool>,
    },
}

/// Resolved global cache configuration with concrete boolean values.
#[derive(Debug, Clone, Copy)]
pub struct ResolvedGlobalCacheConfig {
    pub scripts: bool,
    pub tasks: bool,
}

impl ResolvedGlobalCacheConfig {
    /// Resolve from an optional user config, using defaults when `None`.
    ///
    /// Default: `{ scripts: false, tasks: true }`
    #[must_use]
    pub fn resolve_from(config: Option<&UserGlobalCacheConfig>) -> Self {
        match config {
            None => Self { scripts: false, tasks: true },
            Some(UserGlobalCacheConfig::Bool(true)) => Self { scripts: true, tasks: true },
            Some(UserGlobalCacheConfig::Bool(false)) => Self { scripts: false, tasks: false },
            Some(UserGlobalCacheConfig::Detailed { scripts, tasks }) => {
                Self { scripts: scripts.unwrap_or(false), tasks: tasks.unwrap_or(true) }
            }
        }
    }
}

/// User configuration structure for `run` field in `vite.config.*`
#[derive(Debug, Default, Deserialize)]
// TS derive macro generates code using std types that clippy disallows; skip derive during linting
#[cfg_attr(all(test, not(clippy)), derive(TS), ts(optional_fields, rename = "RunConfig"))]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct UserRunConfig {
    /// Root-level cache configuration.
    ///
    /// This option can only be set in the workspace root's config file.
    /// Setting it in a package's config will result in an error.
    pub cache: Option<UserGlobalCacheConfig>,

    /// Task definitions
    pub tasks: Option<FxHashMap<Str, UserTaskConfig>>,

    /// Whether to automatically run `preX`/`postX` package.json scripts as
    /// lifecycle hooks when script `X` is executed.
    ///
    /// When `true` (the default), running script `test` will automatically
    /// run `pretest` before and `posttest` after, if they exist.
    ///
    /// This option can only be set in the workspace root's config file.
    /// Setting it in a package's config will result in an error.
    pub enable_pre_post_scripts: Option<bool>,
}

impl UserRunConfig {
    /// TypeScript type definitions for user run configuration.
    pub const TS_TYPE: &str = include_str!("../../run-config.ts");

    /// Generates TypeScript type definitions for user task configuration.
    ///
    /// # Panics
    ///
    /// Panics if `oxfmt` is not found in `packages/tools`, if the formatter process
    /// fails to spawn or write, or if the output is not valid UTF-8.
    #[cfg(all(test, not(clippy)))]
    #[must_use]
    // test code: uses std types for convenience
    #[expect(clippy::disallowed_types, reason = "test code uses std types for convenience")]
    pub fn generate_ts_definition() -> String {
        use std::{
            any::TypeId,
            collections::HashSet,
            io::Write,
            process::{Command, Stdio},
        };

        use ts_rs::TypeVisitor;

        struct DeclCollector {
            decls: Vec<String>,
            visited: HashSet<TypeId>,
        }

        impl TypeVisitor for DeclCollector {
            fn visit<T: TS + 'static + ?Sized>(&mut self) {
                if !self.visited.insert(TypeId::of::<T>()) {
                    return;
                }
                // Only collect declarations from types that are exportable
                // (i.e., have an output path - built-in types like HashMap don't)
                if T::output_path().is_some() {
                    self.decls.push(T::decl());
                }
                // Recursively visit dependencies of T
                T::visit_dependencies(self);
            }
        }

        let mut collector = DeclCollector { decls: Vec::new(), visited: HashSet::new() };
        Self::visit_dependencies(&mut collector);

        // Sort declarations for deterministic output order
        collector.decls.sort();

        // Header
        let mut types: String =
            "// This file is auto-generated by `cargo test`. Do not edit manually.\n\n".into();

        // Export all types
        let dep_types: String = collector
            .decls
            .iter()
            .map(|decl| vite_str::format!("export {decl}"))
            .collect::<Vec<_>>()
            .join("\n\n");
        types.push_str(&dep_types);

        // Export the main type
        types.push_str("\n\nexport ");
        types.push_str(&Self::decl());

        // Format using oxfmt from packages/tools
        let workspace_root =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().parent().unwrap();
        let tools_path = workspace_root.join("packages/tools/node_modules/.bin");

        let oxfmt_path = which::which_in("oxfmt", Some(&tools_path), &tools_path)
            .expect("oxfmt not found in packages/tools");

        let mut child = Command::new(oxfmt_path)
            .arg("--stdin-filepath=run-config.ts")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("failed to spawn oxfmt");

        child
            .stdin
            .take()
            .unwrap()
            .write_all(types.as_bytes())
            .expect("failed to write to oxfmt stdin");

        let output = child.wait_with_output().expect("failed to read oxfmt output");
        assert!(output.status.success(), "oxfmt failed");

        String::from_utf8(output.stdout).expect("oxfmt output is not valid UTF-8")
    }
}

#[cfg(all(test, not(clippy)))]
mod ts_tests {
    // test code: uses std types for convenience
    #[expect(clippy::disallowed_types, reason = "test code uses std types for convenience")]
    use std::{env, path::PathBuf};

    use super::UserRunConfig;

    #[test]
    // test code: uses std types for convenience
    #[expect(
        clippy::disallowed_methods,
        clippy::disallowed_types,
        reason = "test code uses std types for convenience"
    )]
    fn typescript_generation() {
        let file_path =
            PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("run-config.ts");
        let ts = UserRunConfig::generate_ts_definition().replace('\r', "");

        if env::var("VT_UPDATE_TS_TYPES").unwrap_or_default() == "1" {
            std::fs::write(&file_path, ts).unwrap();
        } else {
            let existing_ts =
                std::fs::read_to_string(&file_path).unwrap_or_default().replace('\r', "");
            pretty_assertions::assert_eq!(
                ts,
                existing_ts,
                "Generated TypeScript types do not match the existing ones. If you made changes to the types, please set VT_UPDATE_TS_TYPES=1 and run the tests again to update the TypeScript definitions."
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn test_command_required() {
        let user_config_json = json!({});
        assert!(
            serde_json::from_value::<UserTaskConfig>(user_config_json).is_err(),
            "task config without command should fail to deserialize"
        );
    }

    #[test]
    fn test_command_with_defaults() {
        let user_config_json = json!({
            "command": "echo hello"
        });
        let user_config: UserTaskConfig = serde_json::from_value(user_config_json).unwrap();
        assert_eq!(
            user_config,
            UserTaskConfig { command: "echo hello".into(), options: UserTaskOptions::default() }
        );
    }

    #[test]
    fn test_cwd_rename() {
        let user_config_json = json!({
            "command": "echo test",
            "cwd": "src"
        });
        let user_config: UserTaskConfig = serde_json::from_value(user_config_json).unwrap();
        assert_eq!(user_config.options.cwd_relative_to_package.as_ref().unwrap().as_str(), "src");
    }

    #[test]
    fn test_cache_disabled() {
        let user_config_json = json!({
            "command": "echo test",
            "cache": false
        });
        let user_config: UserTaskConfig = serde_json::from_value(user_config_json).unwrap();
        assert_eq!(
            user_config.options.cache_config,
            UserCacheConfig::Disabled { cache: MustBe!(false) }
        );
    }

    #[test]
    fn test_cache_explicitly_enabled() {
        let user_config_json = json!({
            "cache": true,
            "env": ["NODE_ENV"],
            "untrackedEnv": ["FOO"],
        });
        assert_eq!(
            serde_json::from_value::<UserCacheConfig>(user_config_json).unwrap(),
            UserCacheConfig::Enabled {
                cache: Some(MustBe!(true)),
                enabled_cache_config: EnabledCacheConfig {
                    env: Some(std::iter::once("NODE_ENV".into()).collect()),
                    untracked_env: Some(std::iter::once("FOO".into()).collect()),
                    input: None,
                }
            },
        );
    }

    #[test]
    fn test_input_empty_array() {
        let user_config_json = json!({
            "input": []
        });
        let config: EnabledCacheConfig = serde_json::from_value(user_config_json).unwrap();
        assert_eq!(config.input, Some(vec![]));
    }

    #[test]
    fn test_input_auto_true() {
        let user_config_json = json!({
            "input": [{ "auto": true }]
        });
        let config: EnabledCacheConfig = serde_json::from_value(user_config_json).unwrap();
        assert_eq!(config.input, Some(vec![UserInputEntry::Auto { auto: true }]));
    }

    #[test]
    fn test_input_auto_false() {
        let user_config_json = json!({
            "input": [{ "auto": false }]
        });
        let config: EnabledCacheConfig = serde_json::from_value(user_config_json).unwrap();
        assert_eq!(config.input, Some(vec![UserInputEntry::Auto { auto: false }]));
    }

    #[test]
    fn test_input_globs() {
        let user_config_json = json!({
            "input": ["src/**/*.ts", "package.json"]
        });
        let config: EnabledCacheConfig = serde_json::from_value(user_config_json).unwrap();
        assert_eq!(
            config.input,
            Some(vec![
                UserInputEntry::Glob("src/**/*.ts".into()),
                UserInputEntry::Glob("package.json".into()),
            ])
        );
    }

    #[test]
    fn test_input_negative_globs() {
        let user_config_json = json!({
            "input": ["src/**", "!src/**/*.test.ts"]
        });
        let config: EnabledCacheConfig = serde_json::from_value(user_config_json).unwrap();
        assert_eq!(
            config.input,
            Some(vec![
                UserInputEntry::Glob("src/**".into()),
                UserInputEntry::Glob("!src/**/*.test.ts".into()),
            ])
        );
    }

    #[test]
    fn test_input_mixed() {
        let user_config_json = json!({
            "input": ["package.json", { "auto": true }, "!node_modules/**"]
        });
        let config: EnabledCacheConfig = serde_json::from_value(user_config_json).unwrap();
        assert_eq!(
            config.input,
            Some(vec![
                UserInputEntry::Glob("package.json".into()),
                UserInputEntry::Auto { auto: true },
                UserInputEntry::Glob("!node_modules/**".into()),
            ])
        );
    }

    #[test]
    fn test_input_with_cache_false_error() {
        // input with cache: false should produce a serde error due to deny_unknown_fields
        let user_config_json = json!({
            "cache": false,
            "input": ["src/**"]
        });
        assert!(serde_json::from_value::<UserCacheConfig>(user_config_json).is_err());
    }

    #[test]
    fn test_cache_disabled_but_with_fields() {
        let user_config_json = json!({
            "cache": false,
            "env": ["NODE_ENV"],
        });
        assert!(serde_json::from_value::<UserCacheConfig>(user_config_json).is_err());
    }

    #[test]
    fn test_deny_unknown_field() {
        let user_config_json = json!({
            "foo": 42,
        });
        assert!(serde_json::from_value::<UserCacheConfig>(user_config_json).is_err());
    }

    #[test]
    fn test_global_cache_bool_true() {
        let config: UserGlobalCacheConfig = serde_json::from_value(json!(true)).unwrap();
        assert_eq!(config, UserGlobalCacheConfig::Bool(true));
        let resolved = ResolvedGlobalCacheConfig::resolve_from(Some(&config));
        assert!(resolved.scripts);
        assert!(resolved.tasks);
    }

    #[test]
    fn test_global_cache_bool_false() {
        let config: UserGlobalCacheConfig = serde_json::from_value(json!(false)).unwrap();
        assert_eq!(config, UserGlobalCacheConfig::Bool(false));
        let resolved = ResolvedGlobalCacheConfig::resolve_from(Some(&config));
        assert!(!resolved.scripts);
        assert!(!resolved.tasks);
    }

    #[test]
    fn test_global_cache_detailed_scripts_only() {
        let config: UserGlobalCacheConfig =
            serde_json::from_value(json!({ "scripts": true })).unwrap();
        let resolved = ResolvedGlobalCacheConfig::resolve_from(Some(&config));
        assert!(resolved.scripts);
        assert!(resolved.tasks); // defaults to true
    }

    #[test]
    fn test_global_cache_detailed_tasks_false() {
        let config: UserGlobalCacheConfig =
            serde_json::from_value(json!({ "tasks": false })).unwrap();
        let resolved = ResolvedGlobalCacheConfig::resolve_from(Some(&config));
        assert!(!resolved.scripts); // defaults to false
        assert!(!resolved.tasks);
    }

    #[test]
    fn test_global_cache_detailed_both() {
        let config: UserGlobalCacheConfig =
            serde_json::from_value(json!({ "scripts": true, "tasks": false })).unwrap();
        let resolved = ResolvedGlobalCacheConfig::resolve_from(Some(&config));
        assert!(resolved.scripts);
        assert!(!resolved.tasks);
    }

    #[test]
    fn test_global_cache_none_defaults() {
        let resolved = ResolvedGlobalCacheConfig::resolve_from(None);
        assert!(!resolved.scripts); // defaults to false
        assert!(resolved.tasks); // defaults to true
    }

    #[test]
    fn test_global_cache_detailed_unknown_field() {
        assert!(
            serde_json::from_value::<UserGlobalCacheConfig>(json!({ "unknown": true })).is_err()
        );
    }

    #[test]
    fn test_run_config_unknown_top_level_field() {
        assert!(serde_json::from_value::<UserRunConfig>(json!({ "unknown": true })).is_err());
    }

    #[test]
    fn test_task_config_unknown_field() {
        assert!(
            serde_json::from_value::<UserTaskConfig>(json!({ "command": "echo", "unknown": true }))
                .is_err()
        );
    }
}
