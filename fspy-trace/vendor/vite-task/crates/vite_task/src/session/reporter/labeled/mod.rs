//! Labeled reporter — prefixes each output line with `[pkg#task]`.

use std::{cell::RefCell, io::Write, process::ExitStatus as StdExitStatus, rc::Rc, sync::Arc};

use vite_path::AbsolutePath;
use vite_task_plan::{ExecutionItemDisplay, LeafExecutionKind};

use super::{
    ExitStatus, GraphExecutionReporter, GraphExecutionReporterBuilder, LeafExecutionReporter,
    StdioConfig, StdioSuggestion, format_command_with_cache_status, format_task_label,
    write_leaf_trailing_output,
};
use crate::session::event::{CacheStatus, CacheUpdateStatus, ExecutionError};

mod writer;

use writer::LabeledWriter;

pub struct LabeledReporterBuilder {
    workspace_path: Arc<AbsolutePath>,
    writer: Box<dyn Write>,
}

impl LabeledReporterBuilder {
    pub fn new(workspace_path: Arc<AbsolutePath>, writer: Box<dyn Write>) -> Self {
        Self { workspace_path, writer }
    }
}

impl GraphExecutionReporterBuilder for LabeledReporterBuilder {
    fn build(self: Box<Self>) -> Box<dyn GraphExecutionReporter> {
        Box::new(LabeledGraphReporter {
            writer: Rc::new(RefCell::new(self.writer)),
            workspace_path: self.workspace_path,
        })
    }
}

struct LabeledGraphReporter {
    writer: Rc<RefCell<Box<dyn Write>>>,
    workspace_path: Arc<AbsolutePath>,
}

impl GraphExecutionReporter for LabeledGraphReporter {
    fn new_leaf_execution(
        &mut self,
        display: &ExecutionItemDisplay,
        _leaf_kind: &LeafExecutionKind,
    ) -> Box<dyn LeafExecutionReporter> {
        Box::new(LabeledLeafReporter {
            writer: Rc::clone(&self.writer),
            display: display.clone(),
            workspace_path: Arc::clone(&self.workspace_path),
            started: false,
        })
    }

    fn finish(self: Box<Self>) -> Result<(), ExitStatus> {
        let mut writer = self.writer.borrow_mut();
        let _ = writer.flush();
        Ok(())
    }
}

struct LabeledLeafReporter {
    writer: Rc<RefCell<Box<dyn Write>>>,
    display: ExecutionItemDisplay,
    workspace_path: Arc<AbsolutePath>,
    started: bool,
}

impl LeafExecutionReporter for LabeledLeafReporter {
    fn start(&mut self, cache_status: CacheStatus) -> StdioConfig {
        let label = format_task_label(&self.display);
        let line =
            format_command_with_cache_status(&self.display, &self.workspace_path, &cache_status);

        self.started = true;

        let labeled_line = vite_str::format!("{label} {line}");
        let mut writer = self.writer.borrow_mut();
        let _ = writer.write_all(labeled_line.as_bytes());
        let _ = writer.flush();

        let prefix = vite_str::format!("{label} ");

        StdioConfig {
            suggestion: StdioSuggestion::Piped,
            stdout_writer: Box::new(LabeledWriter::new(
                Box::new(std::io::stdout()),
                prefix.as_bytes().to_vec(),
            )),
            stderr_writer: Box::new(LabeledWriter::new(
                Box::new(std::io::stderr()),
                prefix.as_bytes().to_vec(),
            )),
        }
    }

    fn finish(
        self: Box<Self>,
        _status: Option<StdExitStatus>,
        _cache_update_status: CacheUpdateStatus,
        error: Option<ExecutionError>,
    ) {
        write_leaf_trailing_output(&self.writer, error, self.started, &[]);
    }
}

#[cfg(test)]
mod tests {
    use vite_task_plan::ExecutionItemKind;

    use super::*;
    use crate::session::{
        event::CacheDisabledReason,
        reporter::{
            StdioSuggestion,
            test_fixtures::{spawn_task, test_path},
        },
    };

    fn leaf_kind(item: &vite_task_plan::ExecutionItem) -> &LeafExecutionKind {
        match &item.kind {
            ExecutionItemKind::Leaf(kind) => kind,
            ExecutionItemKind::Expanded(_) => panic!("test fixture item must be a Leaf"),
        }
    }

    #[test]
    fn always_suggests_piped() {
        let task = spawn_task("build");
        let item = &task.items[0];

        let builder = Box::new(LabeledReporterBuilder::new(test_path(), Box::new(std::io::sink())));
        let mut reporter = builder.build();
        let mut leaf = reporter.new_leaf_execution(&item.execution_item_display, leaf_kind(item));
        let stdio_config = leaf.start(CacheStatus::Disabled(CacheDisabledReason::NoCacheMetadata));
        assert_eq!(stdio_config.suggestion, StdioSuggestion::Piped);
    }
}
