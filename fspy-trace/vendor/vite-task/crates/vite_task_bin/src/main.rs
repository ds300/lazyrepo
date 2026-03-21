use std::{process::ExitCode, sync::Arc};

use clap::Parser;
use vite_str::Str;
use vite_task::{
    EnabledCacheConfig, ExitStatus, Session, UserCacheConfig, get_path_env,
    plan_request::SyntheticPlanRequest,
};
use vite_task_bin::{Args, OwnedSessionConfig, find_executable};

#[tokio::main]
async fn main() -> anyhow::Result<ExitCode> {
    #[expect(clippy::large_futures, reason = "top-level await in main, no alternative")]
    let exit_status = run().await?;
    Ok(exit_status.0.into())
}

async fn run() -> anyhow::Result<ExitStatus> {
    let args = Args::parse();
    let mut owned_config = OwnedSessionConfig::default();
    let session = Session::init(owned_config.as_config())?;
    match args {
        Args::Task(parsed) => session.main(parsed).await,
        args => {
            // If env FOO is set, run `print-env FOO` via Session::exec before proceeding.
            // In vite-plus, Session::exec is used for auto-install.
            let envs = session.envs();
            if envs.contains_key(std::ffi::OsStr::new("FOO")) {
                let program = find_executable(get_path_env(envs), session.cwd(), "print-env")?;
                let request = SyntheticPlanRequest {
                    program,
                    args: [Str::from("FOO")].into(),
                    cache_config: UserCacheConfig::with_config({
                        EnabledCacheConfig {
                            env: Some(Box::from([Str::from("FOO")])),
                            untracked_env: None,
                            input: None,
                        }
                    }),
                    envs: Arc::clone(envs),
                };
                let cache_key: Arc<[Str]> = Arc::from([Str::from("print-env-foo")]);
                #[expect(
                    clippy::large_futures,
                    reason = "execute_synthetic produces a large future"
                )]
                let status = session.execute_synthetic(request, cache_key, true).await?;
                if status != ExitStatus::SUCCESS {
                    return Ok(status);
                }
            }
            #[expect(clippy::print_stdout, reason = "CLI binary output for non-task commands")]
            {
                println!("{args:?}");
            }
            Ok(ExitStatus::SUCCESS)
        }
    }
}
