use std::fmt::Debug;

use vite_path::AbsolutePath;

use crate::config::UserRunConfig;

/// Loader trait for loading user configuration files (vite-task.json).
#[async_trait::async_trait(?Send)]
pub trait UserConfigLoader: Debug + Send + Sync {
    async fn load_user_config_file(
        &self,
        package_path: &AbsolutePath,
    ) -> anyhow::Result<Option<UserRunConfig>>;
}
