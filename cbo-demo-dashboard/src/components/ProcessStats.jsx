import React from 'react';
import { motion } from 'framer-motion';

const ProcessStats = ({ metrics }) => {
  return (
    <motion.div
      className="process-stats"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.3 }}
    >
      <div className="stat-item">
        <motion.div
          className="stat-number"
          key={metrics.casesProcessed}
          initial={{ scale: 1.2 }}
          animate={{ scale: 1 }}
        >
          {metrics.casesProcessed}
        </motion.div>
        <div className="stat-label">Cases Today</div>
      </div>

      <div className="stat-item">
        <motion.div
          className="stat-number success"
          key={metrics.successRate}
          initial={{ scale: 1.2 }}
          animate={{ scale: 1 }}
        >
          {metrics.successRate.toFixed(1)}%
        </motion.div>
        <div className="stat-label">Success Rate</div>
      </div>

      <div className="stat-item">
        <motion.div
          className="stat-number"
          key={metrics.avgProcessTime}
          initial={{ scale: 1.2 }}
          animate={{ scale: 1 }}
        >
          {metrics.avgProcessTime.toFixed(1)}m
        </motion.div>
        <div className="stat-label">Avg Process Time</div>
      </div>

      <div className="stat-item">
        <div className="agent-status">
          {[...Array(5)].map((_, i) => (
            <motion.div
              key={i}
              className={`agent-dot ${i < metrics.activeAgents ? 'active' : ''}`}
              animate={{
                scale: i < metrics.activeAgents ? [1, 1.2, 1] : 1,
                opacity: i < metrics.activeAgents ? 1 : 0.3
              }}
              transition={{ repeat: Infinity, duration: 2, delay: i * 0.2 }}
            />
          ))}
        </div>
        <div className="stat-label">Active Bots</div>
      </div>

      <div className="live-indicator">
        <motion.div
          className="live-dot"
          animate={{ opacity: [0, 1, 0] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
        />
        LIVE
      </div>
    </motion.div>
  );
};

export default ProcessStats;