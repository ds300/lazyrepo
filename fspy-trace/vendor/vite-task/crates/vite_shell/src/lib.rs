use std::{collections::BTreeMap, fmt::Display, ops::Range};

use bincode::{Decode, Encode};
use brush_parser::{
    Parser, ParserOptions,
    ast::{
        AndOr, Assignment, AssignmentName, AssignmentValue, Command, CommandPrefix,
        CommandPrefixOrSuffixItem, CommandSuffix, CompoundListItem, Pipeline, Program,
        SeparatorOperator, SimpleCommand, SourceLocation, Word,
    },
    word::{WordPiece, WordPieceWithSource},
};
use diff::Diff;
use serde::{Deserialize, Serialize};
use vite_str::Str;

/// "FOO=BAR program arg1 arg2"
#[derive(Encode, Decode, Serialize, Deserialize, Debug, PartialEq, Eq, Diff, Clone)]
#[diff(attr(#[derive(Debug)]))]
pub struct TaskParsedCommand {
    pub envs: BTreeMap<Str, Str>,
    pub program: Str,
    pub args: Vec<Str>,
}

impl Display for TaskParsedCommand {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // BTreeMap ensures stable iteration order
        for (name, value) in &self.envs {
            Display::fmt(
                &format_args!("{}={} ", name, shell_escape::escape(value.as_str().into())),
                f,
            )?;
        }
        Display::fmt(&shell_escape::escape(self.program.as_str().into()), f)?;
        for arg in &self.args {
            Display::fmt(" ", f)?;
            Display::fmt(&shell_escape::escape(arg.as_str().into()), f)?;
        }

        Ok(())
    }
}

/// Parser options matching those used in [`try_parse_as_and_list`].
const PARSER_OPTIONS: ParserOptions = ParserOptions {
    enable_extended_globbing: false,
    posix_mode: true,
    sh_mode: true,
    tilde_expansion: false,
};

/// Remove shell quoting from a word value, respecting quoting context.
///
/// Uses `brush_parser::word::parse` to properly handle nested quoting
/// (e.g. single quotes inside double quotes are preserved as literal characters).
/// Returns `None` if the word contains expansions that cannot be statically resolved
/// (parameter expansion, command substitution, arithmetic).
fn unquote(word: &Word) -> Option<Str> {
    let Word { value, loc: _ } = word;
    let pieces = brush_parser::word::parse(value.as_str(), &PARSER_OPTIONS).ok()?;
    let mut result = Str::with_capacity(value.len());
    flatten_pieces(&pieces, &mut result)?;
    Some(result)
}

/// Recursively extract literal text from parsed word pieces.
///
/// Returns `None` if any piece requires runtime expansion.
fn flatten_pieces(pieces: &[WordPieceWithSource], result: &mut Str) -> Option<()> {
    for piece in pieces {
        match &piece.piece {
            WordPiece::Text(s) | WordPiece::SingleQuotedText(s) | WordPiece::AnsiCQuotedText(s) => {
                result.push_str(s);
            }
            // EscapeSequence contains the raw sequence (e.g. `\"` as two chars);
            // the escaped character is everything after the leading backslash.
            WordPiece::EscapeSequence(s) => {
                result.push_str(s.strip_prefix('\\').unwrap_or(s));
            }
            WordPiece::DoubleQuotedSequence(inner)
            | WordPiece::GettextDoubleQuotedSequence(inner) => {
                flatten_pieces(inner, result)?;
            }
            // Tilde prefix, parameter expansion, command substitution, arithmetic
            // cannot be statically resolved — bail out.
            _ => return None,
        }
    }
    Some(())
}

