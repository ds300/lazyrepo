//! Summary reporter — wraps an inner reporter and adds summary tracking.
//!
//! This is a decorator that intercepts leaf `start()`/`finish()` to track task
//! results, then renders a summary when the graph execution completes. The inner
//! reporter handles all output formatting (interleaved, labeled, grouped).

use std::{cell::RefCell, io::Write, process::ExitStatus as StdExitStatus, rc::Rc, sync::Arc};

use vite_path::AbsolutePath;
use vite_str::Str;
use vite_task_plan::{ExecutionItemDisplay, LeafExecutionKind};

use super::{
    ExitStatus, GraphExecutionReporter, GraphExecutionReporterBuilder, LeafExecutionReporter,
    StdioConfig,
};
use crate::session::{
    event::{CacheStatus, CacheUpdateStatus, ExecutionError},
    reporter::summary::{
        LastRunSummary, SavedExecutionError, SpawnOutcome, TaskResult, TaskSummary,
        format_compact_summary, format_full_summary,
    },
};

/// Callback type for persisting the summary (e.g., writing `last-summary.json`).
pub type WriteSummaryFn = Box<dyn FnOnce(&LastRunSummary)>;

/// Builder that wraps an inner builder and adds summary tracking.
pub struct SummaryReporterBuilder {
    inner: Box<dyn GraphExecutionReporterBuilder>,
    workspace_path: Arc<AbsolutePath>,
    writer: Box<dyn Write>,
    show_details: bool,
    write_summary: Option<WriteSummaryFn>,
    program_name: Str,
}

impl SummaryReporterBuilder {
    pub fn new(
        inner: Box<dyn GraphExecutionReporterBuilder>,
        workspace_path: Arc<AbsolutePath>,
        writer: Box<dyn Write>,
        show_details: bool,
        write_summary: Option<WriteSummaryFn>,
        program_name: Str,
    ) -> Self {
        Self { inner, workspace_path, writer, show_details, write_summary, program_name }
    }
}

impl GraphExecutionReporterBuilder for SummaryReporterBuilder {
    fn build(self: Box<Self>) -> Box<dyn GraphExecutionReporter> {
        Box::new(SummaryGraphReporter {
            inner: self.inner.build(),
            tasks: Rc::new(RefCell::new(Vec::new())),
            workspace_path: self.workspace_path,
            writer: self.writer,
            show_details: self.show_details,
            write_summary: self.write_summary,
            program_name: self.program_name,
        })
    }
}

struct SummaryGraphReporter {
    inner: Box<dyn GraphExecutionReporter>,
    tasks: Rc<RefCell<Vec<TaskSummary>>>,
    workspace_path: Arc<AbsolutePath>,
    writer: Box<dyn Write>,
    show_details: bool,
    write_summary: Option<WriteSummaryFn>,
    program_name: Str,
}

impl GraphExecutionReporter for SummaryGraphReporter {
    fn new_leaf_execution(
        &mut self,
        display: &ExecutionItemDisplay,
        leaf_kind: &LeafExecutionKind,
    ) -> Box<dyn LeafExecutionReporter> {
        let inner = self.inner.new_leaf_execution(display, leaf_kind);
        Box::new(SummaryLeafReporter {
            inner,
            tasks: Rc::clone(&self.tasks),
            display: display.clone(),
            workspace_path: Arc::clone(&self.workspace_path),
            cache_status: None,
        })
    }

    fn finish(self: Box<Self>) -> Result<(), ExitStatus> {
        // Let inner reporter finish first (flushes any pending output).
        let inner_result = self.inner.finish();

        let tasks = self.tasks.take();

        let has_infra_errors = tasks.iter().any(|t| t.result.error().is_some());

        let failed_exit_codes: Vec<i32> = tasks
            .iter()
            .filter_map(|t| match &t.result {
                TaskResult::Spawned { outcome: SpawnOutcome::Failed { exit_code }, .. } => {
                    Some(exit_code.get())
                }
                _ => None,
            })
            .collect();

        let result = match (has_infra_errors, failed_exit_codes.as_slice()) {
            (false, []) => Ok(()),
            (false, [code]) =>
            {
                #[expect(
                    clippy::cast_sign_loss,
                    reason = "value is clamped to 1..=255, always positive"
                )]
                Err(ExitStatus((*code).clamp(1, 255) as u8))
            }
            _ => Err(ExitStatus::FAILURE),
        };

        let exit_code = match &result {
            Ok(()) => 0u8,
            Err(status) => status.0,
        };

        let summary = LastRunSummary { tasks, exit_code };

        let summary_buf = if self.show_details {
            format_full_summary(&summary)
        } else {
            format_compact_summary(&summary, &self.program_name)
        };

        if let Some(write_summary) = self.write_summary {
            write_summary(&summary);
        }

        // Always flush — even when summary is empty, a preceding spawned process
        // may have written to the same fd via Stdio::inherit().
        {
            let mut writer = self.writer;
            if !summary_buf.is_empty() {
                let _ = writer.write_all(&summary_buf);
            }
            let _ = writer.flush();
        }

        // Use inner result if it failed, otherwise use our computed result.
        inner_result.and(result)
    }
}

/// Leaf reporter wrapper that records task results for the summary.
struct SummaryLeafReporter {
    inner: Box<dyn LeafExecutionReporter>,
    tasks: Rc<RefCell<Vec<TaskSummary>>>,
    display: ExecutionItemDisplay,
    workspace_path: Arc<AbsolutePath>,
    cache_status: Option<CacheStatus>,
}

impl LeafExecutionReporter for SummaryLeafReporter {
    fn start(&mut self, cache_status: CacheStatus) -> StdioConfig {
        self.cache_status = Some(cache_status.clone());
        self.inner.start(cache_status)
    }

    fn finish(
        self: Box<Self>,
        status: Option<StdExitStatus>,
        cache_update_status: CacheUpdateStatus,
        error: Option<ExecutionError>,
    ) {
        // Record task summary before forwarding to inner.
        let saved_error = error.as_ref().map(SavedExecutionError::from_execution_error);

        if let Some(ref cache_status) = self.cache_status {
            let cwd_relative =
                if let Ok(Some(rel)) = self.display.cwd.strip_prefix(&self.workspace_path) {
                    Str::from(rel.as_str())
                } else {
                    Str::default()
                };

            let task_summary = TaskSummary {
                package_name: self.display.task_display.package_name.clone(),
                task_name: self.display.task_display.task_name.clone(),
                command: self.display.command.clone(),
                cwd: cwd_relative,
                result: TaskResult::from_execution(
                    cache_status,
                    status,
                    saved_error.as_ref(),
                    &cache_update_status,
                ),
            };

            self.tasks.borrow_mut().push(task_summary);
        }

        self.inner.finish(status, cache_update_status, error);
    }
}
