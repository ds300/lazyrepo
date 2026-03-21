use std::io::{Write, stdout};

use crossterm::{
    cursor::{self, MoveToColumn},
    event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers},
    style::{Attribute, Color, SetAttribute, SetForegroundColor},
    terminal::{self, Clear, ClearType},
};
use vite_str::Str;

use crate::{RenderState, SelectItem, fuzzy::fuzzy_match};

/// Prefix width for root-level items (`"  › "` or `"    "`).
const ROOT_PREFIX_WIDTH: usize = 4;
/// Prefix width for grouped items (`"    › "` or `"      "`).
const GROUP_PREFIX_WIDTH: usize = 6;

struct RawModeGuard;

impl RawModeGuard {
    fn enable() -> anyhow::Result<Self> {
        terminal::enable_raw_mode()?;
        Ok(Self)
    }
}

impl Drop for RawModeGuard {
    fn drop(&mut self) {
        let _ = terminal::disable_raw_mode();
    }
}

/// A row in the flattened display list.
pub enum DisplayRow {
    /// Non-selectable group header line.
    Header(Str),
    /// Selectable item. `item_index` is the index into the original `items` slice.
    Item { item_index: usize },
}

impl DisplayRow {
    pub const fn is_item(&self) -> bool {
        matches!(self, Self::Item { .. })
    }
}

/// Filter, group, and flatten items into display rows.
///
/// Pipeline: fuzzy match → group by `SelectItem::group` (current-package first)
/// → insert header rows at group boundaries.
pub fn build_display_rows(items: &[SelectItem], query: &str) -> Vec<DisplayRow> {
    let labels: Vec<&str> = items.iter().map(|i| i.label.as_str()).collect();
    let mut filtered = fuzzy_match(query, &labels);
    group_filtered(items, &mut filtered);

    let mut rows = Vec::new();
    let mut current_group: Option<Option<&str>> = None;
    for &item_idx in &filtered {
        let group = items[item_idx].group.as_deref();
        if current_group != Some(group) {
            current_group = Some(group);
            if let Some(g) = group {
                rows.push(DisplayRow::Header(Str::from(g)));
            }
        }
        rows.push(DisplayRow::Item { item_index: item_idx });
    }
    rows
}

/// Reorder `filtered` so items are grouped by `SelectItem::group`.
///
/// Groups are ordered by the position of their best-matching item in the
/// original fuzzy-scored `filtered` list. Items with `group: None`
/// (current-package tasks) are always placed first.
fn group_filtered(items: &[SelectItem], filtered: &mut Vec<usize>) {
    // Collect group ordering: first-seen order preserves fuzzy rank.
    let mut group_order: Vec<Option<&str>> = Vec::new();
    for &idx in filtered.iter() {
        let group = items[idx].group.as_deref();
        if !group_order.contains(&group) {
            group_order.push(group);
        }
    }
    // Always put current-package group (None) first.
    if let Some(pos) = group_order.iter().position(Option::is_none)
        && pos != 0
    {
        let g = group_order.remove(pos);
        group_order.insert(0, g);
    }
    let mut new_filtered = Vec::with_capacity(filtered.len());
    for &group in &group_order {
        for &idx in filtered.iter() {
            if items[idx].group.as_deref() == group {
                new_filtered.push(idx);
            }
        }
    }
    *filtered = new_filtered;
}

struct State<'a> {
    items: &'a [SelectItem],
    /// Flattened display rows (headers + items): the single source of truth
    /// after filtering + grouping.
    display_rows: Vec<DisplayRow>,
    /// Cached count of selectable items in `display_rows`.
    item_count: usize,
    #[expect(
        clippy::disallowed_types,
        reason = "crossterm key events push chars one at a time; String is natural here"
    )]
    query: String,
    /// Index among selectable items (0 = first Item row, 1 = second, etc.).
    selected: usize,
    /// Index into `display_rows` — first visible row.
    scroll_offset: usize,
    /// Max visible lines (display rows) in the viewport.
    page_size: usize,
    /// Number of lines rendered in the last frame (for clearing).
    rendered_lines: usize,
}

impl<'a> State<'a> {
    fn new(items: &'a [SelectItem], initial_query: Option<&str>, page_size: usize) -> Self {
        let query = initial_query.unwrap_or_default().to_owned();
        let display_rows = build_display_rows(items, &query);
        let item_count = display_rows.iter().filter(|r| r.is_item()).count();
        Self {
            items,
            display_rows,
            item_count,
            query,
            selected: 0,
            scroll_offset: 0,
            page_size,
            rendered_lines: 0,
        }
    }

