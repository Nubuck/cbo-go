import dagre from 'dagre';

// Create a new dagre graph for layout calculation
export const getLayoutedElements = (nodes, edges, direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const nodeWidth = 250;
  const nodeHeight = 180;

  // Configure the layout
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 150,  // Horizontal spacing between nodes (increased)
    ranksep: 150,  // Vertical spacing between ranks (increased)
    marginx: 100,
    marginy: 100,
    align: 'DR',    // Downstream right alignment for better flow
    ranker: 'tight-tree'  // Use tight-tree algorithm for better layout
  });

  // Add nodes to the graph
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: nodeWidth,
      height: nodeHeight
    });
  });

  // Add edges to the graph
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  // Calculate the layout
  dagre.layout(dagreGraph);

  // Apply the calculated positions to nodes
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2
      }
    };
  });

  return { nodes: layoutedNodes, edges };
};

// Save layout to localStorage
export const saveLayout = (nodes) => {
  const positions = {};
  nodes.forEach(node => {
    positions[node.id] = node.position;
  });
  localStorage.setItem('cbo-flow-layout', JSON.stringify(positions));
  return true;
};

// Load layout from localStorage
export const loadLayout = (nodes) => {
  const savedPositions = localStorage.getItem('cbo-flow-layout');
  if (!savedPositions) return null;

  try {
    const positions = JSON.parse(savedPositions);
    return nodes.map(node => ({
      ...node,
      position: positions[node.id] || node.position
    }));
  } catch (e) {
    console.error('Failed to load saved layout:', e);
    return null;
  }
};

// Clear saved layout
export const clearLayout = () => {
  localStorage.removeItem('cbo-flow-layout');
};