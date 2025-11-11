import React from 'react';
import { Handle, Position } from 'reactflow';
import { motion } from 'framer-motion';
import * as Icons from 'lucide-react';

const SystemNode = ({ data, selected }) => {
  const IconComponent = Icons[data.icon];

  return (
    <motion.div
      className="system-node"
      whileHover={{ scale: 1.05 }}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      style={{
        border: selected ? '3px solid #4a90e2' : '2px solid #4a90e2',
        boxShadow: selected ? '0 0 30px rgba(74,144,226,0.5)' : '0 4px 20px rgba(74,144,226,0.3)'
      }}
    >
      <Handle type="target" position={Position.Top} />

      <div className="system-header">
        <span className="system-icon">
          {IconComponent ? <IconComponent size={28} /> : data.icon}
        </span>
        <h3>{data.label}</h3>
        {data.stats?.active && (
          <motion.div
            className="active-indicator"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ repeat: Infinity, duration: 1.5 }}
          />
        )}
      </div>

      <p className="system-description">{data.description}</p>

      {data.systems && (
        <div className="connected-systems">
          {data.systems.map((system, i) => (
            <span key={i} className="system-tag">{system}</span>
          ))}
        </div>
      )}

      {data.stats && (
        <div className="system-stats">
          {data.stats.load && (
            <div className="load-bar">
              <div className="load-fill" style={{ width: data.stats.load }} />
              <span>{data.stats.load}</span>
            </div>
          )}
          {data.stats.efficiency && (
            <div className="efficiency">
              Efficiency: {data.stats.efficiency}
            </div>
          )}
          {data.stats.active && typeof data.stats.active === 'number' && (
            <div className="active-count">
              Active: {data.stats.active}
            </div>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} />
    </motion.div>
  );
};

export default SystemNode;