    fn refilter(&mut self) {
        self.display_rows = build_display_rows(self.items, &self.query);
        self.item_count = self.display_rows.iter().filter(|r| r.is_item()).count();
        self.selected = 0;
        self.scroll_offset = 0;
    }

    /// Find the display row index for the Nth selectable item.
    fn display_row_of_selected(&self) -> Option<usize> {
        let mut count = 0;
        for (i, row) in self.display_rows.iter().enumerate() {
            if row.is_item() {
                if count == self.selected {
                    return Some(i);
                }
                count += 1;
            }
        }
        None
    }

    /// Get the original item index for the currently selected item.
    fn selected_item_index(&self) -> Option<usize> {
        let row_idx = self.display_row_of_selected()?;
        match &self.display_rows[row_idx] {
            DisplayRow::Item { item_index } => Some(*item_index),
            DisplayRow::Header(_) => None,
        }
    }

    /// Ensure the selected item is within the visible viewport.
    fn ensure_selected_visible(&mut self) {
        let Some(row_idx) = self.display_row_of_selected() else {
            self.scroll_offset = 0;
            return;
        };
        if row_idx < self.scroll_offset {
            // If the selected item is a first item in a group, also show the header above it
            self.scroll_offset =
                if row_idx > 0 && matches!(self.display_rows[row_idx - 1], DisplayRow::Header(_)) {
                    row_idx - 1
                } else {
                    row_idx
                };
        } else if row_idx >= self.scroll_offset + self.page_size {
            self.scroll_offset = row_idx + 1 - self.page_size;
        }
    }

    fn move_up(&mut self) {
        if self.selected > 0 {
            self.selected -= 1;
            self.ensure_selected_visible();
        }
    }

    fn move_down(&mut self) {
        if self.item_count > 0 && self.selected < self.item_count - 1 {
            self.selected += 1;
            self.ensure_selected_visible();
        }
    }

    fn visible_display_rows(&self) -> std::ops::Range<usize> {
        let end = (self.scroll_offset + self.page_size).min(self.display_rows.len());
        self.scroll_offset..end
    }

    /// Count selectable items (not headers) beyond the visible window.
    fn hidden_item_count(&self) -> usize {
        let visible_end = (self.scroll_offset + self.page_size).min(self.display_rows.len());
        self.display_rows[visible_end..].iter().filter(|r| r.is_item()).count()
    }
}

/// Parameters for rendering a task list.
pub struct RenderParams<'a> {
    pub items: &'a [SelectItem],
    pub display_rows: &'a [DisplayRow],
    /// Which selectable item is highlighted (0-based among Item rows),
    /// or `None` for non-interactive.
    pub selected: Option<usize>,
    /// Which slice of `display_rows` to show.
    pub visible_row_range: std::ops::Range<usize>,
    /// Number of selectable items beyond the visible range.
    pub hidden_count: usize,
    pub header: Option<&'a str>,
    /// Current search text. `Some` enables the prompt line (interactive only).
    pub query: Option<&'a str>,
    /// Whether to render group header lines. When `false`, items are still
    /// grouped/sorted by `SelectItem::group` but headers are hidden.
    pub show_group_headers: bool,
    /// `"\r\n"` for raw mode, `"\n"` for normal.
    pub line_ending: &'a str,
    /// Maximum visible width per line. Descriptions are truncated to prevent
    /// line wrapping, which would break cursor-based clearing in interactive mode.
    /// Use `usize::MAX` to disable truncation (non-interactive / piped output).
    pub max_line_width: usize,
}

/// Truncate a description string to fit within `max_chars`, appending ellipsis if needed.
fn truncate_desc<'a>(desc: &'a str, max_chars: usize, buf: &'a mut Str) -> &'a str {
    let char_count = desc.chars().count();
    if char_count <= max_chars {
        return desc;
    }
    let take = max_chars.saturating_sub(1); // room for "…"
    #[expect(clippy::disallowed_types, reason = "intermediate collect for char truncation")]
    let prefix: std::string::String = desc.chars().take(take).collect();
    *buf = vite_str::format!("{prefix}\u{2026}");
    buf.as_str()
}

