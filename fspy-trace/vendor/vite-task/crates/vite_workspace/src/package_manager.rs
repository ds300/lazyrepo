use std::{
    fs::File,
    io::{BufReader, Seek, SeekFrom},
    sync::Arc,
};

use vite_path::{AbsolutePath, RelativePathBuf};

use crate::Error;

/// A file handle bundled with its absolute path for error context.
#[derive(Debug)]
pub struct FileWithPath {
    file: File,
    path: Arc<AbsolutePath>,
}

impl FileWithPath {
    /// Open a file at the given path.
    ///
    /// # Errors
    /// Returns an error if the file cannot be opened.
    pub fn open(path: Arc<AbsolutePath>) -> Result<Self, Error> {
        let file = File::open(&*path)?;
        Ok(Self { file, path })
    }

    /// Try to open a file, returning None if it doesn't exist.
    ///
    /// # Errors
    /// Returns an error if the file exists but cannot be opened.
    pub fn open_if_exists(path: Arc<AbsolutePath>) -> Result<Option<Self>, Error> {
        match File::open(&*path) {
            Ok(file) => Ok(Some(Self { file, path })),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Get a reference to the file handle.
    #[must_use]
    pub const fn file(&self) -> &File {
        &self.file
    }

    /// Get a mutable reference to the file handle.
    pub const fn file_mut(&mut self) -> &mut File {
        &mut self.file
    }

    /// Get the file path.
    #[must_use]
    pub const fn path(&self) -> &Arc<AbsolutePath> {
        &self.path
    }
}

/// The package root directory and its package.json file.
#[derive(Debug)]
pub struct PackageRoot<'a> {
    pub path: &'a AbsolutePath,
    pub cwd: RelativePathBuf,
    pub package_json: FileWithPath,
}

/// Find the package root directory from the current working directory. `original_cwd` must be absolute.
///
/// If the package.json file is not found, will return `PackageJsonNotFound` error.
///
/// # Errors
/// Returns an error if no `package.json` is found in any ancestor directory, or if a path cannot be stripped.
///
/// # Panics
/// Panics if `original_cwd` is not within the found package root (should not happen in practice).
pub fn find_package_root(original_cwd: &AbsolutePath) -> Result<PackageRoot<'_>, Error> {
    let mut cwd = original_cwd;
    loop {
        // Check for package.json
        let package_json_path: Arc<AbsolutePath> = cwd.join("package.json").into();
        if let Some(file_with_path) = FileWithPath::open_if_exists(package_json_path)? {
            return Ok(PackageRoot {
                path: cwd,
                cwd: original_cwd.strip_prefix(cwd)?.expect("cwd must be within the package root"),
                package_json: file_with_path,
            });
        }

        if let Some(parent) = cwd.parent() {
            // Move up one directory
            cwd = parent;
        } else {
            // We've reached the root, return PackageJsonNotFound error.
            return Err(Error::PackageJsonNotFound(original_cwd.to_absolute_path_buf()));
        }
    }
}

/// The workspace file.
///
/// - `PnpmWorkspaceYaml` is the pnpm workspace file.
/// - `NpmWorkspaceJson` is the package.json file of a yarn/npm workspace.
/// - `NonWorkspacePackage` is the package.json file of a non-workspace package.
#[derive(Debug)]
pub enum WorkspaceFile {
    /// The pnpm-workspace.yaml file of a pnpm workspace.
    PnpmWorkspaceYaml(FileWithPath),
    /// The package.json file of a yarn/npm workspace.
    NpmWorkspaceJson(FileWithPath),
    /// The package.json file of a non-workspace package.
    NonWorkspacePackage(FileWithPath),
}

/// The workspace root directory and its workspace file.
///
/// If the workspace file is not found, but a package is found, `workspace_file` will be `NonWorkspacePackage` with the `package.json` File.
#[derive(Debug)]
pub struct WorkspaceRoot {
    /// The absolute path of the workspace root directory.
    pub path: Arc<AbsolutePath>,
    /// The workspace file.
    pub workspace_file: WorkspaceFile,
}

/// Find the workspace root directory from the current working directory. `original_cwd` must be absolute.
///
/// Returns the workspace root and the relative path from the workspace root to the original cwd.
///
/// If the workspace file is not found, but a package is found, `workspace_file` will be `NonWorkspacePackage` with the `package.json` File.
///
/// If neither workspace nor package is found, will return `PackageJsonNotFound` error.
///
/// # Errors
/// Returns an error if no workspace or package is found, or if file I/O or JSON/YAML parsing fails.
///
/// # Panics
/// Panics if `original_cwd` is not within the found workspace root (should not happen in practice).
pub fn find_workspace_root(
    original_cwd: &AbsolutePath,
) -> Result<(WorkspaceRoot, RelativePathBuf), Error> {
    let mut cwd = original_cwd;

    loop {
        // Check for pnpm-workspace.yaml for pnpm workspace
        let pnpm_workspace_path: Arc<AbsolutePath> = cwd.join("pnpm-workspace.yaml").into();
        if let Some(file_with_path) = FileWithPath::open_if_exists(pnpm_workspace_path)? {
            let relative_cwd =
                original_cwd.strip_prefix(cwd)?.expect("cwd must be within the pnpm workspace");
            return Ok((
                WorkspaceRoot {
                    path: Arc::from(cwd),
                    workspace_file: WorkspaceFile::PnpmWorkspaceYaml(file_with_path),
                },
                relative_cwd,
            ));
        }

        // Check for package.json with workspaces field for npm/yarn workspace
        let package_json_path: Arc<AbsolutePath> = cwd.join("package.json").into();
        if let Some(mut file_with_path) = FileWithPath::open_if_exists(package_json_path)? {
            let package_json: serde_json::Value =
                serde_json::from_reader(BufReader::new(file_with_path.file())).map_err(|e| {
                    Error::SerdeJson {
                        file_path: Arc::clone(file_with_path.path()),
                        serde_json_error: e,
                    }
                })?;
            if package_json.get("workspaces").is_some() {
                // Reset the file cursor since we consumed it reading
                file_with_path.file_mut().seek(SeekFrom::Start(0))?;
                let relative_cwd =
                    original_cwd.strip_prefix(cwd)?.expect("cwd must be within the workspace");
                return Ok((
                    WorkspaceRoot {
                        path: Arc::from(cwd),
                        workspace_file: WorkspaceFile::NpmWorkspaceJson(file_with_path),
                    },
                    relative_cwd,
                ));
            }
        }

        // TODO(@fengmk2): other package manager support

        // Move up one directory
        if let Some(parent) = cwd.parent() {
            cwd = parent;
        } else {
            // We've reached the root, try to find the package root and return the non-workspace package.
            let package_root = find_package_root(original_cwd)?;
            let workspace_file = WorkspaceFile::NonWorkspacePackage(package_root.package_json);
            return Ok((
                WorkspaceRoot { path: Arc::from(package_root.path), workspace_file },
                package_root.cwd,
            ));
        }
    }
}
