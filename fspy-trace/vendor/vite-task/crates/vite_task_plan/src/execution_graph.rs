use std::ops::{Deref, Index};

use petgraph::{
    graph::{DefaultIx, DiGraph, EdgeIndex, IndexType, NodeIndex},
    visit::{DfsEvent, depth_first_search},
};
use rustc_hash::FxHashMap;
use serde::{Serialize, Serializer};

use crate::TaskExecution;

/// newtype of `DefaultIx` for indices in execution graphs
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ExecutionIx(DefaultIx);
// SAFETY: ExecutionIx is a newtype over DefaultIx which already implements IndexType correctly
unsafe impl IndexType for ExecutionIx {
    fn new(x: usize) -> Self {
        Self(DefaultIx::new(x))
    }

    fn index(&self) -> usize {
        self.0.index()
    }

    fn max() -> Self {
        Self(<DefaultIx as IndexType>::max())
    }
}

pub type ExecutionNodeIndex = NodeIndex<ExecutionIx>;
pub type ExecutionEdgeIndex = EdgeIndex<ExecutionIx>;

/// The inner directed graph type used for construction and storage.
pub(crate) type InnerExecutionGraph = DiGraph<TaskExecution, (), ExecutionIx>;

/// Error returned by [`AcyclicGraph::try_from_graph`] when a cycle is detected.
///
/// Contains the full cycle path as node indices. The path is a closed loop:
/// `[n0, n1, ..., nk, n0]` representing the cycle `n0 → n1 → ... → nk → n0`.
#[derive(Debug)]
pub struct CycleError<Ix: IndexType = DefaultIx> {
    cycle_path: Vec<NodeIndex<Ix>>,
}

impl<Ix: IndexType> CycleError<Ix> {
    /// Return the full cycle path as node indices.
    ///
    /// The path is a closed loop: `[n0, n1, ..., nk, n0]` where each consecutive
    /// pair `(path[i], path[i+1])` is an edge in the graph.
    #[must_use]
    pub fn cycle_path(&self) -> &[NodeIndex<Ix>] {
        &self.cycle_path
    }
}

/// A directed acyclic graph with a compile-time guarantee (via construction-time
/// validation) that it contains no cycles.
///
/// Unlike `petgraph::acyclic::Acyclic`, this type is `Sync` (no internal `RefCell`),
/// so it can be safely shared via `Arc` across threads.
///
/// The type implements `Deref<Target = DiGraph<...>>`, so all read operations on the
/// inner graph (indexing, iteration, node/edge counts) work transparently.
#[derive(Debug)]
pub struct AcyclicGraph<N, Ix: IndexType = DefaultIx> {
    /// The underlying directed graph, guaranteed to be acyclic.
    graph: DiGraph<N, (), Ix>,
}

impl<N, Ix: IndexType> AcyclicGraph<N, Ix> {
    /// Validate that `graph` is acyclic and wrap it in an `AcyclicGraph`.
    ///
    /// Uses a DFS to detect cycles. If a cycle is found, returns a [`CycleError`]
    /// containing the full cycle path. The cycle detection correctly handles graphs
    /// with multiple disconnected components.
    ///
    /// # Errors
    ///
    /// Returns [`CycleError`] if the graph contains a cycle.
    pub fn try_from_graph(graph: DiGraph<N, (), Ix>) -> Result<Self, CycleError<Ix>> {
        if let Some(cycle_path) = find_cycle_path(&graph) {
            return Err(CycleError { cycle_path });
        }
        Ok(Self { graph })
    }

    /// Return a reference to the underlying `DiGraph`.
    ///
    /// Useful when an API requires `&DiGraph` explicitly (e.g. `vite_graph_ser::serialize_by_key`).
    #[must_use]
    pub const fn inner(&self) -> &DiGraph<N, (), Ix> {
        &self.graph
    }

    /// Build an `AcyclicGraph` from an iterator of nodes with no edges.
    ///
    /// Each node becomes an independent node in the graph. Since there are
    /// no edges, the graph is trivially acyclic.
    pub fn from_node_list(nodes: impl IntoIterator<Item = N>) -> Self {
        let mut graph = DiGraph::default();
        for node in nodes {
            graph.add_node(node);
        }
        Self { graph }
    }

    /// Compute the topological order of node indices.
    ///
    /// For every edge A→B in the graph, A appears before B in the returned vector.
    /// Since our edges mean "A depends on B", dependents come before their
    /// dependencies. Callers that need execution order (dependencies first) should
    /// iterate in reverse.
    ///
    /// This computes the order on each call rather than caching it.
    ///
    /// # Panics
    ///
    /// Panics if the graph contains a cycle, which should be impossible since
    /// acyclicity is validated at construction time.
    #[must_use]
    pub fn compute_topological_order(&self) -> Vec<NodeIndex<Ix>> {
        petgraph::algo::toposort(&self.graph, None)
            .expect("AcyclicGraph: acyclicity validated at construction time")
    }
}

