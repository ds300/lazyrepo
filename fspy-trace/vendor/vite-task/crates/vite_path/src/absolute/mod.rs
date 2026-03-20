#[cfg(feature = "absolute-redaction")]
pub mod redaction;

use std::{
    ffi::OsStr,
    fmt::{Debug, Display},
    hash::Hash,
    ops::Deref,
    path::{Path, PathBuf},
    sync::Arc,
};

use ref_cast::{RefCastCustom, ref_cast_custom};
use serde::Serialize;

use crate::relative::{FromPathError, InvalidPathDataError, RelativePathBuf};

/// A path that is guaranteed to be absolute
#[derive(RefCastCustom, PartialEq, Eq, PartialOrd, Ord)]
#[repr(transparent)]
pub struct AbsolutePath(Path);
impl AsRef<Self> for AbsolutePath {
    fn as_ref(&self) -> &Self {
        self
    }
}

impl Debug for AbsolutePath {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        Debug::fmt(&self.0, f)
    }
}

impl Display for AbsolutePath {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        Display::fmt(&self.0.display(), f)
    }
}

impl Serialize for AbsolutePath {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        #[cfg(feature = "absolute-redaction")]
        if let Some(redacted_path) = self.try_redact().map_err(serde::ser::Error::custom)? {
            return serializer.serialize_str(&redacted_path);
        }
        self.as_path().serialize(serializer)
    }
}

impl PartialEq<AbsolutePathBuf> for AbsolutePath {
    fn eq(&self, other: &AbsolutePathBuf) -> bool {
        self.0 == other.0
    }
}
impl PartialEq<AbsolutePathBuf> for &AbsolutePath {
    fn eq(&self, other: &AbsolutePathBuf) -> bool {
        self.0 == other.0
    }
}

impl Hash for AbsolutePath {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.0.hash(state);
    }
}

impl From<&AbsolutePath> for Arc<AbsolutePath> {
    fn from(path: &AbsolutePath) -> Self {
        let arc: Arc<Path> = path.0.into();
        let arc_raw = Arc::into_raw(arc) as *const AbsolutePath;
        // SAFETY: AbsolutePath is #[repr(transparent)] over Path, so the pointer cast
        // from Arc<Path> to Arc<AbsolutePath> preserves layout. The source path is
        // already verified absolute since it comes from an &AbsolutePath.
        unsafe { Self::from_raw(arc_raw) }
    }
}

impl From<&AbsolutePath> for Box<AbsolutePath> {
    fn from(path: &AbsolutePath) -> Self {
        let path_box: Box<Path> = path.0.into();
        let path_box_raw = Box::into_raw(path_box) as *mut AbsolutePath;
        // SAFETY: AbsolutePath is #[repr(transparent)] over Path, so the pointer cast
        // from Box<Path> to Box<AbsolutePath> preserves layout. The source path is
        // already verified absolute since it comes from an &AbsolutePath.
        unsafe { Self::from_raw(path_box_raw) }
    }
}

impl AbsolutePath {
    /// Creates a [`AbsolutePath`] if the give path is absolute.
    pub fn new<P: AsRef<Path> + ?Sized>(path: &P) -> Option<&Self> {
        let path = path.as_ref();
        if path.is_absolute() {
            // SAFETY: We just verified that path.is_absolute() is true.
            Some(unsafe { Self::assume_absolute(path) })
        } else {
            None
        }
    }

