#[expect(
    clippy::disallowed_types,
    reason = "StripPrefixError carries a raw &Path that may not be valid UTF-8, so it can't use vite_path types"
)]
use std::path::Path;
use std::{io, sync::Arc};

use vite_path::{
    AbsolutePath, AbsolutePathBuf, RelativePathBuf, absolute::StripPrefixError,
    relative::InvalidPathDataError,
};
use vite_str::Str;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Duplicate package name `{name}` found at `{path1}` and `{path2}`")]
    DuplicatedPackageName { name: Str, path1: RelativePathBuf, path2: RelativePathBuf },

    #[error("Package not found in workspace: `{0:?}`")]
    PackageJsonNotFound(AbsolutePathBuf),

    #[error("Package at `{package_path:?}` is outside workspace root `{workspace_root:?}`")]
    PackageOutsideWorkspace { package_path: Arc<AbsolutePath>, workspace_root: Arc<AbsolutePath> },

    #[error(
        "The stripped path ({stripped_path:?}) is not a valid relative path because: {invalid_path_data_error}"
    )]
    #[expect(
        clippy::disallowed_types,
        reason = "stripped path may not be valid UTF-8, so it can't use vite_path types"
    )]
    StripPath { stripped_path: Box<Path>, invalid_path_data_error: InvalidPathDataError },

    // External library errors
    #[error(transparent)]
    Io(#[from] io::Error),

    #[error("Failed to parse JSON file at {file_path:?}")]
    SerdeJson {
        file_path: Arc<AbsolutePath>,
        #[source]
        serde_json_error: serde_json::Error,
    },

    #[error("Failed to parse YAML file at {file_path:?}")]
    SerdeYml {
        file_path: Arc<AbsolutePath>,
        #[source]
        serde_yml_error: serde_yml::Error,
    },

    #[error(transparent)]
    WaxBuild(#[from] wax::BuildError),

    #[error(transparent)]
    WaxWalk(#[from] wax::walk::WalkError),

    #[error(transparent)]
    Glob(#[from] vite_glob::Error),
}

impl From<StripPrefixError<'_>> for Error {
    fn from(value: StripPrefixError<'_>) -> Self {
        Self::StripPath {
            stripped_path: Box::from(value.stripped_path),
            invalid_path_data_error: value.invalid_path_data_error,
        }
    }
}
