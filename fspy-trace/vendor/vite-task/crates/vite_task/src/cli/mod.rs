use std::sync::Arc;

use clap::Parser;
use vite_path::AbsolutePath;
use vite_str::Str;
use vite_task_graph::{TaskSpecifier, query::TaskQuery};
use vite_task_plan::plan_request::{CacheOverride, PlanOptions, QueryPlanRequest};
use vite_workspace::package_filter::{PackageQueryArgs, PackageQueryError};

/// Controls how task output is displayed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, clap::ValueEnum)]
pub enum LogMode {
    /// Output streams directly to the terminal as tasks produce it.
    #[default]
    Interleaved,
    /// Each line is prefixed with `[packageName#taskName]`.
    Labeled,
    /// Output is buffered per task and printed as a block after each task completes.
    Grouped,
}

#[derive(Debug, Clone, clap::Subcommand)]
pub enum CacheSubcommand {
    /// Clean up all the cache
    Clean,
}

/// Flags that control how a `run` command selects tasks.
#[derive(Debug, Clone, PartialEq, Eq, clap::Args)]
#[expect(clippy::struct_excessive_bools, reason = "CLI flags are naturally boolean")]
pub struct RunFlags {
    #[clap(flatten)]
    pub package_query: PackageQueryArgs,

    /// Do not run dependencies specified in `dependsOn` fields.
    #[clap(default_value = "false", long)]
    pub ignore_depends_on: bool,

    /// Show full detailed summary after execution.
    #[clap(default_value = "false", short = 'v', long)]
    pub verbose: bool,

    /// Force caching on for all tasks and scripts.
    #[clap(long, conflicts_with = "no_cache")]
    pub cache: bool,

    /// Force caching off for all tasks and scripts.
    #[clap(long, conflicts_with = "cache")]
    pub no_cache: bool,

    /// How task output is displayed.
    #[clap(long, default_value = "interleaved")]
    pub log: LogMode,
}

impl RunFlags {
    #[must_use]
    pub const fn cache_override(&self) -> CacheOverride {
        if self.cache {
            CacheOverride::ForceEnabled
        } else if self.no_cache {
            CacheOverride::ForceDisabled
        } else {
            CacheOverride::None
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Public CLI types (clap-parsed)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Arguments for the `run` subcommand as parsed by clap.
///
/// Contains the `--last-details` flag which is resolved into a separate
/// `ResolvedCommand::RunLastDetails` variant internally.
#[derive(Debug, clap::Parser)]
pub struct RunCommand {
    /// `packageName#taskName` or `taskName`. If omitted, lists all available tasks.
    pub(crate) task_specifier: Option<Str>,

    #[clap(flatten)]
    pub(crate) flags: RunFlags,

    /// Additional arguments to pass to the tasks
    #[clap(trailing_var_arg = true, allow_hyphen_values = true)]
    pub(crate) additional_args: Vec<Str>,

    /// Display the detailed summary of the last run.
    #[clap(long, exclusive = true)]
    pub(crate) last_details: bool,
}

/// vite task CLI subcommands as parsed by clap.
///
/// vite task CLI subcommands as parsed by clap.
///
/// Pass directly to `Session::main` or `HandledCommand::ViteTaskCommand`.
/// The `--last-details` flag on the `run` subcommand is resolved internally.
#[derive(Debug, Parser)]
pub enum Command {
    /// Run tasks
    Run(RunCommand),
    /// Manage the task cache
    Cache {
        #[clap(subcommand)]
        subcmd: CacheSubcommand,
    },
}

impl Command {
    /// Resolve the clap-parsed command into the dispatched [`ResolvedCommand`] enum.
    ///
    /// When `--last-details` is set on the `run` subcommand, this produces
    /// [`ResolvedCommand::RunLastDetails`] instead of [`ResolvedCommand::Run`],
    /// making the exclusivity enforced at the type level.
    #[must_use]
    pub(crate) fn into_resolved(self) -> ResolvedCommand {
        match self {
            Self::Run(run) if run.last_details => ResolvedCommand::RunLastDetails,
            Self::Run(run) => ResolvedCommand::Run(run.into_resolved()),
            Self::Cache { subcmd } => ResolvedCommand::Cache { subcmd },
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Internal resolved types (used for dispatch — `--last-details` is a separate variant)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Resolved CLI command for internal dispatch.
///
/// Unlike [`Command`], this enum makes `--last-details` a separate variant
/// ([`ResolvedCommand::RunLastDetails`]) so that it is exclusive at the type level —
/// there is no way to combine it with task execution fields.
#[derive(Debug)]
pub enum ResolvedCommand {
    /// Run tasks with the given parameters.
    Run(ResolvedRunCommand),
    /// Display the saved detailed summary of the last run (`--last-details`).
    RunLastDetails,
    /// Manage the task cache.
    Cache { subcmd: CacheSubcommand },
}

/// Resolved arguments for executing tasks.
///
/// Does not contain `last_details` — that case is represented by
/// [`ResolvedCommand::RunLastDetails`] instead.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedRunCommand {
    /// `packageName#taskName` or `taskName`. If omitted, lists all available tasks.
    pub task_specifier: Option<Str>,

    pub flags: RunFlags,

    /// Additional arguments to pass to the tasks.
    pub additional_args: Vec<Str>,
}

impl RunCommand {
    /// Convert to the resolved run command, stripping the `last_details` flag.
    #[must_use]
    pub(crate) fn into_resolved(self) -> ResolvedRunCommand {
        ResolvedRunCommand {
            task_specifier: self.task_specifier,
            flags: self.flags,
            additional_args: self.additional_args,
        }
    }
}

#[derive(thiserror::Error, Debug)]
pub enum CLITaskQueryError {
    #[error("no task specifier provided")]
    MissingTaskSpecifier,

    #[error(transparent)]
    PackageQuery(#[from] PackageQueryError),
}

impl ResolvedRunCommand {
    /// Convert to `QueryPlanRequest`, or return an error if invalid.
    ///
    /// # Errors
    ///
    /// Returns an error if conflicting flags are set or if a `--filter` expression
    /// cannot be parsed.
    pub fn into_query_plan_request(
        self,
        cwd: &Arc<AbsolutePath>,
    ) -> Result<(QueryPlanRequest, bool), CLITaskQueryError> {
        let raw_specifier = self.task_specifier.ok_or(CLITaskQueryError::MissingTaskSpecifier)?;
        let task_specifier = TaskSpecifier::parse_raw(&raw_specifier);

        let cache_override = self.flags.cache_override();
        let include_explicit_deps = !self.flags.ignore_depends_on;

        let (package_query, is_cwd_only) =
            self.flags.package_query.into_package_query(task_specifier.package_name, cwd)?;

        Ok((
            QueryPlanRequest {
                query: TaskQuery {
                    package_query,
                    task_name: task_specifier.task_name,
                    include_explicit_deps,
                },
                plan_options: PlanOptions {
                    extra_args: self.additional_args.into(),
                    cache_override,
                },
            },
            is_cwd_only,
        ))
    }
}
