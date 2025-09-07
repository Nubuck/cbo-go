import { promises as fs } from 'node:fs';
import Fuse from 'fuse.js';

/**
 * Dynamic Signature Zone Calculator
 * Implements the SIGNATURE_INSTRUCTION.md methodology
 * Uses landmark boxes to calculate signature areas dynamically
 */
export class DynamicSignatureZones {
  constructor() {
    this.groupedBoxes = null;
    this.fuseOptions = {
      keys: ['text'],
      threshold: 0.6, // Allow some fuzzy matching
      distance: 100,
      includeScore: true
    };
  }

  /**
   * Load grouped bounding boxes
   */
  async loadGroupedBoxes() {
    if (this.groupedBoxes) return;
    
    console.log('📦 Loading debug_boxes_grouped_by_page.json...');
    const data = await fs.readFile('debug_boxes_grouped_by_page.json', 'utf8');
    this.groupedBoxes = JSON.parse(data);
    console.log(`✅ Loaded ${this.groupedBoxes.summary.totalBoxes} boxes across ${this.groupedBoxes.summary.pages} pages`);
  }

  /**
   * Find a box using fuzzy search with optional proximity filter
   */
  findBox(pageBoxes, searchText, proximityText = null, proximityDistance = 100) {
    const fuse = new Fuse(pageBoxes, this.fuseOptions);
    const results = fuse.search(searchText);
    
    if (results.length === 0) {
      console.warn(`⚠️  No matches found for "${searchText}"`);
      return null;
    }

    // If proximity text specified, filter by proximity
    if (proximityText) {
      const proximityResults = results.filter(result => {
        const box = result.item;
        // Check if proximityText exists in nearby boxes
        const nearbyBoxes = pageBoxes.filter(nearbyBox => {
          const distance = Math.sqrt(
            Math.pow(box.x - nearbyBox.x, 2) + 
            Math.pow(box.y - nearbyBox.y, 2)
          );
          return distance <= proximityDistance;
        });
        
        return nearbyBoxes.some(nearbyBox => 
          nearbyBox.text.toLowerCase().includes(proximityText.toLowerCase())
        );
      });
      
      if (proximityResults.length > 0) {
        console.log(`🎯 Found "${searchText}" with proximity to "${proximityText}"`);
        return proximityResults[0].item;
      }
    }
    
    console.log(`🎯 Found "${searchText}" (score: ${results[0].score.toFixed(3)})`);
    return results[0].item;
  }

  /**
   * Calculate client initial signature zone for pages 0-4
   * Based on SIGNATURE_INSTRUCTION.md methodology
   */
  calculateClientInitialZone(pageIndex) {
    if (pageIndex > 4) return null; // Initials only on pages 0-4
    
    const pageBoxes = this.groupedBoxes.pages[pageIndex.toString()];
    if (!pageBoxes) {
      console.warn(`⚠️  No boxes found for page ${pageIndex}`);
      return null;
    }

    console.log(`📄 Calculating client initial zone for page ${pageIndex}...`);

    // Step 1: Find "Case reference no" box (top-left anchor)
    const caseRefBox = this.findBox(pageBoxes, "Case reference no");
    if (!caseRefBox) {
      console.error(`❌ Could not find "Case reference no" on page ${pageIndex}`);
      return null;
    }

    // Step 2: Find "Client initial" box (bottom boundary)
    const clientInitialBox = this.findBox(pageBoxes, "Client initial");
    if (!clientInitialBox) {
      console.error(`❌ Could not find "Client initial" on page ${pageIndex}`);
      return null;
    }

    // Step 3: Find "Merchant/Consultant no" box (right boundary)
    const merchantBox = this.findBox(pageBoxes, "Merchant/Consultant no");
    if (!merchantBox) {
      console.error(`❌ Could not find "Merchant/Consultant no" on page ${pageIndex}`);
      return null;
    }

    // Step 4: Calculate signature zone using SIGNATURE_INSTRUCTION.md formula
    const zone = {
      x: Math.round(caseRefBox.x),
      y: Math.round(caseRefBox.y),
      width: Math.round(merchantBox.x - caseRefBox.x),
      height: Math.round((clientInitialBox.y + clientInitialBox.height) - caseRefBox.y)
    };

    console.log(`✅ Calculated initial zone for page ${pageIndex}:`, zone);
    console.log(`   Reference boxes used:`);
    console.log(`   - Case ref: (${caseRefBox.x}, ${caseRefBox.y})`);
    console.log(`   - Client initial: (${clientInitialBox.x}, ${clientInitialBox.y})`);
    console.log(`   - Merchant: (${merchantBox.x}, ${merchantBox.y})`);

    return {
      name: `clientInitial_page${pageIndex}`,
      bounds: zone,
      type: 'initial',
      pageIndex: pageIndex,
      description: `Client initial zone for page ${pageIndex} (dynamic calculation)`
    };
  }

