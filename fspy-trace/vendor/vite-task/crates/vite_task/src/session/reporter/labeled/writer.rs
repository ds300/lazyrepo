//! A [`Write`] wrapper that prefixes each line with a label (e.g., `[pkg#task] `).

use std::io::{self, Write};

/// Writer that prefixes each complete line with a label.
///
/// Data is buffered internally. On [`flush`](Write::flush), complete lines
/// (terminated by `\n`) are written to the inner writer with the prefix
/// prepended. Any trailing partial line is kept in the buffer until the
/// next flush.
pub struct LabeledWriter {
    inner: Box<dyn Write>,
    prefix: Vec<u8>,
    buffer: Vec<u8>,
}

impl LabeledWriter {
    pub fn new(inner: Box<dyn Write>, prefix: Vec<u8>) -> Self {
        Self { inner, prefix, buffer: Vec::new() }
    }
}

impl Write for LabeledWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.buffer.extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        // Find the last newline — everything up to (and including) it can be
        // split into complete lines and written with prefixes.
        let last_nl = self.buffer.iter().rposition(|&b| b == b'\n');
        let Some(last_nl) = last_nl else {
            // No complete lines yet — keep buffering.
            return Ok(());
        };

        // Split off the complete portion (0..=last_nl) from any trailing partial line.
        let remaining = self.buffer.split_off(last_nl + 1);
        let complete = std::mem::replace(&mut self.buffer, remaining);

        // Batch prefix + line into a single write to reduce syscall overhead.
        let mut prefixed = Vec::new();
        for line in complete.split_inclusive(|&b| b == b'\n') {
            prefixed.extend_from_slice(&self.prefix);
            prefixed.extend_from_slice(line);
        }
        self.inner.write_all(&prefixed)?;

        self.inner.flush()
    }
}

impl Drop for LabeledWriter {
    fn drop(&mut self) {
        // Flush any remaining partial line on drop.
        if !self.buffer.is_empty() {
            let buf = std::mem::take(&mut self.buffer);
            let _ = self.inner.write_all(&self.prefix);
            let _ = self.inner.write_all(&buf);
            let _ = self.inner.flush();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labeled_output(prefix: &str, chunks: &[&[u8]]) -> Vec<u8> {
        let output = Vec::new();
        let mut writer = LabeledWriter::new(Box::new(output), prefix.as_bytes().to_vec());
        for chunk in chunks {
            writer.write_all(chunk).unwrap();
            writer.flush().unwrap();
        }
        drop(writer);
        // We need to get the inner writer back — reconstruct by running again
        // and capturing output via a shared buffer.
        let output = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
        let output_clone = std::rc::Rc::clone(&output);
        {
            let mut writer =
                LabeledWriter::new(Box::new(RcWriter(output_clone)), prefix.as_bytes().to_vec());
            for chunk in chunks {
                writer.write_all(chunk).unwrap();
                writer.flush().unwrap();
            }
        }
        std::rc::Rc::try_unwrap(output).unwrap().into_inner()
    }

    struct RcWriter(std::rc::Rc<std::cell::RefCell<Vec<u8>>>);

    impl Write for RcWriter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.0.borrow_mut().extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn single_complete_line() {
        let result = labeled_output("[app] ", &[b"hello\n"]);
        assert_eq!(result, b"[app] hello\n");
    }

    #[test]
    fn multiple_lines_in_one_chunk() {
        let result = labeled_output("[a] ", &[b"line1\nline2\n"]);
        assert_eq!(result, b"[a] line1\n[a] line2\n");
    }

    #[test]
    fn partial_line_flushed_on_drop() {
        let result = labeled_output("[x] ", &[b"no newline"]);
        assert_eq!(result, b"[x] no newline");
    }

    #[test]
    fn split_across_chunks() {
        let result = labeled_output("[p] ", &[b"split ", b"line\n"]);
        assert_eq!(result, b"[p] split line\n");
    }

    #[test]
    fn empty_line() {
        let result = labeled_output("[e] ", &[b"\n"]);
        assert_eq!(result, b"[e] \n");
    }

    #[test]
    fn multiple_flushes_with_partial() {
        let result = labeled_output("[m] ", &[b"a\nb", b"c\n"]);
        assert_eq!(result, b"[m] a\n[m] bc\n");
    }
}
