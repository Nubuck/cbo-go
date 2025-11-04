import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const MetricsPanel = ({ selectedNode }) => {
  const systemMetrics = {
    'Digital PDF Processing': {
      accuracy: '100%',
      speed: '0.3s avg',
      volume: '300-500/day',
      status: 'Operational'
    },
    'OCR Processing': {
      accuracy: '82% current',
      speed: '2.1s avg',
      volume: '100-300/day',
      status: 'Improving'
    },
    'Field Validation': {
      'Case ID': '100%',
      'Loan Amount': '100%',
      'Interest Rate': '100%',
      'Insurance Premium': '100%',
      'Instalment': '100%',
      'Account Number': '100%'
    }
  };

  return (
    <motion.div
      className="metrics-panel"
      initial={{ x: 300, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      <h2>System Metrics</h2>

      <div className="metric-section">
        <h3>🎯 Key Achievements</h3>
        <div className="achievement-grid">
          <div className="achievement">
            <span className="achievement-value">100%</span>
            <span className="achievement-label">Digital PDF Accuracy</span>
          </div>
          <div className="achievement">
            <span className="achievement-value">9→0</span>
            <span className="achievement-label">Manual QA Replaced</span>
          </div>
          <div className="achievement">
            <span className="achievement-value">800</span>
            <span className="achievement-label">Cases/Day Capacity</span>
          </div>
        </div>
      </div>

      <div className="metric-section">
        <h3>📊 Processing Statistics</h3>
        <div className="stat-bars">
          {Object.entries(systemMetrics['Field Validation']).map(([field, accuracy]) => (
            <div key={field} className="stat-bar">
              <span className="stat-label">{field}</span>
              <div className="bar-container">
                <motion.div
                  className="bar-fill success"
                  initial={{ width: 0 }}
                  animate={{ width: accuracy }}
                  transition={{ duration: 1, delay: 0.2 }}
                />
                <span className="stat-value">{accuracy}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {selectedNode && (
          <motion.div
            className="node-info"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <h3>📍 Selected: {selectedNode.data.label}</h3>
            <p>{selectedNode.data.description}</p>
            {selectedNode.data.details && (
              <ul>
                {selectedNode.data.details.map((detail, i) => (
                  <li key={i}>{detail}</li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="metric-section">
        <h3>🚀 Business Impact</h3>
        <div className="impact-cards">
          <div className="impact-card">
            <span className="impact-icon">⏱️</span>
            <span className="impact-text">3-5 min per valid case</span>
          </div>
          <div className="impact-card">
            <span className="impact-icon">📈</span>
            <span className="impact-text">10x throughput increase</span>
          </div>
          <div className="impact-card">
            <span className="impact-icon">💰</span>
            <span className="impact-text">R2M+ annual savings</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default MetricsPanel;