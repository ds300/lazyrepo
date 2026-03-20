use nucleo_matcher::{
    Matcher,
    pattern::{AtomKind, CaseMatching, Normalization, Pattern},
};

/// Fuzzy-match `query` against a list of strings.
///
/// Returns original indices sorted by score descending (best match first).
/// When `query` is empty, returns all indices in their original order.
#[must_use]
pub fn fuzzy_match(query: &str, items: &[&str]) -> Vec<usize> {
    if query.is_empty() {
        return (0..items.len()).collect();
    }

    let pattern = Pattern::new(query, CaseMatching::Ignore, Normalization::Smart, AtomKind::Fuzzy);
    let mut matcher = Matcher::new(nucleo_matcher::Config::DEFAULT);

    let mut scored: Vec<(usize, u32)> = items
        .iter()
        .enumerate()
        .filter_map(|(idx, item)| {
            pattern
                .score(nucleo_matcher::Utf32Str::Ascii(item.as_bytes()), &mut matcher)
                .map(|score| (idx, score))
        })
        .collect();

    scored.sort_by_key(|b| std::cmp::Reverse(b.1));
    scored.into_iter().map(|(idx, _)| idx).collect()
}

#[cfg(test)]
mod tests {
    use assert2::{assert, check};

    use super::*;

    const TASK_NAMES: &[&str] =
        &["build", "lint", "test", "app#build", "app#lint", "app#test", "lib#build"];

    #[test]
    fn exact_match_scores_highest() {
        let results = fuzzy_match("build", TASK_NAMES);
        assert!(!results.is_empty());
        // "build" should be the highest-scoring match
        check!(TASK_NAMES[results[0]] == "build");
    }

    #[test]
    fn typo_matches_similar() {
        let results = fuzzy_match("buid", TASK_NAMES);
        assert!(!results.is_empty());
        // Should match "build" and "app#build" and "lib#build" but not "lint" or "test"
        let matched_names: Vec<&str> = results.iter().map(|&i| TASK_NAMES[i]).collect();
        check!(matched_names.contains(&"build"));
        for name in &matched_names {
            check!(!name.contains("lint"));
            check!(!name.contains("test"));
        }
    }

    #[test]
    fn empty_query_returns_all() {
        let results = fuzzy_match("", TASK_NAMES);
        check!(results.len() == TASK_NAMES.len());
        // Indices should be in original order
        for (pos, &idx) in results.iter().enumerate() {
            check!(idx == pos);
        }
    }

    #[test]
    fn completely_unrelated_query_returns_nothing() {
        let results = fuzzy_match("zzzzz", TASK_NAMES);
        check!(results.is_empty());
    }

    #[test]
    fn package_qualified_match() {
        let results = fuzzy_match("app#build", TASK_NAMES);
        assert!(!results.is_empty());
        check!(TASK_NAMES[results[0]] == "app#build");
    }

    #[test]
    fn lint_matches_lint_tasks() {
        let results = fuzzy_match("lint", TASK_NAMES);
        assert!(!results.is_empty());
        let matched_names: Vec<&str> = results.iter().map(|&i| TASK_NAMES[i]).collect();
        check!(matched_names.contains(&"lint"));
        check!(matched_names.contains(&"app#lint"));
    }

    #[test]
    fn score_ordering_exact_before_fuzzy() {
        let results = fuzzy_match("build", TASK_NAMES);
        assert!(results.len() >= 2);
        // Exact "build" should appear before "app#build" (higher score = earlier position)
        let build_pos = results.iter().position(|&i| TASK_NAMES[i] == "build").unwrap();
        let app_build_pos = results.iter().position(|&i| TASK_NAMES[i] == "app#build").unwrap();
        check!(build_pos <= app_build_pos);
    }
}