    #[cfg(feature = "absolute-redaction")]
    #[expect(
        clippy::disallowed_types,
        clippy::disallowed_macros,
        reason = "try_redact returns std String and uses std format!"
    )]
    fn try_redact(&self) -> Result<Option<String>, String> {
        use redaction::REDACTION_PREFIX;

        if let Some(redaction_prefix) = REDACTION_PREFIX
            .with(|redaction_prefix| redaction_prefix.borrow().as_ref().map(Arc::clone))
        {
            match self.strip_prefix(redaction_prefix) {
                Ok(Some(stripped_path)) => {
                    return Ok(Some(format!("<redacted>/{}", stripped_path.as_str())));
                }
                Err(strip_error) => {
                    return Err(format!(
                        "Failed to redact absolute path '{}': {}",
                        self.as_path().display(),
                        strip_error
                    ));
                }
                Ok(None) => { /* continue to serialize full path */ }
            }
        }
        Ok(None)
    }

    #[ref_cast_custom]
    pub(crate) unsafe fn assume_absolute(abs_path: &Path) -> &Self;

    /// Gets the underlying [`Path`]
    #[must_use]
    pub const fn as_path(&self) -> &Path {
        &self.0
    }

    /// Converts `self` to an owned [`AbsolutePathBuf`].
    #[must_use]
    pub fn to_absolute_path_buf(&self) -> AbsolutePathBuf {
        // SAFETY: self is already an AbsolutePath, so its path data is absolute.
        unsafe { AbsolutePathBuf::assume_absolute(self.0.to_path_buf()) }
    }

    /// Returns a path that, when joined onto base, yields self.
    ///
    /// If `base` is not a prefix of `self`, returns [`None`].
    ///
    /// If the stripped path is not a valid `RelativePath`. Returns an error with the reason and the stripped path.
    ///
    /// # Errors
    ///
    /// Returns an error if the stripped path contains invalid UTF-8 or other path data issues.
    pub fn strip_prefix<P: AsRef<Self>>(
        &self,
        base: P,
    ) -> Result<Option<RelativePathBuf>, StripPrefixError<'_>> {
        let base = base.as_ref();
        let Ok(stripped_path) = self.0.strip_prefix(&base.0) else {
            return Ok(None);
        };
        match RelativePathBuf::new(stripped_path) {
            Ok(relative_path) => Ok(Some(relative_path)),
            Err(FromPathError::NonRelative) => {
                unreachable!("stripped path should always be relative")
            }
            Err(FromPathError::InvalidPathData(invalid_path_data_error)) => {
                Err(StripPrefixError { stripped_path, invalid_path_data_error })
            }
        }
    }

    /// Creates an owned [`AbsolutePathBuf`] with `path` adjoined to `self`.
    pub fn join<P: AsRef<Path>>(&self, path: P) -> AbsolutePathBuf {
        let mut absolute_path_buf = self.to_absolute_path_buf();
        absolute_path_buf.push(path);
        absolute_path_buf
    }

    /// Returns the parent directory of `self`, or `None` if `self` is the root.
    #[must_use]
    pub fn parent(&self) -> Option<&Self> {
        let parent_path = self.0.parent()?;
        // SAFETY: The parent of an absolute path is always absolute.
        Some(unsafe { Self::assume_absolute(parent_path) })
    }

    /// Creates an owned [`AbsolutePathBuf`] like `self` but with the extension added.
    pub fn with_extension<S: AsRef<OsStr>>(&self, extension: S) -> AbsolutePathBuf {
        let path = self.0.with_extension(extension);
        // SAFETY: Changing the extension of an absolute path preserves its absoluteness.
        unsafe { AbsolutePathBuf::assume_absolute(path) }
    }

    /// Returns true if `self` ends with `path`.
    pub fn ends_with<P: AsRef<Path>>(&self, path: P) -> bool {
        self.0.ends_with(path.as_ref())
    }

    /// Lexically normalizes the path by resolving `.` and `..` components
    /// without accessing the filesystem.
    ///
    /// **Symlink limitation**: Because this is purely lexical, it can produce
    /// incorrect results when symlinks are involved. For example, if
    /// `/a/link` is a symlink to `/x/y`, then cleaning `/a/link/../c`
    /// yields `/a/c` instead of the correct `/x/c`. Use
    /// [`std::fs::canonicalize`] when you need symlink-correct resolution.
    #[must_use]
    pub fn clean(&self) -> AbsolutePathBuf {
        use path_clean::PathClean as _;

        let cleaned = self.0.clean();
        // SAFETY: Lexical cleaning of an absolute path preserves absoluteness —
        // it only removes `.`/`..` components and redundant separators.
        unsafe { AbsolutePathBuf::assume_absolute(cleaned) }
    }
}

