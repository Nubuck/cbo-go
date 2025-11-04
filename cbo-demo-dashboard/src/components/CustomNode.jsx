import React from 'react';
import { Handle, Position } from 'reactflow';
import { motion } from 'framer-motion';

const CustomNode = ({ data, selected }) => {
  return (
    <motion.div
      className={`custom-node ${data.success ? 'success' : ''} ${data.warning ? 'warning' : ''} ${data.rare ? 'rare' : ''}`}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      style={{
        border: selected ? '3px solid #00ff88' : '2px solid rgba(255,255,255,0.3)',
        boxShadow: selected ? '0 0 30px rgba(0,255,136,0.5)' : '0 4px 20px rgba(0,0,0,0.3)'
      }}
    >
      <Handle type="target" position={Position.Top} />

      <div className="node-header">
        <span className="node-icon">{data.icon}</span>
        <h3>{data.label}</h3>
      </div>

      <p className="node-description">{data.description}</p>

      {data.details && (
        <ul className="node-details">
          {data.details.map((detail, i) => (
            <li key={i}>{detail}</li>
          ))}
        </ul>
      )}

      {data.metrics && (
        <div className="node-metrics">
          {Object.entries(data.metrics).map(([key, value]) => (
            <div key={key} className="metric">
              <span className="metric-label">{key}:</span>
              <span className="metric-value">{value}</span>
            </div>
          ))}
        </div>
      )}

      {data.breakthrough && (
        <motion.div
          className="breakthrough-badge"
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ repeat: Infinity, duration: 2 }}
        >
          {data.breakthrough}
        </motion.div>
      )}

      <Handle type="source" position={Position.Bottom} />
    </motion.div>
  );
};

export default CustomNode;