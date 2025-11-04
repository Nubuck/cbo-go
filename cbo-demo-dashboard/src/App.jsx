import React, { useCallback, useState, useEffect, useRef } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { motion } from 'framer-motion';
import CustomNode from './components/CustomNode';
import SystemNode from './components/SystemNode';
import DecisionNode from './components/DecisionNode';
import StepDetailsPanel from './components/StepDetailsPanel';
import NedbankLogo from './components/NedbankLogo';
import ProcessStats from './components/ProcessStats';
import { initialNodes, initialEdges } from './flowConfig';
import { getLayoutedElements, saveLayout, loadLayout, clearLayout } from './layoutUtils';

const nodeTypes = {
  custom: CustomNode,
  system: SystemNode,
  decision: DecisionNode,
};

function FlowDiagram() {
  const reactFlowInstance = useRef(null);

  // Initialize with auto-layout or saved layout
  const initializeNodes = () => {
    const savedNodes = loadLayout(initialNodes);
    if (savedNodes) {
      return savedNodes;
    }
    const { nodes: layoutedNodes } = getLayoutedElements(initialNodes, initialEdges);
    return layoutedNodes;
  };

  const [nodes, setNodes, onNodesChange] = useNodesState(initializeNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState(null);
  const [animateFlow, setAnimateFlow] = useState(false);
  const [highlightedNodes, setHighlightedNodes] = useState(new Set());
  const [currentStep, setCurrentStep] = useState(-1);
  const [isSimulating, setIsSimulating] = useState(false);
  const [autoFocus, setAutoFocus] = useState(true);
  const [metrics, setMetrics] = useState({
    casesProcessed: 200,
    successRate: 0,
    avgProcessTime: 0,
    activeAgents: 0
  });

  // Define multiple process flow sequences for different scenarios
  const processSequences = {
    success: [
      { nodeId: 'orchestrator', duration: 10000, message: 'Orchestrator initiates process' },
      { nodeId: 'bpm-query', duration: 12000, message: 'Querying IBM BPM for cases' },
      { nodeId: 'claim-cases', duration: 10000, message: 'Claiming and assigning cases' },
      { nodeId: 'save-database', duration: 10000, message: 'Saving to RPA database' },
      { nodeId: 'bot-swarm', duration: 12000, message: 'Bot swarm activates' },
      { nodeId: 'retrieve-docs', duration: 15000, message: 'Retrieving documents from ECM' },
      { nodeId: 'extract-data', duration: 15000, message: 'Extracting PDF data with 100% accuracy' },
      { nodeId: 'validate-fields', duration: 20000, message: 'All 6 fields validated successfully!' },
      { nodeId: 'check-statements', duration: 10000, message: 'Bank accounts verified' },
      { nodeId: 'check-insurance', duration: 10000, message: 'Insurance requirements met' },
      { nodeId: 'validation-result', duration: 12000, message: 'All validations passed ✅' },
      { nodeId: 'approve-case', duration: 15000, message: 'Case approved for disbursement!' },
      { nodeId: 'repeat-process', duration: 10000, message: 'Process complete, returning to queue' }
    ],
    issues: [
      { nodeId: 'orchestrator', duration: 10000, message: 'Orchestrator initiates process' },
      { nodeId: 'bpm-query', duration: 12000, message: 'Querying IBM BPM for cases' },
      { nodeId: 'claim-cases', duration: 10000, message: 'Claiming and assigning cases' },
      { nodeId: 'save-database', duration: 10000, message: 'Saving to RPA database' },
      { nodeId: 'bot-swarm', duration: 12000, message: 'Bot swarm activates' },
      { nodeId: 'retrieve-docs', duration: 15000, message: 'Retrieving documents from ECM' },
      { nodeId: 'extract-data', duration: 15000, message: 'Extracting PDF data' },
      { nodeId: 'validate-fields', duration: 20000, message: 'Field mismatch detected ⚠️' },
      { nodeId: 'validation-result', duration: 12000, message: 'Validation issues found' },
      { nodeId: 'flag-issues', duration: 15000, message: 'Flagging to liaison queue for correction' },
      { nodeId: 'repeat-process', duration: 10000, message: 'Process complete, case flagged' }
    ],
    missing: [
      { nodeId: 'orchestrator', duration: 10000, message: 'Orchestrator initiates process' },
      { nodeId: 'bpm-query', duration: 12000, message: 'Querying IBM BPM for cases' },
      { nodeId: 'claim-cases', duration: 10000, message: 'Claiming and assigning cases' },
      { nodeId: 'save-database', duration: 10000, message: 'Saving to RPA database' },
      { nodeId: 'bot-swarm', duration: 12000, message: 'Bot swarm activates' },
      { nodeId: 'retrieve-docs', duration: 15000, message: 'Documents missing from ECM' },
      { nodeId: 'validation-result', duration: 12000, message: 'Missing required documents' },
      { nodeId: 'second-queue', duration: 15000, message: 'Routing to 2nd queue for deep search' },
      { nodeId: 'repeat-process', duration: 10000, message: 'Extended processing initiated' }
    ]
  };

  const [simulationType, setSimulationType] = useState('success');

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node);
  }, []);

  // Layout functions
  const onAutoLayout = useCallback(() => {
    const { nodes: layoutedNodes } = getLayoutedElements(nodes, edges);
    setNodes(layoutedNodes);
  }, [nodes, edges, setNodes]);

  const onSaveLayout = useCallback(() => {
    if (saveLayout(nodes)) {
      alert('Layout saved successfully!');
    }
  }, [nodes]);

  const onResetLayout = useCallback(() => {
    clearLayout();
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(initialNodes, initialEdges);
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [setNodes, setEdges]);

  const onResetView = useCallback(() => {
    if (reactFlowInstance.current) {
      reactFlowInstance.current.fitView({ padding: 0.1, duration: 800 });
    }
  }, []);

  // Simulate live metrics updates
  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics(prev => ({
        casesProcessed: Math.min(prev.casesProcessed + Math.floor(Math.random() * 3), 487),
        successRate: Math.min(100, prev.successRate + (100 - prev.successRate) * 0.1),
        avgProcessTime: prev.avgProcessTime * 0.9 + (3 + Math.random() * 2) * 0.1,
        activeAgents: Math.floor(Math.random() * 2) + 4
      }));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // Sequential node highlighting
  const startSimulation = useCallback((type = 'success') => {
    setSimulationType(type);
    setIsSimulating(true);
    setAnimateFlow(true);
    setHighlightedNodes(new Set());
    setCurrentStep(0);
  }, []);

  // Manual step control
  const nextStep = useCallback(() => {
    const currentSequence = processSequences[simulationType];
    if (currentStep < currentSequence.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  }, [currentStep, simulationType]);

  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      // Clear future highlights when going back
      const currentSequence = processSequences[simulationType];
      const newHighlights = new Set();
      for (let i = 0; i < currentStep; i++) {
        newHighlights.add(currentSequence[i].nodeId);
      }
      setHighlightedNodes(newHighlights);
      setCurrentStep(prev => prev - 1);
    }
  }, [currentStep, simulationType]);

  const stopSimulation = useCallback(() => {
    setHighlightedNodes(new Set());
    setAnimateFlow(false);
    setIsSimulating(false);
    setCurrentStep(-1);
  }, []);

  useEffect(() => {
    if (!isSimulating || currentStep < 0) return;

    const currentSequence = processSequences[simulationType];

    if (currentStep >= currentSequence.length) {
      // Reset after simulation completes
      const resetTimer = setTimeout(() => {
        stopSimulation();
      }, 2000);
      return () => clearTimeout(resetTimer);
    }

    const step = currentSequence[currentStep];
    if (!step) return;

    // Highlight current node
    setHighlightedNodes(prev => new Set([...prev, step.nodeId]));

    // Update selected node to show info
    const node = nodes.find(n => n.id === step.nodeId);
    if (node) {
      setSelectedNode(node);

      // Auto-zoom and focus on the active node (if enabled)
      if (autoFocus && reactFlowInstance.current) {
        const nodeToFocus = nodes.find(n => n.id === step.nodeId);
        if (nodeToFocus) {
          reactFlowInstance.current.setCenter(
            nodeToFocus.position.x + 125, // Center on node (assuming 250px width)
            nodeToFocus.position.y + 90,  // Center on node (assuming 180px height)
            { zoom: 0.8, duration: 600 }
          );
        }
      }
    }

    // Auto-advance to next step after duration
    const advanceTimer = setTimeout(() => {
      if (isSimulating && currentStep < currentSequence.length - 1) {
        setCurrentStep(prev => prev + 1);
      } else if (currentStep === currentSequence.length - 1) {
        setCurrentStep(prev => prev + 1); // Trigger completion
      }
    }, step.duration || 10000);

    return () => clearTimeout(advanceTimer);
  }, [currentStep, isSimulating, simulationType, nodes, stopSimulation]);

  // Update nodes with highlighting
  const highlightedNodeList = nodes.map(node => ({
    ...node,
    style: {
      ...node.style,
      opacity: isSimulating && !highlightedNodes.has(node.id) ? 0.4 : 1,
      filter: highlightedNodes.has(node.id) ? 'drop-shadow(0 0 20px rgba(0, 255, 136, 0.8))' : 'none',
      transition: 'all 0.3s ease'
    }
  }))

  return (
    <div className="app-container">
      <motion.div
        className="header"
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="header-content">
          <NedbankLogo style={{ height: '48px', width: '48px' }} />
          <div>
            <h1>CBO Quality Verification System</h1>
            <p>Intelligent Document Processing & Validation Pipeline</p>
          </div>
        </div>
        <ProcessStats metrics={metrics} />
      </motion.div>

      <div className="main-content">
        <motion.div
          className="flow-container"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8 }}
        >
          <ReactFlow
            nodes={highlightedNodeList}
            edges={edges.map(edge => {
              const sourceHighlighted = highlightedNodes.has(edge.source);
              const targetHighlighted = highlightedNodes.has(edge.target);
              const edgeHighlighted = sourceHighlighted && targetHighlighted;

              return {
                ...edge,
                animated: animateFlow && edgeHighlighted,
                style: {
                  stroke: edgeHighlighted ? '#00ff88' : edge.style?.stroke || '#b1b1b7',
                  strokeWidth: edgeHighlighted ? 3 : 2,
                  opacity: isSimulating && !edgeHighlighted ? 0.3 : 1,
                  transition: 'all 0.3s ease'
                }
              };
            })}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onInit={(instance) => { reactFlowInstance.current = instance; }}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.05, maxZoom: 1.5, minZoom: 0.3 }}
          >
            <Controls />
            <MiniMap
              nodeColor={node => {
                if (highlightedNodes.has(node.id)) return '#00ff88';
                switch (node.type) {
                  case 'system': return '#4a90e2';
                  case 'decision': return '#f5a623';
                  case 'custom': return '#7b68ee';
                  default: return '#888';
                }
              }}
            />
            <Background variant="dots" gap={12} size={1} />
          </ReactFlow>

          {isSimulating && currentStep >= 0 && currentStep < processSequences[simulationType].length && (
            <motion.div
              className="simulation-status"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <div className="status-message">
                Step {currentStep + 1}/{processSequences[simulationType].length}: {processSequences[simulationType][currentStep].message}
              </div>
              <div className="simulation-controls-inline">
                <button onClick={prevStep} disabled={currentStep === 0}>⬅️ Prev</button>
                <button onClick={stopSimulation}>⏹️ Stop</button>
                <button onClick={nextStep} disabled={currentStep >= processSequences[simulationType].length - 1}>➡️ Next</button>
                <label className="auto-focus-toggle">
                  <input
                    type="checkbox"
                    checked={autoFocus}
                    onChange={(e) => setAutoFocus(e.target.checked)}
                  />
                  Auto-focus
                </label>
              </div>
            </motion.div>
          )}

          <div className="control-panels">
            <div className="layout-controls">
              <button
                className="control-button"
                onClick={onAutoLayout}
                title="Auto-arrange nodes"
              >
                📐 Auto Layout
              </button>
              <button
                className="control-button"
                onClick={onSaveLayout}
                title="Save current layout"
              >
                💾 Save Layout
              </button>
              <button
                className="control-button"
                onClick={onResetLayout}
                title="Reset to default layout"
              >
                🔄 Reset Layout
              </button>
              <button
                className="control-button"
                onClick={onResetView}
                title="Reset zoom and center"
              >
                🔍 Reset View
              </button>
            </div>

            <div className="simulation-controls">
              <button
                className="animate-button success"
                onClick={() => startSimulation('success')}
                disabled={isSimulating}
              >
                {isSimulating && simulationType === 'success' ? 'Running...' : 'Success Path'}
              </button>
              <button
                className="animate-button error"
                onClick={() => startSimulation('issues')}
                disabled={isSimulating}
              >
                {isSimulating && simulationType === 'issues' ? 'Running...' : 'Issues Path'}
              </button>
              <button
                className="animate-button warning"
                onClick={() => startSimulation('missing')}
                disabled={isSimulating}
              >
                {isSimulating && simulationType === 'missing' ? 'Running...' : 'Missing Docs'}
              </button>
            </div>
          </div>
        </motion.div>

        <StepDetailsPanel
          selectedNode={selectedNode}
          currentStep={currentStep}
          simulationType={simulationType}
          processSequences={processSequences}
        />
      </div>
    </div>
  );
}

// Wrapper component with ReactFlowProvider
function App() {
  return (
    <ReactFlowProvider>
      <FlowDiagram />
    </ReactFlowProvider>
  );
}

export default App;