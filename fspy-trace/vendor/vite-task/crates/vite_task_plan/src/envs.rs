use std::{collections::BTreeMap, ffi::OsStr, sync::Arc};

use bincode::{Decode, Encode};
use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use supports_color::{Stream, on};
use vite_glob::GlobPatternSet;
use vite_str::Str;
use vite_task_graph::config::EnvConfig;

/// Environment variable fingerprints for a task execution.
///
/// Contents of this struct are only for fingerprinting and cache key computation (some of envs may be hashed for security).
/// The actual environment variables to be passed to the execution are in `LeafExecutionItem.all_envs`.
#[derive(Debug, Encode, Decode, Serialize, Deserialize, PartialEq, Eq, Clone)]
pub struct EnvFingerprints {
    /// Environment variables that should be fingerprinted for this execution.
    ///
    /// Use `BTreeMap` to ensure stable order.
    pub fingerprinted_envs: BTreeMap<Str, Arc<str>>,

    /// Environment variable names that should be passed through without values being fingerprinted.
    ///
    /// Names are still included in the fingerprint so that changes to these names can invalidate the cache.
    pub untracked_env_config: Arc<[Str]>,
}

#[derive(Debug, thiserror::Error)]
pub enum ResolveEnvError {
    #[error("Failed to resolve envs with invalid glob patterns")]
    GlobError {
        #[source]
        #[from]
        glob_error: vite_glob::Error,
    },

    #[error("Env value is not valid unicode: {key} = {value:?}")]
    EnvValueIsNotValidUnicode { key: Str, value: Arc<OsStr> },
}
impl EnvFingerprints {
    /// Resolves from all available envs and env config.
    ///
    /// Before the call, `all_envs` is expected to contain all available envs.
    /// After the call, it will be modified to contain only envs to be passed to the execution (fingerprinted + untracked).
    pub fn resolve(
        all_envs: &mut FxHashMap<Arc<OsStr>, Arc<OsStr>>,
        env_config: &EnvConfig,
    ) -> Result<Self, ResolveEnvError> {
        // Collect all envs matching fingerprinted or untracked envs in env_config
        *all_envs = {
            let mut new_all_envs = resolve_envs_with_patterns(
                all_envs.iter(),
                &env_config
                    .untracked_env
                    .iter()
                    .map(std::convert::AsRef::as_ref)
                    .chain(env_config.fingerprinted_envs.iter().map(std::convert::AsRef::as_ref))
                    .collect::<Vec<&str>>(),
            )?;

            // Automatically add FORCE_COLOR environment variable if not already set
            // This enables color output in subprocesses when color is supported
            // TODO: will remove this temporarily until we have a better solution
            if !all_envs.contains_key(OsStr::new("FORCE_COLOR"))
                && !all_envs.contains_key(OsStr::new("NO_COLOR"))
                && let Some(support) = on(Stream::Stdout)
            {
                let force_color_value = if support.has_16m {
                    "3" // True color (16 million colors)
                } else if support.has_256 {
                    "2" // 256 colors
                } else if support.has_basic {
                    "1" // Basic ANSI colors
                } else {
                    "0" // No color support
                };
                new_all_envs.insert(
                    OsStr::new("FORCE_COLOR").into(),
                    Arc::<OsStr>::from(OsStr::new(force_color_value)),
                );
            }
            new_all_envs
        };

        // Resolve fingerprinted envs
        let mut fingerprinted_envs = BTreeMap::<Str, Arc<str>>::new();
        if !env_config.fingerprinted_envs.is_empty() {
            let fingerprinted_env_patterns = GlobPatternSet::new(
                env_config.fingerprinted_envs.iter().filter(|s| !s.starts_with('!')),
            )?;
            let sensitive_patterns = GlobPatternSet::new(SENSITIVE_PATTERNS)?;
            for (name, value) in all_envs.iter() {
                let Some(name) = name.to_str() else {
                    continue;
                };
                if !fingerprinted_env_patterns.is_match(name) {
                    continue;
                }
                let Some(value) = value.to_str() else {
                    return Err(ResolveEnvError::EnvValueIsNotValidUnicode {
                        key: name.into(),
                        value: Arc::clone(value),
                    });
                };
                // Hash sensitive env values
                let value: Arc<str> = if sensitive_patterns.is_match(name) {
                    let mut hasher = Sha256::new();
                    hasher.update(value.as_bytes());
                    #[expect(
                        clippy::disallowed_macros,
                        reason = "result is converted to Arc<str>, not Str"
                    )]
                    format!("sha256:{:x}", hasher.finalize()).into()
                } else {
                    value.into()
                };
                fingerprinted_envs.insert(name.into(), value);
            }
        }

        Ok(Self {
            fingerprinted_envs,
            // Save untracked_env names sorted for deterministic cache fingerprinting
            untracked_env_config: {
                let mut sorted: Vec<Str> = env_config.untracked_env.iter().cloned().collect();
                sorted.sort();
                sorted.into()
            },
        })
    }
}