impl<N, Ix: IndexType> Default for AcyclicGraph<N, Ix> {
    /// Create an empty `AcyclicGraph` (no nodes, no edges).
    ///
    /// An empty graph is trivially acyclic.
    fn default() -> Self {
        Self { graph: DiGraph::default() }
    }
}

/// Deref to the inner `DiGraph` so that read-only graph operations
/// (`node_count()`, `node_weights()`, `node_indices()`, etc.)
/// work transparently on `AcyclicGraph`.
impl<N, Ix: IndexType> Deref for AcyclicGraph<N, Ix> {
    type Target = DiGraph<N, (), Ix>;

    fn deref(&self) -> &Self::Target {
        &self.graph
    }
}

/// Explicit `NodeIndex` indexing so that `graph[node_ix]` continues to work
/// even when downstream crates add their own `Index` impls on `AcyclicGraph`
/// (a direct `Index` impl shadows any `Index` that would be found through `Deref`).
impl<N, Ix: IndexType> Index<NodeIndex<Ix>> for AcyclicGraph<N, Ix> {
    type Output = N;

    fn index(&self, index: NodeIndex<Ix>) -> &Self::Output {
        &self.graph[index]
    }
}

/// The execution graph type alias, specialized for task execution.
pub type ExecutionGraph = AcyclicGraph<TaskExecution, ExecutionIx>;

impl<N: vite_graph_ser::GetKey + Serialize, Ix: IndexType> Serialize for AcyclicGraph<N, Ix> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        vite_graph_ser::serialize_by_key(&self.graph, serializer)
    }
}

/// Find a cycle in the directed graph, returning the cycle path if one exists.
///
/// Uses a DFS with predecessor tracking. When a back edge `u → v` is detected
/// (where `v` is an ancestor of `u` in the DFS tree), the predecessor chain from
/// `u` back to `v` is walked to reconstruct the full cycle path.
///
/// The returned path is a closed loop: `[v, ..., u, v]` representing the cycle
/// `v → ... → u → v`.
///
/// Handles graphs with multiple disconnected components by starting DFS from
/// all nodes via `graph.node_indices()`.
fn find_cycle_path<N, Ix: IndexType>(graph: &DiGraph<N, (), Ix>) -> Option<Vec<NodeIndex<Ix>>> {
    let mut predecessor = FxHashMap::<NodeIndex<Ix>, NodeIndex<Ix>>::default();

    let result: Result<(), Vec<NodeIndex<Ix>>> =
        depth_first_search(graph, graph.node_indices(), |event| match event {
            DfsEvent::TreeEdge(u, v) => {
                predecessor.insert(v, u);
                Ok(())
            }
            DfsEvent::BackEdge(u, v) => {
                // v is an ancestor of u in the DFS tree.
                // Walk the predecessor chain from u back to v to reconstruct the cycle.
                let mut path = vec![u];
                let mut current = u;
                while current != v {
                    current = predecessor[&current];
                    path.push(current);
                }
                path.reverse(); // now [v, ..., u]
                path.push(v); // close the cycle: [v, ..., u, v]
                Err(path)
            }
            _ => Ok(()),
        });

    result.err()
}

#[cfg(test)]
#[expect(clippy::many_single_char_names, reason = "short names are clear for graph test nodes")]
mod tests {
    use petgraph::graph::{DefaultIx, DiGraph, NodeIndex};

    use super::*;

    /// Assert that `cycle_path` is a valid cycle in `graph`:
    /// - first == last (closed loop)
    /// - length >= 2
    /// - each consecutive pair `(path[i], path[i+1])` is an edge in the graph
    fn assert_valid_cycle<N, Ix: IndexType>(
        graph: &DiGraph<N, (), Ix>,
        cycle_path: &[NodeIndex<Ix>],
    ) {
        assert!(
            cycle_path.len() >= 2,
            "cycle path must have at least 2 elements, got {cycle_path:?}"
        );
        assert_eq!(
            cycle_path.first(),
            cycle_path.last(),
            "cycle must be closed (first == last), got {cycle_path:?}"
        );
        for window in cycle_path.windows(2) {
            assert!(
                graph.contains_edge(window[0], window[1]),
                "missing edge {:?} -> {:?} in graph; cycle_path = {cycle_path:?}",
                window[0],
                window[1],
            );
        }
    }

    #[test]
    fn empty_graph() {
        let graph = AcyclicGraph::<i32>::default();
        assert_eq!(graph.node_count(), 0);
        assert!(graph.compute_topological_order().is_empty());
    }

