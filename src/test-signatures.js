import { promises as fs } from 'node:fs';
import path from 'path';
import SignatureDetector from './cli/signature-detector.js';
import { pdf as pdfImageExtract } from 'pdf-to-img';
import { DynamicSignatureZones } from './dynamic-signature-zones.js';

/**
 * Test signature detection on both digital and scanned PDFs
 */
async function testSignatureDetection() {
  console.log('🚀 Testing Advanced Signature Detection');
  console.log('═'.repeat(60));

  const detector = new SignatureDetector();
  
  // Test cases
  const testCases = [
    {
      name: 'Digital PDF',
      file: 'test/samples/digital-application.pdf',
      description: 'PDF with digital signatures and form fills'
    },
    {
      name: 'Scanned PDF', 
      file: 'test/samples/scanned-application.pdf',
      description: 'Scanned document with hand-written signatures'
    }
  ];

  // Generate dynamic signature zones using SIGNATURE_INSTRUCTION.md methodology
  console.log('🎯 Generating dynamic signature zones...');
  const zoneCalculator = new DynamicSignatureZones();
  const dynamicZones = await zoneCalculator.generateAllZones();
  const signatureZones = zoneCalculator.convertToTestFormat(dynamicZones);
  
  console.log(`✅ Generated ${signatureZones.length} dynamic signature zones:`);
  signatureZones.forEach(zone => {
    console.log(`   ${zone.name}: (${zone.bounds.x}, ${zone.bounds.y}) ${zone.bounds.width}x${zone.bounds.height}`);
  });

  for (const testCase of testCases) {
    console.log(`\n📋 Testing: ${testCase.name}`);
    console.log(`📄 File: ${testCase.file}`);
    console.log(`📝 Description: ${testCase.description}`);
    console.log('─'.repeat(40));

    try {
      // Extract first page as image
      const filePath = path.resolve(testCase.file);
      console.log(`📂 Attempting to extract from: ${filePath}`);
      
      const scale = 2; // Higher resolution for better detection
      const pdfDocument = await pdfImageExtract(filePath, {
        scale: scale,
        format: 'png'
      });

      console.log(`📊 PDF extraction started, iterating through pages...`);

      // Extract first page from async iterator
      let firstPageBuffer = null;
      let pageIndex = 0;
      for await (const pageBuffer of pdfDocument) {
        firstPageBuffer = pageBuffer;
        console.log(`✅ Extracted first page (${pageBuffer ? pageBuffer.length : 'no buffer'} bytes)`);
        
        // Write source page image to disk for debugging
        const sourceFileName = `debug_source_page${pageIndex}_${testCase.name.toLowerCase().replace(' ', '_')}.png`;
        await fs.writeFile(sourceFileName, pageBuffer);
        console.log(`💾 Saved source page image: ${sourceFileName}`);
        
        break; // Only need first page
      }

      if (!firstPageBuffer) {
        console.error(`❌ Failed to extract first page from ${testCase.file}`);
        continue;
      }
      
      console.log(`✅ Extracted first page (${firstPageBuffer ? firstPageBuffer.length : 'no buffer'} bytes)`);

      // Run signature detection with scale factor
      const results = await detector.detectSignatureMarks(firstPageBuffer, signatureZones, scale);
      
      // Display results
      console.log(`\n🎯 Signature Detection Results for ${testCase.name}:`);
      
      for (const result of results) {
        const status = result.hasVisualMark ? '✅ MARK DETECTED' : '❌ NO MARK';
        const confidence = Math.round(result.confidence * 100);
        
        console.log(`\n  ${status} - ${result.field}`);
        console.log(`    Confidence: ${confidence}%`);
        console.log(`    Zone: (${result.zone.x}, ${result.zone.y}) ${result.zone.width}x${result.zone.height}`);
        
        if (result.edgeAnalysis) {
          console.log(`    Edge Analysis:`);
          console.log(`      Fine edges: ${(result.edgeAnalysis.fineEdgeDensity * 100).toFixed(2)}%`);
          console.log(`      Medium edges: ${(result.edgeAnalysis.mediumEdgeDensity * 100).toFixed(2)}%`);
          console.log(`      Coarse edges: ${(result.edgeAnalysis.coarseEdgeDensity * 100).toFixed(2)}%`);
          console.log(`      Total edge pixels: ${result.edgeAnalysis.totalEdgePixels}`);
        }
        
        if (result.textureAnalysis) {
          console.log(`    Texture Analysis:`);
          console.log(`      Laplacian variance: ${result.textureAnalysis.laplacianVariance}`);
          console.log(`      Has texture: ${result.textureAnalysis.hasTextureContent}`);
        }
        
        if (result.error) {
          console.log(`    Error: ${result.error}`);
        }
      }

      // Summary
      const detectedMarks = results.filter(r => r.hasVisualMark).length;
      const totalZones = results.length;
      console.log(`\n📊 Summary for ${testCase.name}:`);
      console.log(`   Marks detected: ${detectedMarks}/${totalZones} zones`);
      console.log(`   Detection rate: ${Math.round((detectedMarks / totalZones) * 100)}%`);

    } catch (error) {
      console.error(`❌ Test failed for ${testCase.name}:`, error.message);
    }
  }

  console.log('\n🔧 Debug images saved with prefix: debug_signature_*');
  console.log('📁 Check the current directory for ROI extraction images');
  console.log('\n✨ Test complete! Use results to refine signature zone coordinates.');
}

// Run the test
testSignatureDetection().catch(console.error);