fn resolve_envs_with_patterns<'a>(
    env_vars: impl Iterator<Item = (&'a Arc<OsStr>, &'a Arc<OsStr>)>,
    patterns: &[&str],
) -> Result<FxHashMap<Arc<OsStr>, Arc<OsStr>>, vite_glob::Error> {
    let patterns = GlobPatternSet::new(patterns.iter().filter(|pattern| {
        if pattern.starts_with('!') {
            // FIXME: use better way to print warning log
            // Or parse and validate TaskConfig in command parsing phase
            tracing::warn!(
                "env pattern starts with '!' is not supported, will be ignored: {}",
                pattern
            );
            false
        } else {
            true
        }
    }))?;
    let envs: FxHashMap<Arc<OsStr>, Arc<OsStr>> = env_vars
        .filter_map(|(name, value)| {
            let name_str = name.as_ref().to_str()?;
            if patterns.is_match(name_str) {
                Some((Arc::clone(name), Arc::clone(value)))
            } else {
                None
            }
        })
        .collect();
    Ok(envs)
}

const SENSITIVE_PATTERNS: &[&str] = &[
    "*_KEY",
    "*_SECRET",
    "*_TOKEN",
    "*_PASSWORD",
    "*_PASS",
    "*_PWD",
    "*_CREDENTIAL*",
    "*_API_KEY",
    "*_PRIVATE_*",
    "AWS_*",
    "GITHUB_*",
    "NPM_*TOKEN",
    "DATABASE_URL",
    "MONGODB_URI",
    "REDIS_URL",
    "*_CERT*",
    // Exact matches for known sensitive names
    "PASSWORD",
    "SECRET",
    "TOKEN",
];

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_envs(pairs: Vec<(&str, &str)>) -> FxHashMap<Arc<OsStr>, Arc<OsStr>> {
        pairs
            .into_iter()
            .map(|(k, v)| (Arc::from(OsStr::new(k)), Arc::from(OsStr::new(v))))
            .collect()
    }

    fn create_env_config(fingerprinted: &[&str], untracked: &[&str]) -> EnvConfig {
        EnvConfig {
            fingerprinted_envs: fingerprinted.iter().map(|s| Str::from(*s)).collect(),
            untracked_env: untracked.iter().map(|s| Str::from(*s)).collect(),
        }
    }

    #[test]
    fn test_force_color_auto_detection() {
        // Test when FORCE_COLOR is not already set
        let mut all_envs = create_test_envs(vec![("PATH", "/usr/bin")]);
        let env_config = create_env_config(&[], &["PATH"]);

        let result = EnvFingerprints::resolve(&mut all_envs, &env_config).unwrap();

        // FORCE_COLOR should be automatically added if color is supported
        // Note: This test might vary based on the test environment
        let force_color_present = all_envs.contains_key(OsStr::new("FORCE_COLOR"));
        if force_color_present {
            let force_color_value = all_envs.get(OsStr::new("FORCE_COLOR")).unwrap();
            let force_color_str = force_color_value.to_str().unwrap();
            // Should be a valid FORCE_COLOR level
            assert!(matches!(force_color_str, "0" | "1" | "2" | "3"));
        }

        // Test when FORCE_COLOR is already set - should not be overridden
        let mut all_envs = create_test_envs(vec![("PATH", "/usr/bin"), ("FORCE_COLOR", "2")]);
        let env_config = create_env_config(&[], &["PATH", "FORCE_COLOR"]);

        let _result = EnvFingerprints::resolve(&mut all_envs, &env_config).unwrap();

        // Should contain the original FORCE_COLOR value
        assert!(all_envs.contains_key(OsStr::new("FORCE_COLOR")));
        let force_color_value = all_envs.get(OsStr::new("FORCE_COLOR")).unwrap();
        assert_eq!(force_color_value.to_str().unwrap(), "2");

        // FORCE_COLOR should not be in fingerprinted_envs since it's not declared
        assert!(!result.fingerprinted_envs.contains_key("FORCE_COLOR"));

        // Test when NO_COLOR is already set - FORCE_COLOR should not be automatically added
        let mut all_envs = create_test_envs(vec![("PATH", "/usr/bin"), ("NO_COLOR", "1")]);
        let env_config = create_env_config(&[], &["PATH", "NO_COLOR"]);

        let _result = EnvFingerprints::resolve(&mut all_envs, &env_config).unwrap();

        assert!(all_envs.contains_key(OsStr::new("NO_COLOR")));
        let no_color_value = all_envs.get(OsStr::new("NO_COLOR")).unwrap();
        assert_eq!(no_color_value.to_str().unwrap(), "1");
        // FORCE_COLOR should not be automatically added since NO_COLOR is set
        assert!(!all_envs.contains_key(OsStr::new("FORCE_COLOR")));
    }

    #[test]
    #[cfg(unix)]
    fn test_task_envs_stable_ordering() {
        // Create env config with multiple envs
        let env_config = create_env_config(
            &["ZEBRA_VAR", "ALPHA_VAR", "MIDDLE_VAR", "BETA_VAR", "NOT_EXISTS_VAR", "APP?_*"],
            &["PATH", "HOME", "VSCODE_VAR", "OXLINT_*"],
        );

        // Create mock environment variables
        let mock_envs = vec![
            ("ZEBRA_VAR", "zebra_value"),
            ("ALPHA_VAR", "alpha_value"),
            ("MIDDLE_VAR", "middle_value"),
            ("BETA_VAR", "beta_value"),
            ("VSCODE_VAR", "vscode_value"),
            ("APP1_TOKEN", "app1_token"),
            ("APP2_TOKEN", "app2_token"),
            ("APP1_NAME", "app1_value"),
            ("APP2_NAME", "app2_value"),
            ("APP1_PASSWORD", "app1_password"),
            ("OXLINT_TSGOLINT_PATH", "/path/to/oxlint_tsgolint"),
            ("PATH", "/usr/bin"),
            ("HOME", "/home/user"),
        ];

        // Resolve envs multiple times
        let mut all_envs1 = create_test_envs(mock_envs.clone());
        let mut all_envs2 = create_test_envs(mock_envs.clone());
        let mut all_envs3 = create_test_envs(mock_envs.clone());

        let result1 = EnvFingerprints::resolve(&mut all_envs1, &env_config).unwrap();
        let result2 = EnvFingerprints::resolve(&mut all_envs2, &env_config).unwrap();
        let result3 = EnvFingerprints::resolve(&mut all_envs3, &env_config).unwrap();

        // Convert to vecs for comparison (BTreeMap already maintains stable ordering)
        let envs1: Vec<_> = result1.fingerprinted_envs.iter().collect();
        let envs2: Vec<_> = result2.fingerprinted_envs.iter().collect();
        let envs3: Vec<_> = result3.fingerprinted_envs.iter().collect();

        // Verify all resolutions produce the same result
        assert_eq!(envs1, envs2);
        assert_eq!(envs2, envs3);

        // Verify all expected variables are present
        assert_eq!(envs1.len(), 9);
        assert!(envs1.iter().any(|(k, _)| k.as_str() == "ALPHA_VAR"));
        assert!(envs1.iter().any(|(k, _)| k.as_str() == "BETA_VAR"));
        assert!(envs1.iter().any(|(k, _)| k.as_str() == "MIDDLE_VAR"));
        assert!(envs1.iter().any(|(k, _)| k.as_str() == "ZEBRA_VAR"));
        assert!(envs1.iter().any(|(k, _)| k.as_str() == "APP1_NAME"));
        assert!(envs1.iter().any(|(k, _)| k.as_str() == "APP2_NAME"));
        assert!(envs1.iter().any(|(k, _)| k.as_str() == "APP1_PASSWORD"));
        assert!(envs1.iter().any(|(k, _)| k.as_str() == "APP1_TOKEN"));
        assert!(envs1.iter().any(|(k, _)| k.as_str() == "APP2_TOKEN"));

        // APP1_PASSWORD should be hashed
        let password = result1.fingerprinted_envs.get("APP1_PASSWORD").unwrap();
        assert_eq!(
            password.as_ref(),
            "sha256:17f1ef795d5663faa129f6fe3e5335e67ac7a701d1a70533a5f4b1635413a1aa"
        );

        // Verify untracked envs are present in all_envs
        assert!(all_envs1.contains_key(OsStr::new("VSCODE_VAR")));
        assert!(all_envs1.contains_key(OsStr::new("PATH")));
        assert!(all_envs1.contains_key(OsStr::new("HOME")));
        assert!(all_envs1.contains_key(OsStr::new("OXLINT_TSGOLINT_PATH")));
    }

    #[test]
    #[cfg(unix)]
    fn test_unix_env_case_sensitive() {
        // Test that Unix environment variable matching is case-sensitive
        // Create env config with envs in different cases
        let env_config = create_env_config(&["TEST_VAR", "test_var", "Test_Var"], &[]);

        // Create mock environment variables with different cases
        let mut all_envs = create_test_envs(vec![
            ("TEST_VAR", "uppercase"),
            ("test_var", "lowercase"),
            ("Test_Var", "mixed"),
        ]);

        let result = EnvFingerprints::resolve(&mut all_envs, &env_config).unwrap();
        let fingerprinted_envs = &result.fingerprinted_envs;

        // On Unix, all three should be treated as separate variables
        assert_eq!(
            fingerprinted_envs.len(),
            3,
            "Unix should treat different cases as different variables"
        );

        assert_eq!(
            fingerprinted_envs.get("TEST_VAR").map(std::convert::AsRef::as_ref),
            Some("uppercase")
        );
        assert_eq!(
            fingerprinted_envs.get("test_var").map(std::convert::AsRef::as_ref),
            Some("lowercase")
        );
        assert_eq!(
            fingerprinted_envs.get("Test_Var").map(std::convert::AsRef::as_ref),
            Some("mixed")
        );
    }

    #[test]
    #[cfg(windows)]
    fn test_windows_env_case_insensitive() {
        let env_config = create_env_config(
            &["ZEBRA_VAR", "ALPHA_VAR", "MIDDLE_VAR", "BETA_VAR", "NOT_EXISTS_VAR", "APP?_*"],
            &["Path", "VSCODE_VAR"],
        );

        let mock_envs = vec![
            ("ZEBRA_VAR", "zebra_value"),
            ("ALPHA_VAR", "alpha_value"),
            ("MIDDLE_VAR", "middle_value"),
            ("BETA_VAR", "beta_value"),
            ("VSCODE_VAR", "vscode_value"),
            ("app1_name", "app1_value"),
            ("app2_name", "app2_value"),
            ("Path", "C:\\Windows\\System32"),
        ];

        let mut all_envs1 = create_test_envs(mock_envs.clone());
        let mut all_envs2 = create_test_envs(mock_envs.clone());
        let mut all_envs3 = create_test_envs(mock_envs.clone());

        let result1 = EnvFingerprints::resolve(&mut all_envs1, &env_config).unwrap();
        let result2 = EnvFingerprints::resolve(&mut all_envs2, &env_config).unwrap();
        let result3 = EnvFingerprints::resolve(&mut all_envs3, &env_config).unwrap();

        let envs1: Vec<_> = result1.fingerprinted_envs.iter().collect();
        let envs2: Vec<_> = result2.fingerprinted_envs.iter().collect();
        let envs3: Vec<_> = result3.fingerprinted_envs.iter().collect();

        assert_eq!(envs1, envs2);
        assert_eq!(envs2, envs3);

        assert_eq!(envs1.len(), 6);
        assert!(envs1.iter().any(|(k, _)| k.as_str() == "ALPHA_VAR"));
        assert!(envs1.iter().any(|(k, _)| k.as_str() == "BETA_VAR"));
        assert!(envs1.iter().any(|(k, _)| k.as_str() == "MIDDLE_VAR"));
        assert!(envs1.iter().any(|(k, _)| k.as_str() == "ZEBRA_VAR"));
        assert!(envs1.iter().any(|(k, _)| k.as_str() == "app1_name"));
        assert!(envs1.iter().any(|(k, _)| k.as_str() == "app2_name"));

        // Verify untracked envs are present
        assert!(all_envs1.contains_key(OsStr::new("VSCODE_VAR")));
        assert!(
            all_envs1.contains_key(OsStr::new("Path"))
                || all_envs1.contains_key(OsStr::new("PATH"))
        );
    }

    // ============================================
    // New tests for changed/new logic
    // ============================================

    #[test]
    fn test_btreemap_stable_fingerprint() {
        // Verify BTreeMap produces identical ordering regardless of insertion order
        let env_config = create_env_config(&["AAA", "ZZZ", "MMM", "BBB"], &[]);

        // Create envs in different orders
        let mut all_envs1 =
            create_test_envs(vec![("AAA", "a"), ("ZZZ", "z"), ("MMM", "m"), ("BBB", "b")]);
        let mut all_envs2 =
            create_test_envs(vec![("ZZZ", "z"), ("BBB", "b"), ("AAA", "a"), ("MMM", "m")]);

        let result1 = EnvFingerprints::resolve(&mut all_envs1, &env_config).unwrap();
        let result2 = EnvFingerprints::resolve(&mut all_envs2, &env_config).unwrap();

        // Both should produce identical iteration order due to BTreeMap
        let keys1: Vec<_> = result1.fingerprinted_envs.keys().collect();
        let keys2: Vec<_> = result2.fingerprinted_envs.keys().collect();

        assert_eq!(keys1, keys2);
        // BTreeMap should be sorted alphabetically
        assert_eq!(keys1, vec!["AAA", "BBB", "MMM", "ZZZ"]);
    }

    #[test]
    fn test_untracked_env_names_stored() {
        let env_config = create_env_config(&["BUILD_MODE"], &["PATH", "HOME", "CI"]);

        let mut all_envs = create_test_envs(vec![
            ("BUILD_MODE", "production"),
            ("PATH", "/usr/bin"),
            ("HOME", "/home/user"),
            ("CI", "true"),
        ]);

        let result = EnvFingerprints::resolve(&mut all_envs, &env_config).unwrap();

        // Verify untracked_env names are stored
        assert_eq!(result.untracked_env_config.len(), 3);
        assert!(result.untracked_env_config.iter().any(|s| s.as_str() == "PATH"));
        assert!(result.untracked_env_config.iter().any(|s| s.as_str() == "HOME"));
        assert!(result.untracked_env_config.iter().any(|s| s.as_str() == "CI"));
    }

    #[test]
    fn test_all_envs_mutated_after_resolve() {
        // Include some envs that should be filtered out
        let env_config = create_env_config(&["KEEP_THIS"], &["PASS_THROUGH"]);

        let mut all_envs = create_test_envs(vec![
            ("KEEP_THIS", "kept"),
            ("PASS_THROUGH", "passed"),
            ("FILTER_OUT", "filtered"),
            ("ANOTHER_FILTERED", "also filtered"),
        ]);

        let _result = EnvFingerprints::resolve(&mut all_envs, &env_config).unwrap();

        // all_envs should only contain fingerprinted + untracked envs (plus auto-added ones)
        assert!(all_envs.contains_key(OsStr::new("KEEP_THIS")));
        assert!(all_envs.contains_key(OsStr::new("PASS_THROUGH")));
        assert!(!all_envs.contains_key(OsStr::new("FILTER_OUT")));
        assert!(!all_envs.contains_key(OsStr::new("ANOTHER_FILTERED")));
    }

    #[test]
    #[cfg(unix)]
    fn test_error_env_value_not_valid_unicode() {
        use std::os::unix::ffi::OsStrExt;

        let env_config = create_env_config(&["INVALID_UTF8"], &[]);

        // Create invalid UTF-8 sequence
        let invalid_utf8 = OsStr::from_bytes(&[0xff, 0xfe]);
        let mut all_envs: FxHashMap<Arc<OsStr>, Arc<OsStr>> =
            std::iter::once((Arc::from(OsStr::new("INVALID_UTF8")), Arc::from(invalid_utf8)))
                .collect();

        let result = EnvFingerprints::resolve(&mut all_envs, &env_config);

        assert!(result.is_err());
        match result.unwrap_err() {
            ResolveEnvError::EnvValueIsNotValidUnicode { key, .. } => {
                assert_eq!(key.as_str(), "INVALID_UTF8");
            }
            other @ ResolveEnvError::GlobError { .. } => {
                panic!("Expected EnvValueIsNotValidUnicode, got {other:?}")
            }
        }
    }

    #[test]
    fn test_sensitive_env_hashing() {
        // Test various sensitive patterns
        let env_config = create_env_config(
            &["API_KEY", "MY_SECRET", "AUTH_TOKEN", "DB_PASSWORD", "NORMAL_VAR"],
            &[],
        );

        let mut all_envs = create_test_envs(vec![
            ("API_KEY", "secret_key_123"),
            ("MY_SECRET", "secret_value"),
            ("AUTH_TOKEN", "token_abc"),
            ("DB_PASSWORD", "password123"),
            ("NORMAL_VAR", "normal_value"),
        ]);

        let result = EnvFingerprints::resolve(&mut all_envs, &env_config).unwrap();

        // Sensitive envs should be hashed
        assert!(result.fingerprinted_envs.get("API_KEY").unwrap().starts_with("sha256:"));
        assert!(result.fingerprinted_envs.get("MY_SECRET").unwrap().starts_with("sha256:"));
        assert!(result.fingerprinted_envs.get("AUTH_TOKEN").unwrap().starts_with("sha256:"));
        assert!(result.fingerprinted_envs.get("DB_PASSWORD").unwrap().starts_with("sha256:"));

        // Non-sensitive env should NOT be hashed
        assert_eq!(result.fingerprinted_envs.get("NORMAL_VAR").unwrap().as_ref(), "normal_value");
    }

    #[test]
    fn test_playwright_env_untracked() {
        // Verify PLAYWRIGHT_* pattern matches Playwright environment variables
        let env_config = create_env_config(&[], &["PLAYWRIGHT_*"]);

        let mut all_envs = create_test_envs(vec![
            ("PLAYWRIGHT_BROWSERS_PATH", "/custom/browsers"),
            ("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", "1"),
            ("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "/path/to/chromium"),
            ("OTHER_VAR", "should_be_filtered"),
        ]);

        let _result = EnvFingerprints::resolve(&mut all_envs, &env_config).unwrap();

        // PLAYWRIGHT_* envs should be passed through
        assert!(all_envs.contains_key(OsStr::new("PLAYWRIGHT_BROWSERS_PATH")));
        assert!(all_envs.contains_key(OsStr::new("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD")));
        assert!(all_envs.contains_key(OsStr::new("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH")));
        // Non-matching env should be filtered out
        assert!(!all_envs.contains_key(OsStr::new("OTHER_VAR")));
    }
}