/// An Error returned from [`AbsolutePath::strip_prefix`] if the stripped path is not a valid `RelativePath`
#[derive(thiserror::Error, Debug)]
pub struct StripPrefixError<'a> {
    pub stripped_path: &'a Path,
    #[source]
    pub invalid_path_data_error: InvalidPathDataError,
}

impl Display for StripPrefixError<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_fmt(format_args!(
            "{}: {}",
            self.stripped_path.display(),
            &self.invalid_path_data_error
        ))
    }
}

impl AsRef<Path> for AbsolutePath {
    fn as_ref(&self) -> &Path {
        self.as_path()
    }
}

/// An owned path buf that is guaranteed to be absolute
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct AbsolutePathBuf(PathBuf);

impl From<AbsolutePathBuf> for Arc<AbsolutePath> {
    fn from(path: AbsolutePathBuf) -> Self {
        let arc: Arc<Path> = path.0.into();
        let arc_raw = Arc::into_raw(arc) as *const AbsolutePath;
        // SAFETY: AbsolutePath is #[repr(transparent)] over Path, so the pointer cast
        // from Arc<Path> to Arc<AbsolutePath> preserves layout. The source path is
        // already verified absolute since it comes from an AbsolutePathBuf.
        unsafe { Self::from_raw(arc_raw) }
    }
}

impl AbsolutePathBuf {
    #[must_use]
    pub fn new(path: PathBuf) -> Option<Self> {
        if path.is_absolute() {
            // SAFETY: We just verified that path.is_absolute() is true.
            Some(unsafe { Self::assume_absolute(path) })
        } else {
            None
        }
    }

    /// # Safety
    /// The caller must ensure that `abs_path` is an absolute path.
    #[must_use]
    pub const unsafe fn assume_absolute(abs_path: PathBuf) -> Self {
        Self(abs_path)
    }

    #[must_use]
    pub fn as_absolute_path(&self) -> &AbsolutePath {
        // SAFETY: self is an AbsolutePathBuf, so its inner PathBuf is guaranteed absolute.
        unsafe { AbsolutePath::assume_absolute(self.0.as_path()) }
    }

    /// Extends `self` with `path`.
    ///
    /// `path` replaces `self` only when `path` is absolute. Either way, the resulting `self` is always absolute.
    pub fn push<P: AsRef<Path>>(&mut self, path: P) {
        self.0.push(path.as_ref());
    }

    #[must_use]
    pub fn into_path_buf(self) -> PathBuf {
        self.0
    }
}

impl PartialEq<AbsolutePath> for AbsolutePathBuf {
    fn eq(&self, other: &AbsolutePath) -> bool {
        self.as_absolute_path().eq(other)
    }
}
impl PartialEq<&AbsolutePath> for AbsolutePathBuf {
    fn eq(&self, other: &&AbsolutePath) -> bool {
        self.as_absolute_path().eq(*other)
    }
}

impl AsRef<Path> for AbsolutePathBuf {
    fn as_ref(&self) -> &Path {
        self.as_absolute_path().as_path()
    }
}
impl AsRef<AbsolutePath> for AbsolutePathBuf {
    fn as_ref(&self) -> &AbsolutePath {
        self.as_absolute_path()
    }
}

impl Deref for AbsolutePathBuf {
    type Target = AbsolutePath;

