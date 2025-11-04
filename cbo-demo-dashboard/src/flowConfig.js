import { MarkerType } from 'reactflow';

export const initialNodes = [
  // Orchestrator Section - Top Level
  {
    id: 'orchestrator',
    type: 'system',
    position: { x: 650, y: 50 },
    data: {
      label: 'Orchestrator Agent',
      icon: '🎯',
      description: 'Central control system',
      stats: { active: true, load: '78%' },
      systems: ['IBM BPM API', 'Roboteur RPA']
    }
  },

  // Level 2 - Initial Processing
  {
    id: 'bpm-query',
    type: 'custom',
    position: { x: 150, y: 200 },
    data: {
      label: 'Query BPM API',
      icon: '📊',
      description: 'Retrieve loan cases from CBO Quality Verification queue',
      details: ['Personal Loans', 'Credit Cards', 'Overdrafts'],
      metrics: { avgTime: '1.2s', volume: '400-800/day' }
    }
  },
  {
    id: 'claim-cases',
    type: 'custom',
    position: { x: 500, y: 200 },
    data: {
      label: 'Claim & Assign Cases',
      icon: '🔄',
      description: 'Claim under domain account & distribute to bot swarm',
      details: ['5 Active Bots', 'Load Balanced', 'Real-time Assignment']
    }
  },
  {
    id: 'save-database',
    type: 'system',
    position: { x: 850, y: 200 },
    data: {
      label: 'Roboteur RPA Database',
      icon: '💾',
      description: 'Real-time case storage',
      systems: ['SQLite', 'Case Models', 'Assignment Queue']
    }
  },

  // Level 3 - Bot Processing
  {
    id: 'bot-swarm',
    type: 'system',
    position: { x: 650, y: 350 },
    data: {
      label: 'Bot Swarm (5 Agents)',
      icon: '🤖',
      description: 'Parallel processing units',
      stats: { active: 5, efficiency: '98%' }
    }
  },

  // Level 4 - Document Processing
  {
    id: 'retrieve-docs',
    type: 'custom',
    position: { x: 250, y: 500 },
    data: {
      label: 'Retrieve Documents',
      icon: '📁',
      description: 'Query ECM document server',
      details: ['PAQ Document', 'Application', 'Bank Statements'],
      metrics: { avgTime: '2.1s' }
    }
  },
  {
    id: 'extract-data',
    type: 'decision',
    position: { x: 650, y: 500 },
    data: {
      label: 'Extract PDF Data',
      icon: '🔍',
      description: 'Digital extraction or OCR processing',
      options: ['Digital PDF (100% accuracy)', 'OCR Processing (80%+ target)'],
      breakthrough: '100% accuracy on digital PDFs!'
    }
  },
  {
    id: 'validate-fields',
    type: 'custom',
    position: { x: 1050, y: 500 },
    data: {
      label: 'Validate Fields',
      icon: '✅',
      description: 'Spatial validation & comparison',
      details: ['6 Critical Fields', 'Staff Discount Logic', 'Focused Spatial Search'],
      metrics: { accuracy: '100%', time: '0.3s' }
    }
  },

  // Level 5 - Validation Checks
  {
    id: 'check-statements',
    type: 'custom',
    position: { x: 450, y: 650 },
    data: {
      label: 'Verify Bank Accounts',
      icon: '🏦',
      description: 'Validate debit order & disbursement accounts',
      details: ['Account ownership', 'Active status']
    }
  },
  {
    id: 'check-insurance',
    type: 'decision',
    position: { x: 850, y: 650 },
    data: {
      label: 'Insurance Check',
      icon: '🛡️',
      description: 'Personal loans insurance verification',
      options: ['3rd Party Insurance', 'Waiver Document', 'Bank Insurance']
    }
  },

  // Level 6 - Decision Point
  {
    id: 'validation-result',
    type: 'decision',
    position: { x: 650, y: 800 },
    data: {
      label: 'Validation Result',
      icon: '⚡',
      description: 'Route based on validation outcome',
      options: ['✅ All Passed', '❌ Issues Found', '🔍 Missing Docs', '⚠️ Edge Case']
    }
  },

  // Level 7 - Outcomes (spread out horizontally)
  {
    id: 'approve-case',
    type: 'custom',
    position: { x: 150, y: 950 },
    data: {
      label: 'Approve Case',
      icon: '✅',
      description: 'Web automation approval',
      details: ['Login BPM UI', 'Search case', 'Approve with comments'],
      success: true
    }
  },
  {
    id: 'flag-issues',
    type: 'custom',
    position: { x: 450, y: 950 },
    data: {
      label: 'Flag for Liaison',
      icon: '🚩',
      description: 'Request document corrections',
      details: ['Mark issues', 'Request updates', 'Route to liaison queue'],
      warning: true
    }
  },
  {
    id: 'second-queue',
    type: 'custom',
    position: { x: 750, y: 950 },
    data: {
      label: '2nd Queue Processing',
      icon: '⏳',
      description: 'Deep document search',
      details: ['Extended ECM query', 'Image enhancement', 'OCR retry']
    }
  },
  {
    id: 'manual-review',
    type: 'custom',
    position: { x: 1050, y: 950 },
    data: {
      label: 'Manual Review',
      icon: '👤',
      description: 'Edge case handling',
      details: ['~1% of cases', 'Complex scenarios'],
      rare: true
    }
  },

  // Level 8 - Loop Back
  {
    id: 'repeat-process',
    type: 'system',
    position: { x: 650, y: 1100 },
    data: {
      label: 'Process Complete',
      icon: '♻️',
      description: 'Return to case queue',
      stats: { completed: true }
    }
  }
];