    #[test]
    fn single_node() {
        let mut g = DiGraph::<&str, ()>::new();
        let a = g.add_node("a");
        let graph = AcyclicGraph::try_from_graph(g).unwrap();
        assert_eq!(graph.node_count(), 1);
        assert_eq!(graph.compute_topological_order(), vec![a]);
    }

    #[test]
    fn linear_chain() {
        // A → B → C
        let mut g = DiGraph::<&str, ()>::new();
        let a = g.add_node("a");
        let b = g.add_node("b");
        let c = g.add_node("c");
        g.add_edge(a, b, ());
        g.add_edge(b, c, ());

        let graph = AcyclicGraph::try_from_graph(g).unwrap();
        let order = graph.compute_topological_order();
        let pos_a = order.iter().position(|&n| n == a).unwrap();
        let pos_b = order.iter().position(|&n| n == b).unwrap();
        let pos_c = order.iter().position(|&n| n == c).unwrap();
        assert!(pos_a < pos_b, "a must come before b");
        assert!(pos_b < pos_c, "b must come before c");
    }

    #[test]
    fn diamond_dag() {
        //   A
        //  / \
        // B   C
        //  \ /
        //   D
        let mut g = DiGraph::<&str, ()>::new();
        let a = g.add_node("a");
        let b = g.add_node("b");
        let c = g.add_node("c");
        let d = g.add_node("d");
        g.add_edge(a, b, ());
        g.add_edge(a, c, ());
        g.add_edge(b, d, ());
        g.add_edge(c, d, ());

        let graph = AcyclicGraph::try_from_graph(g).unwrap();
        let order = graph.compute_topological_order();
        let pos = |n: NodeIndex<DefaultIx>| order.iter().position(|&x| x == n).unwrap();
        assert!(pos(a) < pos(b));
        assert!(pos(a) < pos(c));
        assert!(pos(b) < pos(d));
        assert!(pos(c) < pos(d));
    }

    #[test]
    fn simple_cycle() {
        // A → B → A
        let mut g = DiGraph::<&str, ()>::new();
        let a = g.add_node("a");
        let b = g.add_node("b");
        g.add_edge(a, b, ());
        g.add_edge(b, a, ());

        let err = AcyclicGraph::try_from_graph(g.clone()).unwrap_err();
        let path = err.cycle_path();
        assert_valid_cycle(&g, path);
        // Both nodes must appear in the cycle
        let unique: rustc_hash::FxHashSet<_> = path.iter().copied().collect();
        assert!(unique.contains(&a));
        assert!(unique.contains(&b));
    }

    #[test]
    fn self_loop() {
        // A → A
        let mut g = DiGraph::<&str, ()>::new();
        let a = g.add_node("a");
        g.add_edge(a, a, ());

        let err = AcyclicGraph::try_from_graph(g.clone()).unwrap_err();
        let path = err.cycle_path();
        assert_eq!(path, &[a, a]);
        assert_valid_cycle(&g, path);
    }

    #[test]
    fn three_node_cycle() {
        // A → B → C → A
        let mut g = DiGraph::<&str, ()>::new();
        let a = g.add_node("a");
        let b = g.add_node("b");
        let c = g.add_node("c");
        g.add_edge(a, b, ());
        g.add_edge(b, c, ());
        g.add_edge(c, a, ());

        let err = AcyclicGraph::try_from_graph(g.clone()).unwrap_err();
        let path = err.cycle_path();
        assert_valid_cycle(&g, path);
        let unique: rustc_hash::FxHashSet<_> = path.iter().copied().collect();
        assert!(unique.contains(&a));
        assert!(unique.contains(&b));
        assert!(unique.contains(&c));
    }

    #[test]
    fn from_node_list_is_acyclic() {
        let graph = AcyclicGraph::<&str>::from_node_list(["a", "b", "c"]);
        assert_eq!(graph.node_count(), 3);
        assert_eq!(graph.compute_topological_order().len(), 3);
    }

    #[test]
    fn compute_topological_order_valid() {
        // Verify every edge A→B has A before B in the topological order
        let mut g = DiGraph::<i32, ()>::new();
        let n0 = g.add_node(0);
        let n1 = g.add_node(1);
        let n2 = g.add_node(2);
        let n3 = g.add_node(3);
        let n4 = g.add_node(4);
        g.add_edge(n0, n1, ());
        g.add_edge(n0, n2, ());
        g.add_edge(n1, n3, ());
        g.add_edge(n2, n3, ());
        g.add_edge(n3, n4, ());

        let graph = AcyclicGraph::try_from_graph(g).unwrap();
        let order = graph.compute_topological_order();
        let pos = |n: NodeIndex<DefaultIx>| order.iter().position(|&x| x == n).unwrap();

        // Check every edge
        assert!(pos(n0) < pos(n1));
        assert!(pos(n0) < pos(n2));
        assert!(pos(n1) < pos(n3));
        assert!(pos(n2) < pos(n3));
        assert!(pos(n3) < pos(n4));
    }

