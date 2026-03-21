#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    WaxBuild(#[from] wax::BuildError),
    #[error(transparent)]
    Walk(#[from] wax::walk::WalkError),
    #[error(transparent)]
    InvalidPathData(#[from] vite_path::relative::InvalidPathDataError),
}
