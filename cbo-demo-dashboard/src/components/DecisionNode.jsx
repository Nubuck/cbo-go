import React from 'react';
import { Handle, Position } from 'reactflow';
import { motion } from 'framer-motion';

const DecisionNode = ({ data, selected }) => {
  return (
    <motion.div
      className="decision-node"
      whileHover={{ scale: 1.05 }}
      initial={{ opacity: 0, scale: 0.5, rotate: -45 }}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      transition={{ duration: 0.4, type: 'spring' }}
      style={{
        border: selected ? '3px solid #f5a623' : '2px solid #f5a623',
        boxShadow: selected ? '0 0 30px rgba(245,166,35,0.5)' : '0 4px 20px rgba(245,166,35,0.3)'
      }}
    >
      <Handle type="target" position={Position.Top} />

      <div className="decision-header">
        <span className="decision-icon">{data.icon}</span>
        <h3>{data.label}</h3>
      </div>

      <p className="decision-description">{data.description}</p>

      {data.options && (
        <div className="decision-options">
          {data.options.map((option, i) => (
            <motion.div
              key={i}
              className="option"
              whileHover={{ x: 5 }}
              transition={{ type: 'spring', stiffness: 300 }}
            >
              {option}
            </motion.div>
          ))}
        </div>
      )}

      {data.breakthrough && (
        <motion.div
          className="breakthrough-banner"
          animate={{
            backgroundPosition: ['0% 50%', '100% 50%', '0% 50%']
          }}
          transition={{ repeat: Infinity, duration: 3 }}
        >
          🎯 {data.breakthrough}
        </motion.div>
      )}

      <Handle type="source" position={Position.Bottom} />
      <Handle type="source" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Right} id="right" />
    </motion.div>
  );
};

export default DecisionNode;