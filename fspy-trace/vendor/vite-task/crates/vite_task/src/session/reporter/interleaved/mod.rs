//! Interleaved reporter — streams output directly as tasks produce it.

use std::{cell::RefCell, io::Write, process::ExitStatus as StdExitStatus, rc::Rc, sync::Arc};

use vite_path::AbsolutePath;
use vite_task_plan::{ExecutionItemDisplay, LeafExecutionKind};

use super::{
    ExitStatus, GraphExecutionReporter, GraphExecutionReporterBuilder, LeafExecutionReporter,
    StdioConfig, StdioSuggestion, format_command_with_cache_status, write_leaf_trailing_output,
};
use crate::session::event::{CacheStatus, CacheUpdateStatus, ExecutionError};

pub struct InterleavedReporterBuilder {
    workspace_path: Arc<AbsolutePath>,
    writer: Box<dyn Write>,
}

impl InterleavedReporterBuilder {
    pub fn new(workspace_path: Arc<AbsolutePath>, writer: Box<dyn Write>) -> Self {
        Self { workspace_path, writer }
    }
}

impl GraphExecutionReporterBuilder for InterleavedReporterBuilder {
    fn build(self: Box<Self>) -> Box<dyn GraphExecutionReporter> {
        Box::new(InterleavedGraphReporter {
            writer: Rc::new(RefCell::new(self.writer)),
            workspace_path: self.workspace_path,
        })
    }
}

struct InterleavedGraphReporter {
    writer: Rc<RefCell<Box<dyn Write>>>,
    workspace_path: Arc<AbsolutePath>,
}

impl GraphExecutionReporter for InterleavedGraphReporter {
    fn new_leaf_execution(
        &mut self,
        display: &ExecutionItemDisplay,
        leaf_kind: &LeafExecutionKind,
    ) -> Box<dyn LeafExecutionReporter> {
        let stdio_suggestion = match leaf_kind {
            LeafExecutionKind::Spawn(_) => StdioSuggestion::Inherited,
            LeafExecutionKind::InProcess(_) => StdioSuggestion::Piped,
        };

        Box::new(InterleavedLeafReporter {
            writer: Rc::clone(&self.writer),
            display: display.clone(),
            workspace_path: Arc::clone(&self.workspace_path),
            stdio_suggestion,
            started: false,
        })
    }

    fn finish(self: Box<Self>) -> Result<(), ExitStatus> {
        let mut writer = self.writer.borrow_mut();
        let _ = writer.flush();
        Ok(())
    }
}

struct InterleavedLeafReporter {
    writer: Rc<RefCell<Box<dyn Write>>>,
    display: ExecutionItemDisplay,
    workspace_path: Arc<AbsolutePath>,
    stdio_suggestion: StdioSuggestion,
    started: bool,
}

impl LeafExecutionReporter for InterleavedLeafReporter {
    fn start(&mut self, cache_status: CacheStatus) -> StdioConfig {
        let line =
            format_command_with_cache_status(&self.display, &self.workspace_path, &cache_status);

        self.started = true;

        let mut writer = self.writer.borrow_mut();
        let _ = writer.write_all(line.as_bytes());
        let _ = writer.flush();

        StdioConfig {
            suggestion: self.stdio_suggestion,
            stdout_writer: Box::new(std::io::stdout()),
            stderr_writer: Box::new(std::io::stderr()),
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
            test_fixtures::{in_process_task, spawn_task, test_path},
        },
    };

    fn leaf_kind(item: &vite_task_plan::ExecutionItem) -> &LeafExecutionKind {
        match &item.kind {
            ExecutionItemKind::Leaf(kind) => kind,
            ExecutionItemKind::Expanded(_) => panic!("test fixture item must be a Leaf"),
        }
    }

    fn suggestion_for(
        display: &ExecutionItemDisplay,
        leaf_kind: &LeafExecutionKind,
    ) -> StdioSuggestion {
        let builder =
            Box::new(InterleavedReporterBuilder::new(test_path(), Box::new(std::io::sink())));
        let mut reporter = builder.build();
        let mut leaf = reporter.new_leaf_execution(display, leaf_kind);
        leaf.start(CacheStatus::Disabled(CacheDisabledReason::NoCacheMetadata)).suggestion
    }

    #[test]
    fn spawn_suggests_inherited() {
        let task = spawn_task("build");
        let item = &task.items[0];
        assert_eq!(
            suggestion_for(&item.execution_item_display, leaf_kind(item)),
            StdioSuggestion::Inherited
        );
    }

    #[test]
    fn in_process_leaf_suggests_piped() {
        let task = in_process_task("echo");
        let item = &task.items[0];
        assert_eq!(
            suggestion_for(&item.execution_item_display, leaf_kind(item)),
            StdioSuggestion::Piped
        );
    }
}
