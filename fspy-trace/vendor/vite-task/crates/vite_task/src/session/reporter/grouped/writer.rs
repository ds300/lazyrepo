//! A [`Write`] wrapper that buffers all output for later retrieval.

use std::{
    cell::RefCell,
    io::{self, Write},
    rc::Rc,
};

/// Writer that buffers all output into a shared buffer.
///
/// Both stdout and stderr [`GroupedWriter`]s for a task share the same
/// `Rc<RefCell<Vec<u8>>>` buffer, so output is naturally interleaved in
/// arrival order. The buffer is read and flushed as a block when the
/// task completes.
pub struct GroupedWriter {
    buffer: Rc<RefCell<Vec<u8>>>,
}

impl GroupedWriter {
    pub const fn new(buffer: Rc<RefCell<Vec<u8>>>) -> Self {
        Self { buffer }
    }
}

impl Write for GroupedWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.buffer.borrow_mut().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        // No-op — output is flushed as a block by the reporter on task completion.
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buffers_output() {
        let buffer = Rc::new(RefCell::new(Vec::new()));
        let mut writer = GroupedWriter::new(Rc::clone(&buffer));
        writer.write_all(b"hello ").unwrap();
        writer.write_all(b"world").unwrap();
        assert_eq!(&*buffer.borrow(), b"hello world");
    }

    #[test]
    fn shared_buffer_interleaves() {
        let buffer = Rc::new(RefCell::new(Vec::new()));
        let mut stdout = GroupedWriter::new(Rc::clone(&buffer));
        let mut stderr = GroupedWriter::new(Rc::clone(&buffer));
        stdout.write_all(b"out1\n").unwrap();
        stderr.write_all(b"err1\n").unwrap();
        stdout.write_all(b"out2\n").unwrap();
        assert_eq!(&*buffer.borrow(), b"out1\nerr1\nout2\n");
    }
}