  /**
   * Calculate client signature zone for final page
   * Based on SIGNATURE_INSTRUCTION.md methodology
   */
  calculateClientSignatureZone() {
    // Find the last page with content
    const pageIndices = Object.keys(this.groupedBoxes.pages).map(Number).sort((a, b) => b - a);
    
    for (const pageIndex of pageIndices) {
      const pageBoxes = this.groupedBoxes.pages[pageIndex.toString()];
      
      console.log(`📄 Looking for client signature on page ${pageIndex}...`);

      // Find "Client Signature" box with proximity to "Place"
      const signatureBox = this.findBox(pageBoxes, "Client Signature", "Place", 200);
      
      if (signatureBox) {
        const pageWidth = signatureBox.pageWidth;
        const pageHeight = signatureBox.pageHeight;
        
        // Calculate zone using SIGNATURE_INSTRUCTION.md formula
        const zone = {
          x: Math.round(signatureBox.x),
          y: Math.round(signatureBox.y + signatureBox.height + 10), // Add small offset below text
          width: Math.round(pageWidth / 2), // Half page width
          height: Math.round(pageHeight * 0.12) // 12% of page height
        };

        console.log(`✅ Calculated signature zone for page ${pageIndex}:`, zone);
        console.log(`   Page dimensions: ${pageWidth}x${pageHeight}`);
        console.log(`   Signature box: (${signatureBox.x}, ${signatureBox.y})`);

        return {
          name: `clientSignature_page${pageIndex}`,
          bounds: zone,
          type: 'signature',
          pageIndex: pageIndex,
          description: `Client signature zone for page ${pageIndex} (dynamic calculation)`
        };
      }
    }

    console.error(`❌ Could not find "Client Signature" with proximity to "Place" on any page`);
    return null;
  }

  /**
   * Generate all signature zones for a document
   */
  async generateAllZones() {
    await this.loadGroupedBoxes();
    
    const zones = [];
    
    console.log('🎯 Generating dynamic signature zones...');
    
    // Generate client initial zones for pages 0-4
    for (let pageIndex = 0; pageIndex <= 4; pageIndex++) {
      const initialZone = this.calculateClientInitialZone(pageIndex);
      if (initialZone) {
        zones.push(initialZone);
      }
    }
    
    // Generate client signature zone for final page
    const signatureZone = this.calculateClientSignatureZone();
    if (signatureZone) {
      zones.push(signatureZone);
    }
    
    console.log(`🎉 Generated ${zones.length} dynamic signature zones`);
    
    return zones;
  }

  /**
   * Convert zones to test-signatures.js format
   */
  convertToTestFormat(zones) {
    return zones.map(zone => ({
      name: zone.name,
      bounds: zone.bounds,
      type: zone.type,
      description: zone.description
    }));
  }
}

/**
 * CLI tool to test dynamic signature zone calculation
 */
async function testDynamicZones() {
  try {
    const calculator = new DynamicSignatureZones();
    const zones = await calculator.generateAllZones();
    
    // Save zones for inspection
    await fs.writeFile('dynamic_signature_zones.json', JSON.stringify(zones, null, 2));
    console.log('💾 Saved zones to dynamic_signature_zones.json');
    
    // Convert to test format
    const testZones = calculator.convertToTestFormat(zones);
    console.log('\n📋 Test format zones:');
    console.log(JSON.stringify(testZones, null, 2));
    
  } catch (error) {
    console.error('❌ Error generating dynamic zones:', error);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testDynamicZones();
}