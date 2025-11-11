import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, CheckCircle, AlertTriangle } from 'lucide-react';

const StepDetailsPanel = ({ selectedNode, currentStep, simulationType, processSequences }) => {
  const currentSequence = processSequences?.[simulationType] || [];
  const currentStepData = currentStep >= 0 ? currentSequence[currentStep] : null;

  // Node details mapping for better descriptions
  const nodeDetails = {
    'orchestrator': {
      title: 'Central Orchestration Hub',
      description: 'The orchestrator agent manages the entire verification process, coordinating between IBM BPM, ECM, and the bot swarm.',
      keyPoints: [
        'Queries IBM BPM API for pending cases',
        'Claims cases under domain account',
        'Distributes work across 5 bot agents',
        'Monitors process completion',
        'Handles 400-800 cases/day'
      ]
    },
    'bpm-query': {
      title: 'IBM BPM Integration',
      description: 'Retrieves loan cases from the CBO Quality Verification queue for processing in the air-gapped bank network.',
      keyPoints: [
        'Personal Loans',
        'Credit Cards & Limit Increases',
        'Overdrafts & Limit Increases',
        'Real-time case retrieval',
        'Secure API integration'
      ]
    },
    'claim-cases': {
      title: 'Case Claiming & Assignment',
      description: 'Orchestrator claims cases from the BPM queue and assigns them to available bot agents for processing.',
      keyPoints: [
        'Claims under domain account',
        'Load balancing across 5 bots',
        'Prevents duplicate processing',
        'Queue priority management',
        'Concurrent case handling'
      ]
    },
    'bot-swarm': {
      title: 'Distributed Bot Swarm',
      description: 'Fleet of 5 specialized bot agents working in parallel to process verification cases at scale.',
      keyPoints: [
        '5 bot machines in production',
        '3-5 minutes per valid document',
        'Parallel processing capability',
        'Fault-tolerant architecture',
        'Can scale to 8 total bots'
      ]
    },
    'retrieve-docs': {
      title: 'ECM Document Retrieval',
      description: 'Queries the Enterprise Content Management system to gather all required documents for validation.',
      keyPoints: [
        'PAQ (Pre-Agreement Quote) - Primary document',
        'Application documents',
        'Bank statements (3-6 months)',
        'Insurance documents (if applicable)',
        'Automated retry on failures'
      ]
    },
    'check-statements': {
      title: 'Statement Document Check',
      description: 'Validates that required bank statements are present and complete for the verification period.',
      keyPoints: [
        '3-6 month statement requirement',
        'Document completeness check',
        'Date range validation',
        'Format verification',
        'Flags missing statements'
      ]
    },
    'check-insurance': {
      title: 'Insurance Documentation Check',
      description: 'Verifies insurance documentation is present when credit life insurance is included in the loan.',
      keyPoints: [
        'Credit life insurance validation',
        'Staff vs regular rates check',
        'Premium amount verification',
        'Optional for some loan types',
        'Compliance requirements'
      ]
    },
    'extract-data': {
      title: '100% Accurate Data Extraction',
      description: 'Our breakthrough technology extracts data from PDFs with perfect accuracy on digital documents using spatial bounding box analysis.',
      keyPoints: [
        '100% accuracy on digital PDFs',
        'Spatial search algorithm',
        'OCR for scanned documents (80%+ target)',
        'Coordinate-based extraction',
        'Handles South African currency format',
        'Sub-second processing time'
      ],
      achievement: true
    },
    'validate-fields': {
      title: 'Field Validation Engine',
      description: 'Validates all critical fields using our proprietary spatial validation algorithm with focused search and direct value matching.',
      keyPoints: [
        '6/6 fields validated with 100% accuracy',
        'Case ID verification',
        'Loan amount validation',
        'Interest rate checking',
        'Insurance premium verification',
        'Staff discount dual-table logic',
        'Collection account validation'
      ],
      achievement: true
    },
    'validation-result': {
      title: 'Validation Decision Point',
      description: 'Determines if all validation checks passed or if there are issues that need resolution.',
      keyPoints: [
        'All fields match: Auto-approve path',
        'Discrepancies found: Flag for correction',
        'Missing documents: Route to manual review',
        'Confidence threshold routing',
        'Complete audit trail'
      ]
    },
    'approve-case': {
      title: 'Automated Approval',
      description: 'Case approved for disbursement through BPM web automation with full audit trail.',
      keyPoints: [
        'BPM UI automation',
        'Approval with detailed comments',
        'Instant disbursement trigger',
        'Complete audit trail',
        'Replaced 9 human QA users',
        'Zero manual intervention needed'
      ],
      success: true
    },
    'flag-issues': {
      title: 'Issue Flagging & Routing',
      description: 'Documents with discrepancies are flagged with detailed issue reports and routed to the liaison queue for correction.',
      keyPoints: [
        'Detailed issue reporting',
        'Specific field discrepancies listed',
        'Automatic routing to liaison team',
        'Document correction request',
        'Tracking and follow-up workflow'
      ],
      warning: true
    },
    'manual-review': {
      title: 'Manual Review Queue',
      description: 'Cases with missing documents or complex issues are routed to human reviewers for manual processing.',
      keyPoints: [
        'Missing document scenarios',
        'Complex validation cases',
        'OCR confidence below threshold',
        'Human expert review',
        'Return to automation after correction'
      ],
      warning: true
    },
    'save-database': {
      title: 'Database Persistence',
      description: 'All validation results, processing times, and audit data are saved to the SQLite database for reporting and compliance.',
      keyPoints: [
        'SQLite database storage',
        'Complete audit trail',
        'Processing metrics tracking',
        'Validation result history',
        'Performance analytics',
        'Compliance reporting'
      ]
    },
    'second-queue': {
      title: 'Second Queue Routing',
      description: 'Successfully validated cases are automatically routed to the next stage in the loan processing workflow.',
      keyPoints: [
        'Automatic BPM queue transition',
        'Workflow continuation',
        'Case handoff to disbursement',
        'Status update tracking',
        'Process completion confirmation'
      ]
    },
    'repeat-process': {
      title: 'Continuous Processing',
      description: 'The orchestrator returns to polling for new cases, maintaining continuous 24/7 operation.',
      keyPoints: [
        '24/7 automated processing',
        '400-800 cases per day',
        'Continuous polling cycle',
        'No human intervention required',
        'Self-healing on errors',
        'Production uptime monitoring'
      ]
    }
  };

  const getNodeInfo = (node) => {
    if (!node) return null;

    // If we have a predefined node detail, return it
    if (nodeDetails[node.id]) {
      return nodeDetails[node.id];
    }

    // Only try to access node.data if it exists
    if (node.data) {
      return {
        title: node.data.label,
        description: node.data.description,
        keyPoints: node.data.details || []
      };
    }

    // Fallback if node only has an id
    return {
      title: 'Processing Step',
      description: 'Step details loading...',
      keyPoints: []
    };
  };

  const displayNode = currentStepData ? { id: currentStepData.nodeId } : selectedNode;
  const nodeInfo = displayNode ? getNodeInfo(displayNode) : null;

  return (
    <motion.div
      className="step-details-panel"
      initial={{ x: 300, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      <div className="panel-header">
        <h2>Process Details</h2>
        {currentStepData && (
          <div className="current-step-indicator">
            Step {currentStep + 1} of {currentSequence.length}
          </div>
        )}
      </div>

      {currentStepData && (
        <motion.div
          key={`step-${currentStep}`}
          className="current-step-section"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="step-status">
            <div className="step-status-bar">
              <div
                className="step-status-fill"
                style={{ width: `${((currentStep + 1) / currentSequence.length) * 100}%` }}
              />
            </div>
            <h3 className="step-message">{currentStepData.message}</h3>
          </div>
        </motion.div>
      )}

      <AnimatePresence mode="wait">
        {nodeInfo && (
          <motion.div
            key={displayNode?.id || 'node'}
            className={`node-details-section ${nodeInfo.achievement ? 'achievement' : ''} ${nodeInfo.success ? 'success' : ''} ${nodeInfo.warning ? 'warning' : ''}`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              {nodeInfo.achievement && <Trophy size={20} style={{ color: '#FFD700', flexShrink: 0 }} />}
              {nodeInfo.success && <CheckCircle size={20} style={{ color: '#78be20', flexShrink: 0 }} />}
              {nodeInfo.warning && <AlertTriangle size={20} style={{ color: '#FFA500', flexShrink: 0 }} />}
              <h3 className="node-title" style={{ margin: 0 }}>{nodeInfo.title}</h3>
            </div>
            <p className="node-description">{nodeInfo.description}</p>

            {nodeInfo.keyPoints && nodeInfo.keyPoints.length > 0 && (
              <div className="key-points">
                <h4>Key Features:</h4>
                <ul>
                  {nodeInfo.keyPoints.map((point, i) => (
                    <motion.li
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                    >
                      {point}
                    </motion.li>
                  ))}
                </ul>
              </div>
            )}

            {nodeInfo.achievement && (
              <motion.div
                className="achievement-highlight"
                animate={{ scale: [1, 1.02, 1] }}
                transition={{ repeat: Infinity, duration: 2 }}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}
              >
                <Trophy size={16} />
                <span>Key Achievement</span>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {!currentStepData && !displayNode && (
        <div className="empty-state">
          <p>Start a simulation or click on a node to see details</p>
        </div>
      )}

      <div className="panel-footer">
        <div className="nedbank-branding">
          <span>CBO Quality Verification</span>
          <span className="separator">•</span>
          <span>Nedbank Digital Solutions</span>
        </div>
      </div>
    </motion.div>
  );
};

export default StepDetailsPanel;