/// Prefix for hyperlink URI payload that carries milestone data.
const MILESTONE_URI_PREFIX: &str = "https://milestone.invalid/";
/// Terminator for OSC sequences using ST (`ESC \`).
const OSC_ST: &str = "\x1b\\";
/// Invisible hyperlink text anchor.
const MILESTONE_HYPERTEXT: &str = "\u{200b}";
/// OSC 8 close sequence.
pub const MILESTONE_FENCE: &[u8] = b"\x1b]8;;\x1b\\";

/// Builds an OSC 8 marker with milestone name encoded in the hyperlink URI.
///
/// Format:
/// `OSC 8 ; ; https://milestone.invalid/<hex(name)> ST <ZWSP> OSC 8 ; ; ST`.
#[must_use]
pub fn encoded_milestone(name: &str) -> Vec<u8> {
    use std::fmt::Write as _;

    let mut hex = String::with_capacity(name.len() * 2);
    for &byte in name.as_bytes() {
        write!(&mut hex, "{byte:02x}").unwrap();
    }

    let mut seq = String::new();
    write!(&mut seq, "\x1b]8;;{MILESTONE_URI_PREFIX}{hex}{OSC_ST}").unwrap();
    seq.push_str(MILESTONE_HYPERTEXT);
    write!(&mut seq, "\x1b]8;;{OSC_ST}").unwrap();
    seq.into_bytes()
}

const fn decode_hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Decodes a milestone name from OSC 8 parameters if present.
///
/// Expects VT parser parameters for OSC 8 in the form:
/// - open: `["8", "<params>", "<uri>"]`
/// - close: `["8", "", ""]`
///
/// Returns `Some(name)` only when the URI uses the milestone prefix and the
/// suffix is valid hex-encoded UTF-8.
#[must_use]
pub fn decode_milestone_from_osc8_params(params: &[Vec<u8>]) -> Option<String> {
    if params.first().is_none_or(|p| p.as_slice() != b"8") {
        return None;
    }

    let uri = params.get(2)?.as_slice();
    let encoded = uri.strip_prefix(MILESTONE_URI_PREFIX.as_bytes())?;
    if encoded.is_empty() || encoded.len() % 2 != 0 {
        return None;
    }

    let mut bytes = Vec::with_capacity(encoded.len() / 2);
    for pair in encoded.chunks_exact(2) {
        let high = decode_hex_nibble(pair[0])?;
        let low = decode_hex_nibble(pair[1])?;
        bytes.push((high << 4) | low);
    }

    String::from_utf8(bytes).ok()
}

/// Emits a milestone marker as OSC 8 hyperlink metadata.
///
/// The child process calls this to signal it has reached a named synchronization
/// point. The test harness (via `pty_terminal_test::Reader::expect_milestone`)
/// detects this marker and returns the screen contents at that point.
///
/// On Windows, `ConPTY` passes control sequences directly to the
/// output pipe (synchronous, inline with input processing), while rendered
/// character output is generated asynchronously by a separate output thread
/// that polls the console buffer. This means the marker can arrive at the
/// reader before preceding character output has been emitted.
///
/// Milestones include a zero-width hyperlink anchor (`U+200B`) before closing.
/// This keeps the hyperlink metadata observable in `ConPTY` output paths that can
/// drop zero-length hyperlinks.
///
/// When the `testing` feature is disabled, this is a no-op.
///
/// # Panics
///
/// Panics if writing to stdout fails.
#[cfg(feature = "testing")]
pub fn mark_milestone(name: &str) {
    use std::io::{Write, stdout};

    let milestone = encoded_milestone(name);
    let mut stdout = stdout();
    // Flush prior output, then emit milestone sequence.
    stdout.flush().unwrap();
    stdout.write_all(&milestone).unwrap();

    stdout.flush().unwrap();
}

/// Emits a milestone marker as a private OSC escape sequence.
///
/// When the `testing` feature is disabled, this is a no-op.
#[cfg(not(feature = "testing"))]
pub const fn mark_milestone(_name: &str) {}