export const initialEdges = [
  // Main Flow
  {
    id: 'e1', source: 'orchestrator', target: 'bpm-query',
    type: 'smoothstep', animated: true,
    style: { stroke: '#4a90e2', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed }
  },
  {
    id: 'e2', source: 'bpm-query', target: 'claim-cases',
    type: 'smoothstep',
    label: 'Cases Found',
    style: { stroke: '#4a90e2', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed }
  },
  {
    id: 'e3', source: 'claim-cases', target: 'save-database',
    type: 'smoothstep',
    style: { stroke: '#4a90e2', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed }
  },
  {
    id: 'e4', source: 'save-database', target: 'bot-swarm',
    type: 'smoothstep',
    style: { stroke: '#7b68ee', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed }
  },
  {
    id: 'e5', source: 'bot-swarm', target: 'retrieve-docs',
    type: 'smoothstep',
    label: 'Process Case',
    style: { stroke: '#7b68ee', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed }
  },
  {
    id: 'e6', source: 'retrieve-docs', target: 'extract-data',
    type: 'smoothstep',
    style: { stroke: '#7b68ee', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed }
  },
  {
    id: 'e7', source: 'extract-data', target: 'validate-fields',
    type: 'smoothstep',
    style: { stroke: '#7b68ee', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed }
  },
  {
    id: 'e8', source: 'validate-fields', target: 'check-statements',
    type: 'smoothstep',
    style: { stroke: '#7b68ee', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed }
  },
  {
    id: 'e9', source: 'validate-fields', target: 'check-insurance',
    type: 'smoothstep',
    label: 'Personal Loan',
    style: { stroke: '#f5a623', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed }
  },
  {
    id: 'e10', source: 'check-statements', target: 'validation-result',
    type: 'smoothstep',
    style: { stroke: '#7b68ee', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed }
  },
  {
    id: 'e11', source: 'check-insurance', target: 'validation-result',
    type: 'smoothstep',
    style: { stroke: '#f5a623', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed }
  },

  // Outcome Edges
  {
    id: 'e12', source: 'validation-result', target: 'approve-case',
    type: 'smoothstep',
    label: 'All Passed',
    style: { stroke: '#00ff88', strokeWidth: 3 },
    markerEnd: { type: MarkerType.ArrowClosed }
  },
  {
    id: 'e13', source: 'validation-result', target: 'flag-issues',
    type: 'smoothstep',
    label: 'Issues Found',
    style: { stroke: '#ff6b6b', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed }
  },
  {
    id: 'e14', source: 'validation-result', target: 'second-queue',
    type: 'smoothstep',
    label: 'Missing Docs',
    style: { stroke: '#ffd43b', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed }
  },
  {
    id: 'e15', source: 'validation-result', target: 'manual-review',
    type: 'smoothstep',
    label: 'Edge Case (1%)',
    style: { stroke: '#e599f7', strokeWidth: 2, strokeDasharray: '5,5' },
    markerEnd: { type: MarkerType.ArrowClosed }
  },

  // Return to Process
  {
    id: 'e16', source: 'approve-case', target: 'repeat-process',
    type: 'smoothstep',
    style: { stroke: '#00ff88', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed }
  },
  {
    id: 'e17', source: 'flag-issues', target: 'repeat-process',
    type: 'smoothstep',
    style: { stroke: '#ff6b6b', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed }
  },
  {
    id: 'e18', source: 'second-queue', target: 'repeat-process',
    type: 'smoothstep',
    style: { stroke: '#ffd43b', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed }
  },
  {
    id: 'e19', source: 'manual-review', target: 'repeat-process',
    type: 'smoothstep',
    style: { stroke: '#e599f7', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed }
  },
  {
    id: 'e20', source: 'repeat-process', target: 'bot-swarm',
    type: 'smoothstep',
    label: 'Next Case',
    style: { stroke: '#4a90e2', strokeWidth: 2, strokeDasharray: '10,5' },
    markerEnd: { type: MarkerType.ArrowClosed }
  }
];