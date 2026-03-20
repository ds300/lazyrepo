use std::borrow::Cow;

#[expect(
    clippy::disallowed_types,
    reason = "String mutation required by regex replace and cow_replace APIs"
)]
fn redact_string(s: &mut String, redactions: &[(&str, &str)]) {
    use cow_utils::CowUtils as _;
    for (from, to) in redactions {
        if let Cow::Owned(mut replaced) = s.as_str().cow_replace(from, to) {
            if cfg!(windows) {
                // Also replace with backslashes on Windows
                replaced = replaced.cow_replace("\\", "/").into_owned();
            }
            *s = replaced;
        }
    }
}

#[expect(
    clippy::disallowed_types,
    reason = "String required by regex replace_all and cow_replace APIs; Path required for CARGO_MANIFEST_DIR path manipulation"
)]
pub fn redact_e2e_output(mut output: String, workspace_root: &str) -> String {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    // Get the packages/tools directory path
    let tools_dir = std::path::Path::new(&manifest_dir)
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("packages")
        .join("tools");
    let tools_dir_str = tools_dir.to_str().unwrap();

    redact_string(
        &mut output,
        &[
            (workspace_root, "<workspace>"),
            (manifest_dir.as_str(), "<manifest_dir>"),
            (tools_dir_str, "<tools>"),
        ],
    );

    // Redact durations like "123ms" or "1.23s" to "<duration>ms" or "<duration>s"
    let duration_regex = regex::Regex::new(r"\d+(\.\d+)?(ms|s)").unwrap();
    output = duration_regex.replace_all(&output, "<duration>").into_owned();

    // Redact thread counts like "using 10 threads" to "using <n> threads"
    let thread_regex = regex::Regex::new(r"using \d+ threads").unwrap();
    output = thread_regex.replace_all(&output, "using <n> threads").into_owned();

    // Remove Node.js experimental warnings (e.g., Type Stripping warnings)
    let node_warning_regex =
        regex::Regex::new(r"(?m)^\(node:\d+\) ExperimentalWarning:.*\n?").unwrap();
    output = node_warning_regex.replace_all(&output, "").into_owned();
    let node_trace_warning_regex = regex::Regex::new(
        r"(?m)^\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\n?",
    )
    .unwrap();
    output = node_trace_warning_regex.replace_all(&output, "").into_owned();

    // Remove nondeterministic mise warnings from shell startup in cross-platform runners.
    let mise_warning_regex = regex::Regex::new(r"(?m)^mise WARN\s+.*\n?").unwrap();
    output = mise_warning_regex.replace_all(&output, "").into_owned();

    // Sort consecutive diagnostic blocks to handle non-deterministic tool output
    // (e.g., oxlint reports warnings in arbitrary order due to multi-threading).
    // Each block starts with "  ! " and ends at the next empty line.
    output = sort_diagnostic_blocks(&output);

    output
}

#[expect(
    clippy::disallowed_types,
    reason = "String return required because join produces a String"
)]
fn sort_diagnostic_blocks(output: &str) -> String {
    let parts: Vec<&str> = output.split('\n').collect();
    let mut result: Vec<&str> = Vec::new();
    let mut i = 0;

    while i < parts.len() {
        if parts[i].starts_with("  ! ") {
            let mut blocks: Vec<Vec<&str>> = Vec::new();

            loop {
                if i >= parts.len() || !parts[i].starts_with("  ! ") {
                    break;
                }
                let mut block: Vec<&str> = Vec::new();
                while i < parts.len() && !parts[i].is_empty() {
                    block.push(parts[i]);
                    i += 1;
                }
                blocks.push(block);
                // Skip the empty line separator between blocks
                if i < parts.len() && parts[i].is_empty() {
                    i += 1;
                }
            }

            blocks.sort();

            for (j, block) in blocks.iter().enumerate() {
                result.extend_from_slice(block);
                // Restore empty line separators (between blocks + trailing)
                if j < blocks.len() - 1 || i <= parts.len() {
                    result.push("");
                }
            }
        } else {
            result.push(parts[i]);
            i += 1;
        }
    }

    result.join("\n")
}
