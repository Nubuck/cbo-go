import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

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
        'Monitors process completion'
      ]
    },
    'bpm-query': {
      title: 'IBM BPM Integration',
      description: 'Retrieves loan cases from the CBO Quality Verification queue for processing.',
      keyPoints: [
        'Personal Loans',
        'Credit Cards & Limit Increases',
        'Overdrafts & Limit Increases',
        'Real-time case retrieval'
      ]
    },
    'retrieve-docs': {
      title: 'Document Retrieval',
      description: 'Queries the ECM document server to gather all required documents for validation.',
      keyPoints: [
        'PAQ (Pre-Agreement Quote)',
        'Application Documents',
        'Bank Statements',
        'Insurance Documents (if applicable)'
      ]
    },
    'extract-data': {
      title: '100% Accurate Data Extraction',
      description: 'Our breakthrough technology extracts data from PDFs with perfect accuracy on digital documents.',
      keyPoints: [
        '100% accuracy on digital PDFs',
        'Spatial search algorithm',
        'OCR for scanned documents',
        'Coordinate-based extraction'
      ],
      achievement: true
    },
    'validate-fields': {
      title: 'Field Validation Engine',
      description: 'Validates all critical fields using our proprietary spatial validation algorithm.',
      keyPoints: [
        'Case ID verification',
        'Loan amount validation',
        'Interest rate checking',
        'Insurance premium verification',
        'Staff discount logic',
        '0.3 second processing time'
      ],
      achievement: true
    },
    'approve-case': {
      title: 'Automated Approval',
      description: 'Case approved for disbursement through web automation.',
      keyPoints: [
        'BPM UI automation',
        'Approval with audit comments',
        'Instant disbursement trigger',
        'Complete audit trail'
      ],
      success: true
    },
    'flag-issues': {
      title: 'Issue Resolution',
      description: 'Documents flagged for correction and routed to liaison queue.',
      keyPoints: [
        'Detailed issue reporting',
        'Automatic routing',
        'Document correction request',
        'Tracking and follow-up'
      ],
      warning: true
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
            <h3 className="node-title">{nodeInfo.title}</h3>
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
              >
                🏆 Key Achievement
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