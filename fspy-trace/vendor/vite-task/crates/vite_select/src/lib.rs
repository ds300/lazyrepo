mod fuzzy;
mod interactive;

use std::io::Write;

pub use fuzzy::fuzzy_match;
use interactive::{RenderParams, build_display_rows, render_items};
use vite_str::Str;

/// An item in the selection list.
pub struct SelectItem {
    /// Searchable label, e.g. `"build"` or `"app#build"`. Used for fuzzy matching.
    pub label: Str,
    /// Display name shown in the list, e.g. `"build"` (tree view) or `"app#build"` (flat).
    pub display_name: Str,
    /// Description shown next to the display name, e.g. `"echo build app"`.
    pub description: Str,
    /// Group header text. Items sharing the same group render together under a
    /// header line. `None` = top-level (no header).
    pub group: Option<Str>,
}

/// Selection mode.
pub enum Mode<'a> {
    /// Interactive terminal UI with fuzzy search, keyboard navigation, and selection.
    ///
    /// On Enter, `*selected_index` is set to the index of the chosen item
    /// in the original `items` slice.
    Interactive { selected_index: &'a mut usize },
    /// Non-interactive: renders the list once and returns.
    NonInteractive,
}

/// Snapshot of the selector's visible state, passed to `after_render`.
pub struct RenderState<'a> {
    /// Current search text (empty if no filter typed yet).
    pub query: &'a str,
    /// Index of the highlighted item in the **filtered** list.
    pub selected_index: usize,
}

/// Parameters for [`select_list`].
pub struct SelectParams<'a> {
    pub items: &'a [SelectItem],
    /// Initial search query (pre-filled in interactive, used as filter in non-interactive).
    pub query: Option<&'a str>,
    /// Header line rendered above the list (e.g. an error message).
    pub header: Option<&'a str>,
    /// Max visible rows (interactive only).
    pub page_size: usize,
}

/// Show a task selection list.
///
/// In [`Mode::Interactive`], enters a terminal UI with fuzzy search and
/// keyboard navigation. `after_render` is called after every render with the
/// current visible state (useful for emitting test milestones). On Enter,
/// `*selected_index` is set to the chosen item's index in the original
/// `items` slice.
///
/// In [`Mode::NonInteractive`], renders the list once to `writer` and
/// returns. `page_size` and `after_render` are ignored.
///
/// # Errors
///
/// Returns an error if terminal I/O fails.
pub fn select_list(
    writer: &mut impl Write,
    params: &SelectParams<'_>,
    mode: Mode<'_>,
    after_render: impl FnMut(&RenderState<'_>),
) -> anyhow::Result<()> {
    match mode {
        Mode::Interactive { selected_index } => interactive::run(
            params.items,
            params.query,
            selected_index,
            params.header,
            params.page_size,
            after_render,
        ),
        Mode::NonInteractive => non_interactive(writer, params.items, params.query, params.header),
    }
}

fn non_interactive(
    writer: &mut impl Write,
    items: &[SelectItem],
    query: Option<&str>,
    header: Option<&str>,
) -> anyhow::Result<()> {
    let display_rows = build_display_rows(items, query.unwrap_or_default());

    // When there are no matching items, just print the header (if any) and
    // return early — avoids showing a redundant "No matching tasks." line
    // after a "not found" header.
    let has_items = display_rows.iter().any(interactive::DisplayRow::is_item);
    if !has_items {
        if let Some(h) = header {
            writeln!(writer, "{h}")?;
        }
        return Ok(());
    }

    let row_count = display_rows.len();

    render_items(
        writer,
        &RenderParams {
            items,
            display_rows: &display_rows,
            selected: None,
            visible_row_range: 0..row_count,
            hidden_count: 0,
            header,
            query: None,
            show_group_headers: false,
            line_ending: "\n",
            max_line_width: usize::MAX,
        },
    )?;

    Ok(())
}
