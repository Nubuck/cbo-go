import { promises as fs } from 'node:fs';

/**
 * Group and sort bounding boxes by page in reading order
 * Sort order: top to bottom, left to right (like reading text)
 */
async function groupBoxesByPage() {
  console.log('🔄 Reading debug_merged_boxes.json...');
  
  // Read the merged boxes
  const boxesData = await fs.readFile('debug_merged_boxes.json', 'utf8');
  const boxes = JSON.parse(boxesData);
  
  console.log(`📦 Found ${boxes.length} total bounding boxes`);
  
  // Group boxes by pageIndex
  const groupedByPage = {};
  
  for (const box of boxes) {
    const pageIndex = box.pageIndex;
    
    if (!groupedByPage[pageIndex]) {
      groupedByPage[pageIndex] = [];
    }
    
    groupedByPage[pageIndex].push(box);
  }
  
  // Sort each page's boxes in reading order (top to bottom, left to right)
  for (const pageIndex in groupedByPage) {
    const pageBoxes = groupedByPage[pageIndex];
    
    // Sort by reading order: Y coordinate first (top to bottom), then X coordinate (left to right)
    pageBoxes.sort((a, b) => {
      // First sort by Y (top to bottom)
      const yDiff = a.y - b.y;
      
      // If Y coordinates are very close (within 10 pixels), sort by X (left to right)
      if (Math.abs(yDiff) < 10) {
        return a.x - b.x;
      }
      
      return yDiff;
    });
    
    console.log(`📄 Page ${pageIndex}: ${pageBoxes.length} boxes sorted in reading order`);
  }
  
  // Create summary with page info
  const summary = {
    totalBoxes: boxes.length,
    pages: Object.keys(groupedByPage).length,
    pagesInfo: {}
  };
  
  for (const pageIndex in groupedByPage) {
    const pageBoxes = groupedByPage[pageIndex];
    const firstBox = pageBoxes[0];
    
    summary.pagesInfo[pageIndex] = {
      boxCount: pageBoxes.length,
      pageWidth: firstBox?.pageWidth || 'unknown',
      pageHeight: firstBox?.pageHeight || 'unknown'
    };
  }
  
  // Create the final grouped structure
  const result = {
    summary,
    pages: groupedByPage
  };
  
  // Save to file
  await fs.writeFile('debug_boxes_grouped_by_page.json', JSON.stringify(result, null, 2));
  
  console.log('✅ Created debug_boxes_grouped_by_page.json');
  console.log('📊 Summary:');
  console.log(`   Total boxes: ${summary.totalBoxes}`);
  console.log(`   Total pages: ${summary.pages}`);
  
  for (const pageIndex in summary.pagesInfo) {
    const info = summary.pagesInfo[pageIndex];
    console.log(`   Page ${pageIndex}: ${info.boxCount} boxes (${info.pageWidth}x${info.pageHeight})`);
  }
  
  console.log('🎯 Each page contains boxes sorted in reading order (top-to-bottom, left-to-right)');
}

// Run the grouping
groupBoxesByPage().catch(console.error);