const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the React app
app.use(express.static(path.join(__dirname, 'dist')));

// Handle all other routes - send back the React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log('\n========================================');
  console.log('🚀 CBO Quality Verification Dashboard');
  console.log('========================================');
  console.log(`✅ Server is running on port ${PORT}`);
  console.log(`🌐 Open your browser to: http://localhost:${PORT}`);
  console.log('========================================\n');
  console.log('📊 Demo Features:');
  console.log('  • Interactive process flow visualization');
  console.log('  • Three simulation paths (Success/Issues/Missing)');
  console.log('  • Auto-zoom to active nodes');
  console.log('  • Manual step controls');
  console.log('  • Nedbank branded design');
  console.log('\n💡 Presentation Tips:');
  console.log('  • Each step pauses 10-20 seconds for narration');
  console.log('  • Use Prev/Next buttons for manual control');
  console.log('  • Toggle auto-focus on/off as needed');
  console.log('\n🛑 Press Ctrl+C to stop the server');
  console.log('========================================\n');
});