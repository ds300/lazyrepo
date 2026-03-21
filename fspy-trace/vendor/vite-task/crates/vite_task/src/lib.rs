mod cli;
mod collections;
mod maybe_str;
pub mod session;

// Public exports for vite_task_bin
pub use cli::{CacheSubcommand, Command, RunCommand, RunFlags};
pub use session::{CommandHandler, ExitStatus, HandledCommand, Session, SessionConfig};
pub use vite_task_graph::{
    config::{
        self,
        user::{EnabledCacheConfig, UserCacheConfig, UserTaskConfig, UserTaskOptions},
    },
    loader,
};
/// Re-exports useful for `CommandHandler` implementations.
pub use vite_task_plan::get_path_env;
pub use vite_task_plan::{plan_request, plan_request::ScriptCommand};