    #[test]
    fn deref_to_inner() {
        let mut g = DiGraph::<&str, ()>::new();
        let a = g.add_node("hello");
        g.add_node("world");

        let graph = AcyclicGraph::try_from_graph(g).unwrap();
        // Deref allows calling DiGraph methods directly
        assert_eq!(graph.node_count(), 2);
        assert_eq!(graph.edge_count(), 0);
        assert_eq!(graph[a], "hello");
        assert_eq!(graph.node_weights().count(), 2);
    }

    #[test]
    fn disconnected_acyclic_components() {
        // Component 1: A → B
        // Component 2: C → D
        // No edges between components — acyclic
        let mut g = DiGraph::<&str, ()>::new();
        let a = g.add_node("a");
        let b = g.add_node("b");
        let c = g.add_node("c");
        let d = g.add_node("d");
        g.add_edge(a, b, ());
        g.add_edge(c, d, ());

        let graph = AcyclicGraph::try_from_graph(g).unwrap();
        let order = graph.compute_topological_order();
        assert_eq!(order.len(), 4);
        let pos = |n: NodeIndex<DefaultIx>| order.iter().position(|&x| x == n).unwrap();
        assert!(pos(a) < pos(b));
        assert!(pos(c) < pos(d));
    }

    #[test]
    fn disconnected_with_cycle_in_one_component() {
        // Component 1: A → B (acyclic)
        // Component 2: C → D → C (cycle)
        let mut g = DiGraph::<&str, ()>::new();
        let a = g.add_node("a");
        let b = g.add_node("b");
        let c = g.add_node("c");
        let d = g.add_node("d");
        g.add_edge(a, b, ());
        g.add_edge(c, d, ());
        g.add_edge(d, c, ());

        let err = AcyclicGraph::try_from_graph(g.clone()).unwrap_err();
        let path = err.cycle_path();
        assert_valid_cycle(&g, path);

        // The cycle path must only contain nodes from the cyclic component (c, d)
        let unique: rustc_hash::FxHashSet<_> = path.iter().copied().collect();
        assert!(unique.contains(&c), "cycle path must contain c");
        assert!(unique.contains(&d), "cycle path must contain d");
        assert!(!unique.contains(&a), "cycle path must not contain a");
        assert!(!unique.contains(&b), "cycle path must not contain b");
    }

    #[test]
    fn disconnected_with_cycles_in_multiple_components() {
        // Component 1: A → B → A (cycle)
        // Component 2: C → D → C (cycle)
        let mut g = DiGraph::<&str, ()>::new();
        let a = g.add_node("a");
        let b = g.add_node("b");
        let c = g.add_node("c");
        let d = g.add_node("d");
        g.add_edge(a, b, ());
        g.add_edge(b, a, ());
        g.add_edge(c, d, ());
        g.add_edge(d, c, ());

        let err = AcyclicGraph::try_from_graph(g.clone()).unwrap_err();
        let path = err.cycle_path();
        assert_valid_cycle(&g, path);

        // DFS detects the first cycle encountered — nodes must be from one component
        let unique: rustc_hash::FxHashSet<_> = path.iter().copied().collect();
        let is_component_1 = unique.contains(&a) && unique.contains(&b);
        let is_component_2 = unique.contains(&c) && unique.contains(&d);
        assert!(is_component_1 || is_component_2, "cycle path must belong to one component");
        assert!(!(is_component_1 && is_component_2), "cycle path must not span components");
    }

    #[test]
    fn large_graph_cycle_in_later_component() {
        // Component 1: chain of 10 nodes (n0 → n1 → ... → n9), acyclic
        // Component 2: X → Y → X (cycle)
        let mut g = DiGraph::<i32, ()>::new();

        let mut chain_nodes = Vec::new();
        for i in 0..10 {
            chain_nodes.push(g.add_node(i));
        }
        for i in 0..9 {
            g.add_edge(chain_nodes[i], chain_nodes[i + 1], ());
        }

        let x = g.add_node(100);
        let y = g.add_node(101);
        g.add_edge(x, y, ());
        g.add_edge(y, x, ());

        let err = AcyclicGraph::try_from_graph(g.clone()).unwrap_err();
        let path = err.cycle_path();
        assert_valid_cycle(&g, path);

        // The cycle must be in the second component
        let unique: rustc_hash::FxHashSet<_> = path.iter().copied().collect();
        assert!(unique.contains(&x), "cycle path must contain x");
        assert!(unique.contains(&y), "cycle path must contain y");
        for &chain_node in &chain_nodes {
            assert!(!unique.contains(&chain_node), "cycle path must not contain chain nodes");
        }
    }
}