/// Render the item list. Shared rendering logic used by both interactive
/// and non-interactive modes (via [`crate::non_interactive`]).
///
/// Returns the number of lines written.
#[expect(clippy::too_many_lines, reason = "single rendering function with sequential layout logic")]
pub fn render_items(writer: &mut impl Write, params: &RenderParams<'_>) -> anyhow::Result<usize> {
    let RenderParams {
        items,
        display_rows,
        selected,
        visible_row_range,
        hidden_count,
        header,
        query,
        show_group_headers,
        line_ending,
        max_line_width: _,
    } = params;

    let mut lines = 0usize;

    // Header (e.g. error message)
    if let Some(header) = header {
        write!(writer, "{header}{line_ending}")?;
        lines += 1;
    }

    let is_interactive = query.is_some();

    // Prompt line (interactive only)
    if let Some(q) = query {
        // Print ": " separator before query only when query is non-empty,
        // to avoid a trailing space that Windows ConPTY would strip.
        if q.is_empty() {
            write!(
                writer,
                "Select a task (\u{2191}/\u{2193}, Enter to run, type to search):{line_ending}",
            )?;
        } else {
            write!(
                writer,
                "Select a task (\u{2191}/\u{2193}, Enter to run, type to search): {q}{line_ending}",
            )?;
        }
        write!(writer, "{line_ending}")?;
        lines += 2;
    }

    // Single pre-pass: compute has_groups, max_name_width, has_items, and
    // item_ordinal (count of Item rows before the visible range) together.
    let mut has_groups = false;
    let mut max_name_width = 0usize;
    let mut has_items = false;
    let mut item_ordinal = 0usize;
    if is_interactive {
        for (i, row) in display_rows.iter().enumerate() {
            match row {
                DisplayRow::Header(_) => has_groups = *show_group_headers,
                DisplayRow::Item { item_index } => {
                    has_items = true;
                    let w = items[*item_index].display_name.chars().count();
                    if w > max_name_width {
                        max_name_width = w;
                    }
                    if i < visible_row_range.start {
                        item_ordinal += 1;
                    }
                }
            }
        }
    } else {
        has_items = display_rows.iter().any(DisplayRow::is_item);
    }

    // Compute the absolute column where commands start (interactive only).
    // All items — root and grouped — align their descriptions to the same column.
    let max_prefix = if has_groups { GROUP_PREFIX_WIDTH } else { ROOT_PREFIX_WIDTH };
    // command_col = max_prefix + max_name_width + " "
    let command_col = if is_interactive { max_prefix + max_name_width + 1 } else { 0 };

    // Render visible display rows
    for ri in visible_row_range.clone() {
        let row = &display_rows[ri];
        match row {
            DisplayRow::Header(group_name) => {
                if !show_group_headers {
                    continue;
                }
                if is_interactive {
                    write!(
                        writer,
                        "    {dim}{name}{reset}{line_ending}",
                        dim = SetAttribute(Attribute::Dim),
                        name = group_name,
                        reset = SetAttribute(Attribute::Reset),
                    )?;
                } else {
                    write!(writer, "  {group_name}{line_ending}")?;
                }
                lines += 1;
            }
            DisplayRow::Item { item_index } => {
                let item = &items[*item_index];
                let is_selected = *selected == Some(item_ordinal);
                item_ordinal += 1;
                let is_in_group = item.group.is_some();

                let name = item.display_name.as_str();
                let name_width = name.chars().count();

                let prefix_width = if is_interactive {
                    if is_in_group { GROUP_PREFIX_WIDTH } else { ROOT_PREFIX_WIDTH }
                } else {
                    2
                };

                // Padding after name to align all commands at `command_col`.
                let name_padding =
                    if is_interactive { command_col - prefix_width - name_width - 1 } else { 0 };
                let max_desc_chars = params.max_line_width.saturating_sub(if is_interactive {
                    command_col
                } else {
                    prefix_width + name_width + 2
                });

                let mut truncated = Str::default();
                let display_desc =
                    truncate_desc(item.description.as_str(), max_desc_chars, &mut truncated);

                if is_interactive {
                    let prefix = match (is_selected, is_in_group) {
                        (true, true) => "  \u{203a}   ",
                        (true, false) => "  \u{203a} ",
                        (false, true) => "      ",
                        (false, false) => "    ",
                    };
                    let reset = SetAttribute(Attribute::Reset);
                    let dark_grey = SetForegroundColor(Color::DarkGrey);
                    if is_selected {
                        let blue = SetForegroundColor(Color::Blue);
                        let bold = SetAttribute(Attribute::Bold);
                        write!(
                            writer,
                            "{dark_grey}{prefix}{reset}{blue}{bold}{name}{reset}{dark_grey}{:>pad$} {desc}{reset}{line_ending}",
                            "",
                            pad = name_padding,
                            desc = display_desc,
                        )?;
                    } else {
                        write!(
                            writer,
                            "{prefix}{name}{dark_grey}{:>pad$} {desc}{reset}{line_ending}",
                            "",
                            pad = name_padding,
                            desc = display_desc,
                        )?;
                    }
                } else if is_selected {
                    let bold = SetAttribute(Attribute::Bold);
                    let reset = SetAttribute(Attribute::Reset);
                    write!(
                        writer,
                        "{bold}> {name}: {desc}{reset}{line_ending}",
                        name = item.display_name,
                        desc = display_desc,
                    )?;
                } else {
                    write!(writer, "  {}: {display_desc}{line_ending}", item.display_name)?;
                }
                lines += 1;
            }
        }
    }

    // Footer: hidden items count
    if *hidden_count > 0 {
        write!(writer, "  (\u{2026}{hidden_count} more){line_ending}")?;
        lines += 1;
    }

    // Empty state
    if !has_items {
        write!(writer, "  No matching tasks. Press Escape to clear search.{line_ending}")?;
        lines += 1;
    }

    writer.flush()?;
    Ok(lines)
}

