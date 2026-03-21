use std::{
    env::{self, join_paths},
    ffi::OsStr,
    iter,
    sync::Arc,
};

use clap::Parser;
use rustc_hash::FxHashMap;
use vite_path::AbsolutePath;
use vite_str::Str;
use vite_task::{
    Command, EnabledCacheConfig, HandledCommand, ScriptCommand, SessionConfig, UserCacheConfig,
    get_path_env, plan_request::SyntheticPlanRequest,
};

#[derive(Debug, Default)]
pub struct CommandHandler(());

/// Find an executable in `node_modules/.bin` directories up the tree.
///
/// # Errors
///
/// Returns an error if the executable cannot be found in any searched path.
pub fn find_executable(
    path_env: Option<&Arc<OsStr>>,
    cwd: &AbsolutePath,
    executable: &str,
) -> anyhow::Result<Arc<OsStr>> {
    #[expect(
        clippy::disallowed_types,
        reason = "PathBuf required by env::split_paths and which::which_in APIs"
    )]
    let mut paths: Vec<std::path::PathBuf> =
        path_env.map_or_else(Vec::new, |path_env| env::split_paths(path_env).collect());
    let mut current_cwd_parent = cwd;
    loop {
        let node_modules_bin = current_cwd_parent.join("node_modules").join(".bin");
        paths.push(node_modules_bin.as_path().to_path_buf());
        if let Some(parent) = current_cwd_parent.parent() {
            current_cwd_parent = parent;
        } else {
            break;
        }
    }
    let executable_path = which::which_in(executable, Some(join_paths(paths)?), cwd)?;
    Ok(executable_path.into_os_string().into())
}

/// Create a synthetic plan request for running a tool from `node_modules/.bin`.
///
/// # Errors
///
/// Returns an error if the executable cannot be found.
fn synthesize_node_modules_bin_task(
    executable_name: &str,
    args: &[Str],
    envs: &Arc<FxHashMap<Arc<OsStr>, Arc<OsStr>>>,
    cwd: &Arc<AbsolutePath>,
) -> anyhow::Result<SyntheticPlanRequest> {
    Ok(SyntheticPlanRequest {
        program: find_executable(get_path_env(envs), cwd, executable_name)?,
        args: args.into(),
        cache_config: UserCacheConfig::with_config(EnabledCacheConfig {
            env: None,
            untracked_env: None,
            input: None,
        }),
        envs: Arc::clone(envs),
    })
}

#[derive(Debug, Parser)]
#[command(name = "vt", version)]
pub enum Args {
    Lint {
        #[clap(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<Str>,
    },
    Test {
        #[clap(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<Str>,
    },
    EnvTest {
        name: Str,
        value: Str,
    },
    #[command(flatten)]
    Task(Command),
}

#[async_trait::async_trait(?Send)]
impl vite_task::CommandHandler for CommandHandler {
    async fn handle_command(
        &mut self,
        command: &mut ScriptCommand,
    ) -> anyhow::Result<HandledCommand> {
        match command.program.as_str() {
            "vt" | "vp" => {}
            // `vpr <args>` is shorthand for `vt run <args>`
            "vpr" => {
                command.program = Str::from("vt");
                command.args =
                    iter::once(Str::from("run")).chain(command.args.iter().cloned()).collect();
            }
            _ => return Ok(HandledCommand::Verbatim),
        }
        let args = Args::try_parse_from(
            std::iter::once(command.program.as_str()).chain(command.args.iter().map(Str::as_str)),
        )?;
        match args {
            Args::Lint { args } => Ok(HandledCommand::Synthesized(
                synthesize_node_modules_bin_task("oxlint", &args, &command.envs, &command.cwd)?,
            )),
            Args::Test { args } => Ok(HandledCommand::Synthesized(
                synthesize_node_modules_bin_task("vitest", &args, &command.envs, &command.cwd)?,
            )),
            Args::EnvTest { name, value } => {
                let mut envs = FxHashMap::clone(&command.envs);
                envs.insert(
                    Arc::from(OsStr::new(name.as_str())),
                    Arc::from(OsStr::new(value.as_str())),
                );

                Ok(HandledCommand::Synthesized(SyntheticPlanRequest {
                    program: find_executable(get_path_env(&envs), &command.cwd, "print-env")?,
                    args: [name.clone()].into(),
                    cache_config: UserCacheConfig::with_config({
                        EnabledCacheConfig {
                            env: None,
                            untracked_env: Some(vec![name]),
                            input: None,
                        }
                    }),
                    envs: Arc::new(envs),
                }))
            }
            Args::Task(parsed) => Ok(HandledCommand::ViteTaskCommand(parsed)),
        }
    }
}

/// A `UserConfigLoader` implementation that only loads `vite-task.json`.
///
/// This is mainly for examples and testing as it does not require Node.js environment.
#[derive(Default, Debug)]
pub struct JsonUserConfigLoader(());

#[async_trait::async_trait(?Send)]
impl vite_task::loader::UserConfigLoader for JsonUserConfigLoader {
    async fn load_user_config_file(
        &self,
        package_path: &AbsolutePath,
    ) -> anyhow::Result<Option<vite_task::config::UserRunConfig>> {
        let config_path = package_path.join("vite-task.json");
        let config_content = match tokio::fs::read_to_string(&config_path).await {
            Ok(content) => content,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Ok(None);
            }
            Err(err) => return Err(err.into()),
        };
        let json_value = jsonc_parser::parse_to_serde_value(
            &config_content,
            &jsonc_parser::ParseOptions::default(),
        )?
        .unwrap_or_default();
        let user_config: vite_task::config::UserRunConfig = serde_json::from_value(json_value)?;
        Ok(Some(user_config))
    }
}

#[derive(Default)]
pub struct OwnedSessionConfig {
    command_handler: CommandHandler,
    user_config_loader: JsonUserConfigLoader,
}

impl OwnedSessionConfig {
    pub fn as_config(&mut self) -> SessionConfig<'_> {
        SessionConfig {
            command_handler: &mut self.command_handler,
            user_config_loader: &mut self.user_config_loader,
            program_name: Str::from("vt"),
        }
    }
}