fn pipeline_to_command(pipeline: &Pipeline) -> Option<(TaskParsedCommand, Range<usize>)> {
    let location = pipeline.location()?;
    let range = location.start.index..location.end.index;

    let Pipeline { timed: None, bang: false, seq } = pipeline else {
        return None;
    };
    let [Command::Simple(simple_command)] = seq.as_slice() else {
        return None;
    };
    let SimpleCommand { prefix, word_or_name: Some(program), suffix } = simple_command else {
        return None;
    };
    let mut envs = BTreeMap::<Str, Str>::new();
    if let Some(prefix) = prefix {
        let CommandPrefix(items) = prefix;
        for item in items {
            let CommandPrefixOrSuffixItem::AssignmentWord(
                Assignment { name, value, append: false, loc: _ },
                _,
            ) = item
            else {
                return None;
            };
            let AssignmentName::VariableName(name) = name else {
                return None;
            };
            let AssignmentValue::Scalar(value) = value else {
                return None;
            };
            envs.insert(name.as_str().into(), unquote(value)?);
        }
    }
    let mut args = Vec::<Str>::new();
    if let Some(CommandSuffix(suffix_items)) = suffix {
        for suffix_item in suffix_items {
            let CommandPrefixOrSuffixItem::Word(word) = suffix_item else {
                return None;
            };
            args.push(unquote(word)?);
        }
    }
    Some((TaskParsedCommand { envs, program: unquote(program)?, args }, range))
}