fn render(
    stdout: &mut impl Write,
    state: &mut State<'_>,
    header: Option<&str>,
) -> anyhow::Result<()> {
    // Move cursor up to clear previous render
    if state.rendered_lines > 0 {
        let move_up = u16::try_from(state.rendered_lines)
            .expect("rendered_lines fits in u16: at most header + page_size + footer lines");
        crossterm::execute!(
            stdout,
            cursor::MoveUp(move_up),
            MoveToColumn(0),
            Clear(ClearType::FromCursorDown),
        )?;
    }

    // Query terminal width on each render to handle resize
    let max_line_width = terminal::size().map_or(80, |(w, _)| w as usize);

    let lines = render_items(
        stdout,
        &RenderParams {
            items: state.items,
            display_rows: &state.display_rows,
            selected: Some(state.selected),
            visible_row_range: state.visible_display_rows(),
            hidden_count: state.hidden_item_count(),
            header,
            query: Some(&state.query),
            show_group_headers: true,
            line_ending: "\r\n",
            max_line_width,
        },
    )?;

    state.rendered_lines = lines;
    Ok(())
}

pub fn run(
    items: &[SelectItem],
    initial_query: Option<&str>,
    selected_index: &mut usize,
    header: Option<&str>,
    page_size: usize,
    mut after_render: impl FnMut(&RenderState<'_>),
) -> anyhow::Result<()> {
    if items.is_empty() {
        anyhow::bail!("No tasks available");
    }

    let _guard = RawModeGuard::enable()?;
    // Hide cursor while the widget is active
    let mut out = stdout();
    crossterm::execute!(out, cursor::Hide)?;

    let mut state = State::new(items, initial_query, page_size);

    // Initial render
    render(&mut out, &mut state, header)?;
    after_render(&RenderState { query: &state.query, selected_index: state.selected });

    loop {
        let ev = event::read()?;
        match ev {
            Event::Key(KeyEvent { code, modifiers, kind: KeyEventKind::Press, .. }) => match code {
                KeyCode::Esc => {
                    // Clear the search query and reset the filter
                    state.query.clear();
                    state.refilter();
                }
                KeyCode::Char('c') if modifiers.contains(KeyModifiers::CONTROL) => {
                    cleanup(&mut out, &state)?;
                    std::process::exit(130);
                }
                KeyCode::Enter => {
                    let Some(idx) = state.selected_item_index() else {
                        continue;
                    };
                    *selected_index = idx;
                    cleanup(&mut out, &state)?;
                    return Ok(());
                }
                KeyCode::Up => {
                    state.move_up();
                }
                KeyCode::Down => {
                    state.move_down();
                }
                KeyCode::Char(c) => {
                    state.query.push(c);
                    state.refilter();
                }
                KeyCode::Backspace => {
                    state.query.pop();
                    state.refilter();
                }
                _ => continue,
            },
            _ => continue,
        }

        render(&mut out, &mut state, header)?;
        after_render(&RenderState { query: &state.query, selected_index: state.selected });
    }
}

/// Clear the widget output and restore cursor.
fn cleanup(stdout: &mut impl Write, state: &State<'_>) -> anyhow::Result<()> {
    if state.rendered_lines > 0 {
        let move_up = u16::try_from(state.rendered_lines)
            .expect("rendered_lines fits in u16: at most header + page_size + footer lines");
        crossterm::execute!(
            stdout,
            cursor::MoveUp(move_up),
            MoveToColumn(0),
            Clear(ClearType::FromCursorDown),
        )?;
    }
    crossterm::execute!(stdout, cursor::Show)?;
    stdout.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_items(items: &[(&str, &str)]) -> Vec<SelectItem> {
        items
            .iter()
            .map(|(label, desc)| SelectItem {
                label: (*label).into(),
                display_name: (*label).into(),
                description: (*desc).into(),
                group: None,
            })
            .collect()
    }

    /// Create items with explicit groups: (label, `display_name`, description, group)
    fn make_grouped_items(items: &[(&str, &str, &str, Option<&str>)]) -> Vec<SelectItem> {
        items
            .iter()
            .map(|(label, display_name, desc, group)| SelectItem {
                label: (*label).into(),
                display_name: (*display_name).into(),
                description: (*desc).into(),
                group: group.map(Str::from),
            })
            .collect()
    }

    /// Strip ANSI escape sequences from output for easier assertions.
    #[expect(clippy::disallowed_types, reason = "test helper building arbitrary output string")]
    fn strip_ansi(s: &str) -> String {
        let mut result = String::new();
        let mut chars = s.chars();
        while let Some(c) = chars.next() {
            if c == '\x1b' {
                // Skip until we hit a letter (end of escape sequence)
                for c in chars.by_ref() {
                    if c.is_ascii_alphabetic() {
                        break;
                    }
                }
            } else {
                result.push(c);
            }
        }
        result
    }

    #[expect(clippy::disallowed_types, reason = "test helper building arbitrary output string")]
    fn render_to_string(items: &[SelectItem], max_line_width: usize) -> String {
        let display_rows = build_display_rows(items, "");
        let len = display_rows.len();
        let mut buf = Vec::new();
        render_items(
            &mut buf,
            &RenderParams {
                items,
                display_rows: &display_rows,
                selected: Some(0),
                visible_row_range: 0..len,
                hidden_count: 0,
                header: None,
                query: None,
                show_group_headers: false,
                line_ending: "\n",
                max_line_width,
            },
        )
        .unwrap();
        strip_ansi(&String::from_utf8(buf).unwrap())
    }

    #[expect(clippy::disallowed_types, reason = "test helper building arbitrary output string")]
    fn render_interactive_to_string(
        items: &[SelectItem],
        query: &str,
        max_line_width: usize,
    ) -> String {
        let display_rows = build_display_rows(items, query);
        let len = display_rows.len();
        let mut buf = Vec::new();
        render_items(
            &mut buf,
            &RenderParams {
                items,
                display_rows: &display_rows,
                selected: Some(0),
                visible_row_range: 0..len,
                hidden_count: 0,
                header: None,
                query: Some(query),
                show_group_headers: true,
                line_ending: "\n",
                max_line_width,
            },
        )
        .unwrap();
        strip_ansi(&String::from_utf8(buf).unwrap())
    }

    #[test]
    fn truncates_long_description() {
        let items = make_items(&[("build", "a really long command that exceeds the width limit")]);
        //                        "  build: a really long..." = 2 + 5 + 2 + desc
        // max_line_width = 30 => max_desc = 30 - 9 = 21 chars
        let output = render_to_string(&items, 30);
        let line = output.lines().next().unwrap();
        // "> " (2) + "build" (5) + ": " (2) + desc (21) = 30
        assert!(
            line.chars().count() <= 30,
            "line should be at most 30 chars, got {}: {line:?}",
            line.chars().count()
        );
        assert!(line.contains('\u{2026}'), "truncated line should contain ellipsis: {line:?}");
    }

    #[test]
    fn does_not_truncate_short_description() {
        let items = make_items(&[("build", "echo ok")]);
        let output = render_to_string(&items, 80);
        let line = output.lines().next().unwrap();
        assert!(!line.contains('\u{2026}'), "short line should not be truncated: {line:?}");
        assert!(line.contains("echo ok"), "full description should appear: {line:?}");
    }

    #[test]
    fn max_line_width_max_disables_truncation() {
        let long_desc = "x".repeat(500);
        let items = make_items(&[("build", &long_desc)]);
        let output = render_to_string(&items, usize::MAX);
        let line = output.lines().next().unwrap();
        assert!(!line.contains('\u{2026}'), "usize::MAX should disable truncation: {line:?}");
        assert!(line.contains(&long_desc), "full 500-char description should appear");
    }

    #[test]
    fn each_line_fits_within_max_width() {
        let items = make_items(&[
            ("build", "tsc -p tsconfig.build.json && echo done"),
            ("lint", "oxlint --fix"),
            ("test", "vitest run --reporter=verbose --coverage"),
        ]);
        let max_width = 40;
        let output = render_to_string(&items, max_width);
        for line in output.lines() {
            assert!(
                line.chars().count() <= max_width,
                "line exceeds max width {max_width}: ({}) {line:?}",
                line.chars().count()
            );
        }
    }

    #[test]
    fn truncation_preserves_label() {
        let items = make_items(&[("my-task", "very long description here")]);
        // "  my-task: very..." => prefix(2) + label(7) + sep(2) + desc
        // max_line_width = 20 => max_desc = 20 - 11 = 9 chars
        let output = render_to_string(&items, 20);
        let line = output.lines().next().unwrap();
        assert!(line.contains("my-task"), "label should always be preserved: {line:?}");
    }

    #[test]
    fn interactive_style_matches_vp_selector_marker_and_indent() {
        let items = make_items(&[("build", "echo build"), ("lint", "echo lint")]);
        let output = render_interactive_to_string(&items, "", 80);
        let mut lines = output.lines();
        let prompt = lines.next().unwrap();
        let spacer = lines.next().unwrap();
        let selected = lines.next().unwrap();
        let unselected = lines.next().unwrap();
        assert_eq!(prompt, "Select a task (\u{2191}/\u{2193}, Enter to run, type to search):");
        assert!(spacer.is_empty());
        assert_eq!(selected, "  \u{203a} build echo build");
        assert_eq!(unselected, "    lint  echo lint");
    }

    #[test]
    fn interactive_commands_are_aligned() {
        let items =
            make_items(&[("build", "echo build"), ("lint", "echo lint"), ("test", "vitest run")]);
        let output = render_interactive_to_string(&items, "", 80);
        let item_lines: Vec<&str> = output.lines().skip(2).collect();
        // max_name_width = 5 ("build")
        // prefix(4) + max_name(5) + padding + " " + desc
        assert_eq!(item_lines[0], "  \u{203a} build echo build");
        assert_eq!(item_lines[1], "    lint  echo lint");
        assert_eq!(item_lines[2], "    test  vitest run");
    }

    #[test]
    fn interactive_truncation_accounts_for_padding() {
        let items = make_items(&[
            ("build", "a really long command that exceeds the width limit"),
            ("lint", "short"),
        ]);
        // max_name_width = 5, prefix(4) + max_name(5) + sep(1) = 10
        // max_line_width = 30 => max_desc = 30 - 11 = 19 chars
        let output = render_interactive_to_string(&items, "", 30);
        for line in output.lines().skip(2) {
            assert!(
                line.chars().count() <= 30,
                "line exceeds 30 chars: ({}) {line:?}",
                line.chars().count()
            );
        }
        let build_line = output.lines().nth(2).unwrap();
        assert!(
            build_line.contains('\u{2026}'),
            "long description should be truncated: {build_line:?}"
        );
    }

    #[test]
    fn interactive_tree_view_with_groups() {
        let items = make_grouped_items(&[
            ("build", "build", "echo build app", None),
            ("lint", "lint", "echo lint app", None),
            ("lib#build", "build", "echo build lib", Some("lib (packages/lib)")),
            ("lib#lint", "lint", "echo lint lib", Some("lib (packages/lib)")),
        ]);
        let output = render_interactive_to_string(&items, "", 80);
        let item_lines: Vec<&str> = output.lines().skip(2).collect();
        // max_name=5, has_groups → max_prefix=6, command_col=12
        // Root items get extra padding to align with grouped items
        assert_eq!(item_lines[0], "  \u{203a} build   echo build app");
        assert_eq!(item_lines[1], "    lint    echo lint app");
        // Group header
        assert_eq!(item_lines[2], "    lib (packages/lib)");
        // Grouped items (indented by 2 more, less padding)
        assert_eq!(item_lines[3], "      build echo build lib");
        assert_eq!(item_lines[4], "      lint  echo lint lib");
    }

    #[test]
    fn interactive_tree_view_alignment_across_groups() {
        let items = make_grouped_items(&[
            ("build", "build", "echo build", None),
            ("typecheck", "typecheck", "echo tc", None),
            ("lib#build", "build", "echo build lib", Some("lib")),
        ]);
        let output = render_interactive_to_string(&items, "", 80);
        let item_lines: Vec<&str> = output.lines().skip(2).collect();
        // max_name=9, has_groups → max_prefix=6, command_col=16
        // All commands start at column 16 regardless of indent level
        assert_eq!(item_lines[0], "  \u{203a} build       echo build");
        assert_eq!(item_lines[1], "    typecheck   echo tc");
        assert_eq!(item_lines[2], "    lib");
        assert_eq!(item_lines[3], "      build     echo build lib");
    }

    #[test]
    fn interactive_tree_view_truncation_with_groups() {
        let items = make_grouped_items(&[
            ("build", "build", "a really long command that exceeds the limit", None),
            (
                "lib#build",
                "build",
                "another really long command that exceeds the limit",
                Some("lib"),
            ),
        ]);
        let output = render_interactive_to_string(&items, "", 30);
        for line in output.lines().skip(2) {
            if !line.is_empty() {
                assert!(
                    line.chars().count() <= 30,
                    "line exceeds 30 chars: ({}) {line:?}",
                    line.chars().count()
                );
            }
        }
    }

    #[test]
    fn display_rows_built_correctly() {
        let items = make_grouped_items(&[
            ("build", "build", "echo build", None),
            ("lib#build", "build", "echo build lib", Some("lib")),
            ("lib#lint", "lint", "echo lint lib", Some("lib")),
            ("app#build", "build", "echo build app", Some("app")),
        ]);
        let rows = build_display_rows(&items, "");
        assert_eq!(rows.len(), 6); // 4 items + 2 headers ("lib", "app")
        assert!(matches!(&rows[0], DisplayRow::Item { item_index: 0 }));
        assert!(matches!(&rows[1], DisplayRow::Header(h) if h.as_str() == "lib"));
        assert!(matches!(&rows[2], DisplayRow::Item { item_index: 1 }));
        assert!(matches!(&rows[3], DisplayRow::Item { item_index: 2 }));
        assert!(matches!(&rows[4], DisplayRow::Header(h) if h.as_str() == "app"));
        assert!(matches!(&rows[5], DisplayRow::Item { item_index: 3 }));
    }

    /// Mirrors the E2E scenario: items sorted alphabetically by package name
    /// (app before lib), with lib being the current package (group: None).
    /// Verifies that None-group items come first despite appearing later in input.
    #[test]
    fn display_rows_none_group_first_when_not_first_in_input() {
        let items = make_grouped_items(&[
            // app items first (alphabetically before lib)
            ("app#build", "app#build", "echo build app", Some("app (packages/app)")),
            ("app#lint", "app#lint", "echo lint app", Some("app (packages/app)")),
            // lib items (current package, group: None)
            ("build", "build", "echo build lib", None),
            ("lint", "lint", "echo lint lib", None),
            // root items
            ("root#check", "root#check", "echo check", Some("root (workspace root)")),
        ]);
        let rows = build_display_rows(&items, "");
        // None-group (lib) should come first, then app, then root
        assert!(
            matches!(&rows[0], DisplayRow::Item { item_index: 2 }),
            "first item should be lib build (idx 2)"
        );
        assert!(
            matches!(&rows[1], DisplayRow::Item { item_index: 3 }),
            "second item should be lib lint (idx 3)"
        );
        assert!(matches!(&rows[2], DisplayRow::Header(h) if h.as_str() == "app (packages/app)"));
        assert!(matches!(&rows[3], DisplayRow::Item { item_index: 0 }));
        assert!(matches!(&rows[4], DisplayRow::Item { item_index: 1 }));
        assert!(matches!(&rows[5], DisplayRow::Header(h) if h.as_str() == "root (workspace root)"));
        assert!(matches!(&rows[6], DisplayRow::Item { item_index: 4 }));
    }
}
