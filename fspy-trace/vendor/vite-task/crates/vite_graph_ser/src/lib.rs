use petgraph::{
    graph::DiGraph,
    visit::{EdgeRef as _, IntoNodeReferences},
};
use serde::{Serialize, Serializer};

/// Trait for getting a unique key for a node in the graph.
/// This key is used for serializing the graph with `serialize_by_key`.
pub trait GetKey {
    type Key<'a>: Serialize + Ord
    where
        Self: 'a;
    /// # Errors
    /// Returns an error if the key cannot be computed.
    #[expect(clippy::disallowed_types, reason = "trait error type is String for simplicity")]
    fn key(&self) -> Result<Self::Key<'_>, String>;
}

#[derive(Serialize)]
#[serde(bound = "N: Serialize")]
struct DiGraphNodeItem<'a, N: GetKey> {
    key: N::Key<'a>,
    node: &'a N,
    neighbors: Vec<N::Key<'a>>,
}

/// A wrapper around `DiGraph` that serializes nodes by their keys.
///
/// Only node connectivity is recorded — edge weights are ignored in the output.
#[derive(Serialize)]
#[serde(transparent)]
pub struct SerializeByKey<'a, N: GetKey + Serialize, E, Ix: petgraph::graph::IndexType>(
    #[serde(serialize_with = "serialize_by_key")] pub &'a DiGraph<N, E, Ix>,
);

/// Serialize a directed graph into a map from node keys to their values and neighbors by keys.
///
/// Keys in nodes and edges are sorted lexicographically.
///
/// If there are multiple nodes with the same key, or multiple edges between nodes with the same keys,
/// an error will be returned.
///
/// This is useful for serializing graphs in a stable and human-readable way.
///
/// # Errors
/// Returns a serialization error if the graph cannot be serialized.
///
/// # Panics
/// Panics if an edge references a node index not present in the graph.
pub fn serialize_by_key<N: GetKey + Serialize, E, Ix: petgraph::graph::IndexType, S: Serializer>(
    graph: &DiGraph<N, E, Ix>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let mut items = Vec::<DiGraphNodeItem<'_, N>>::with_capacity(graph.node_count());
    for (node_idx, node) in graph.node_references() {
        let mut neighbors = Vec::<N::Key<'_>>::new();

        for edge in graph.edges(node_idx) {
            let target_idx = edge.target();
            let target_node = graph.node_weight(target_idx).unwrap();
            neighbors.push(target_node.key().map_err(serde::ser::Error::custom)?);
        }
        neighbors.sort_unstable();
        items.push(DiGraphNodeItem {
            key: node.key().map_err(serde::ser::Error::custom)?,
            node,
            neighbors,
        });
    }
    items.sort_unstable_by(|a, b| a.key.cmp(&b.key));
    items.serialize(serializer)
}

#[cfg(test)]
mod tests {
    use petgraph::graph::DiGraph;

    use super::*;

    #[derive(Debug, Clone, Serialize)]
    struct TestNode {
        id: &'static str,
        value: i32,
    }

    impl GetKey for TestNode {
        type Key<'a>
            = &'a str
        where
            Self: 'a;

        #[expect(clippy::disallowed_types, reason = "trait requires String error type")]
        fn key(&self) -> Result<Self::Key<'_>, String> {
            Ok(self.id)
        }
    }

    #[derive(Serialize)]
    struct GraphWrapper {
        #[serde(serialize_with = "serialize_by_key")]
        graph: DiGraph<TestNode, ()>,
    }

    #[test]
    fn test_serialize_graph_happy_path() {
        let mut graph = DiGraph::<TestNode, ()>::new();
        let a = graph.add_node(TestNode { id: "a", value: 1 });
        let b = graph.add_node(TestNode { id: "b", value: 2 });
        let c = graph.add_node(TestNode { id: "c", value: 3 });

        graph.add_edge(a, b, ());
        graph.add_edge(a, c, ());
        graph.add_edge(b, c, ());

        let json = serde_json::to_value(GraphWrapper { graph }).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "graph": [
                    {
                        "key": "a",
                        "node": {"id": "a", "value": 1},
                        "neighbors": ["b", "c"]
                    },
                    {
                        "key": "b",
                        "node": {"id": "b", "value": 2},
                        "neighbors": ["c"]
                    },
                    {
                        "key": "c",
                        "node": {"id": "c", "value": 3},
                        "neighbors": []
                    }
                ]
            })
        );
    }
}