#[must_use]
pub fn try_parse_as_and_list(cmd: &str) -> Option<Vec<(TaskParsedCommand, Range<usize>)>> {
    let mut parser = Parser::new(cmd.as_bytes(), &PARSER_OPTIONS);
    let Program { complete_commands } = parser.parse_program().ok()?;
    let [compound_list] = complete_commands.as_slice() else {
        return None;
    };
    let [CompoundListItem(and_or_list, SeparatorOperator::Sequence)] = compound_list.0.as_slice()
    else {
        return None;
    };

    let mut commands = Vec::<(TaskParsedCommand, Range<usize>)>::new();
    commands.push(pipeline_to_command(&and_or_list.first)?);
    for and_or in &and_or_list.additional {
        let AndOr::And(pipeline) = and_or else {
            return None;
        };
        commands.push(pipeline_to_command(pipeline)?);
    }
    Some(commands)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_single_command() {
        let source = r"A=B hello world";
        let list = try_parse_as_and_list(source).unwrap();
        assert_eq!(list.len(), 1);
        let (cmd, range) = &list[0];
        assert_eq!(&source[range.clone()], source);
        assert_eq!(
            cmd,
            &TaskParsedCommand {
                envs: [("A".into(), "B".into())].into(),
                program: "hello".into(),
                args: vec!["world".into()],
            }
        );
    }

    #[test]
    fn test_parse_command() {
        let source = r#"A=B hello world && FOO="BE\"R" program "arg1" "arg\"2" && zzz"#;
        let list = try_parse_as_and_list(source).unwrap();

        let commands = list.iter().map(|(cmd, _)| cmd).collect::<Vec<_>>();
        assert_eq!(
            commands,
            vec![
                &TaskParsedCommand {
                    envs: [("A".into(), "B".into())].into(),
                    program: "hello".into(),
                    args: vec!["world".into()],
                },
                &TaskParsedCommand {
                    envs: [("FOO".into(), "BE\"R".into())].into(),
                    program: "program".into(),
                    args: vec!["arg1".into(), "arg\"2".into()],
                },
                &TaskParsedCommand { envs: [].into(), program: "zzz".into(), args: vec![] }
            ]
        );

        let substrs = list.iter().map(|(_, range)| &source[range.clone()]).collect::<Vec<_>>();

        assert_eq!(
            substrs,
            vec!["A=B hello world", r#"FOO="BE\"R" program "arg1" "arg\"2""#, "zzz"]
        );
    }

    #[test]
    fn test_task_parsed_command_stable_env_ordering() {
        // Test that environment variables maintain stable ordering
        let cmd = TaskParsedCommand {
            envs: [
                ("ZEBRA".into(), "last".into()),
                ("ALPHA".into(), "first".into()),
                ("MIDDLE".into(), "middle".into()),
            ]
            .into(),
            program: "test".into(),
            args: vec![],
        };

        // Convert to string multiple times and verify it's always the same
        let str1 = cmd.to_string();
        let str2 = cmd.to_string();
        let str3 = cmd.to_string();

        assert_eq!(str1, str2);
        assert_eq!(str2, str3);

        // Verify the order is alphabetical (BTreeMap sorts by key)
        assert!(str1.starts_with("ALPHA=first MIDDLE=middle ZEBRA=last"));
    }

    #[test]
    fn test_unquote_preserves_nested_quotes() {
        // Single quotes inside double quotes are preserved
        let cmd = r#"echo "hello 'world'""#;
        let list = try_parse_as_and_list(cmd).unwrap();
        assert_eq!(list[0].0.args[0].as_str(), "hello 'world'");

        // Double quotes inside single quotes are preserved
        let cmd = r#"echo 'hello "world"'"#;
        let list = try_parse_as_and_list(cmd).unwrap();
        assert_eq!(list[0].0.args[0].as_str(), "hello \"world\"");

        // Backslash escaping in double quotes
        let cmd = r#"echo "hello\"world""#;
        let list = try_parse_as_and_list(cmd).unwrap();
        assert_eq!(list[0].0.args[0].as_str(), "hello\"world");

        // Backslash escaping outside quotes
        let cmd = r"echo hello\ world";
        let list = try_parse_as_and_list(cmd).unwrap();
        assert_eq!(list[0].0.args[0].as_str(), "hello world");
    }

    #[test]
    fn test_flatten_pieces_recursion() {
        fn parse_and_flatten(input: &str) -> Option<Str> {
            let pieces = brush_parser::word::parse(input, &PARSER_OPTIONS).ok()?;
            let mut result = Str::default();
            flatten_pieces(&pieces, &mut result)?;
            Some(result)
        }

        // DoubleQuotedSequence containing Text + EscapeSequence + Text
        assert_eq!(parse_and_flatten(r#""hello\"world""#).unwrap(), "hello\"world");

        // DoubleQuotedSequence with single quotes preserved as literal text
        assert_eq!(parse_and_flatten(r#""it's a 'test'""#).unwrap(), "it's a 'test'");

        // Nested escape sequences inside double quotes
        assert_eq!(parse_and_flatten(r#""a\\b""#).unwrap(), "a\\b");

        // DoubleQuotedSequence bails on parameter expansion inside
        assert!(parse_and_flatten(r#""hello $VAR""#).is_none());

        // DoubleQuotedSequence bails on command substitution inside
        assert!(parse_and_flatten(r#""hello $(cmd)""#).is_none());
    }

    #[test]
    fn test_parse_urllib_prepare() {
        let cmd = r#"node -e "const v = parseInt(process.versions.node, 10); if (v >= 20) require('child_process').execSync('vp config', {stdio: 'inherit'});""#;
        let result = try_parse_as_and_list(cmd);
        let (parsed, _) = &result.as_ref().unwrap()[0];
        // Single quotes inside double quotes must be preserved as literal characters
        assert_eq!(
            parsed.args[1].as_str(),
            "const v = parseInt(process.versions.node, 10); if (v >= 20) require('child_process').execSync('vp config', {stdio: 'inherit'});"
        );
    }

    #[test]
    fn test_task_parsed_command_serialization_stability() {
        use bincode::{decode_from_slice, encode_to_vec};

        // Create a command with multiple environment variables
        let cmd = TaskParsedCommand {
            envs: [
                ("VAR_C".into(), "value_c".into()),
                ("VAR_A".into(), "value_a".into()),
                ("VAR_B".into(), "value_b".into()),
            ]
            .into(),
            program: "program".into(),
            args: vec!["arg1".into(), "arg2".into()],
        };

        // Serialize multiple times
        let config = bincode::config::standard();
        let bytes1 = encode_to_vec(&cmd, config).unwrap();
        let bytes2 = encode_to_vec(&cmd, config).unwrap();

        // Verify serialization is stable
        assert_eq!(bytes1, bytes2);

        // Verify deserialization works and maintains order
        let (decoded, _): (TaskParsedCommand, _) = decode_from_slice(&bytes1, config).unwrap();
        assert_eq!(decoded, cmd);

        // Verify the decoded command still has stable string representation
        assert_eq!(decoded.to_string(), cmd.to_string());
    }
}