    fn deref(&self) -> &Self::Target {
        self.as_absolute_path()
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    #[test]
    fn non_absolute() {
        assert!(AbsolutePath::new(Path::new("foo/bar")).is_none());
    }

    #[test]
    fn strip_prefix() {
        let abs_path = AbsolutePath::new(Path::new(if cfg!(windows) {
            "C:\\Users\\foo\\bar"
        } else {
            "/home/foo/bar"
        }))
        .unwrap();

        let prefix =
            AbsolutePath::new(Path::new(if cfg!(windows) { "C:\\Users" } else { "/home" }))
                .unwrap();

        let rel_path = abs_path.strip_prefix(prefix).unwrap().unwrap();
        assert_eq!(rel_path.as_str(), "foo/bar");

        assert_eq!(prefix.join(&rel_path), abs_path);
        let mut pushed_path = prefix.to_absolute_path_buf();
        pushed_path.push(rel_path);

        assert_eq!(pushed_path, abs_path);
    }

    #[test]
    fn strip_prefix_trailing_slash() {
        let abs_path = AbsolutePath::new(Path::new(if cfg!(windows) {
            "C:\\Users\\foo\\bar"
        } else {
            "/home/foo/bar"
        }))
        .unwrap();

        let prefix =
            AbsolutePath::new(Path::new(if cfg!(windows) { "C:\\Users\\" } else { "/home//" }))
                .unwrap();

        let rel_path = abs_path.strip_prefix(prefix).unwrap().unwrap();
        assert_eq!(rel_path.as_str(), "foo/bar");
    }

    #[test]
    fn strip_prefix_not_found() {
        let abs_path = AbsolutePath::new(Path::new(if cfg!(windows) {
            "C:\\Users\\foo\\bar"
        } else {
            "/home/foo/bar"
        }))
        .unwrap();

        let prefix = AbsolutePath::new(Path::new(if cfg!(windows) {
            "C:\\Users\\barz"
        } else {
            "/home/baz"
        }))
        .unwrap();

        let rel_path = abs_path.strip_prefix(prefix).unwrap();
        assert!(rel_path.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn strip_prefix_invalid_relative() {
        use std::{ffi::OsStr, os::unix::ffi::OsStrExt};

        use assert2::let_assert;

        let mut abs_path = b"/home/".to_vec();
        abs_path.push(0xC0);
        let abs_path = AbsolutePath::new(Path::new(OsStr::from_bytes(&abs_path))).unwrap();

        let prefix = AbsolutePath::new(Path::new("/home")).unwrap();
        let_assert!(Err(err) = abs_path.strip_prefix(prefix));

        assert_eq!(err.stripped_path.as_os_str().as_bytes(), &[0xC0]);
        let_assert!(InvalidPathDataError::NonUtf8 = err.invalid_path_data_error);
    }

    #[test]
    #[cfg(not(windows))]
    fn with_extension() {
        let abs_path = AbsolutePath::new(Path::new("/home/foo/bar")).unwrap();
        let abs_path_with_extension = abs_path.with_extension("txt");
        assert_eq!(abs_path_with_extension.as_path().as_os_str(), "/home/foo/bar.txt");
        let abs_path_with_extension = abs_path.with_extension("txt").with_extension("tgz");
        assert_eq!(abs_path_with_extension.as_path().as_os_str(), "/home/foo/bar.tgz");
        // abs_path is not changed
        assert_eq!(abs_path.as_path().as_os_str(), "/home/foo/bar");
    }
    #[test]
    #[cfg(windows)]
    fn with_extension() {
        let abs_path = AbsolutePath::new(Path::new("C:\\home\\foo\\bar")).unwrap();
        let abs_path_with_extension = abs_path.with_extension("txt");
        assert_eq!(abs_path_with_extension.as_path().as_os_str(), "C:\\home\\foo\\bar.txt");
        let abs_path_with_extension = abs_path.with_extension("txt").with_extension("tgz");
        assert_eq!(abs_path_with_extension.as_path().as_os_str(), "C:\\home\\foo\\bar.tgz");
        // abs_path is not changed
        assert_eq!(abs_path.as_path().as_os_str(), "C:\\home\\foo\\bar");
    }
}
