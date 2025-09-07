#!/usr/bin/env node

import cv from '@techstark/opencv-js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Wait for OpenCV to be ready
function waitForOpencv(timeout = 10000) {
  return new Promise((resolve, reject) => {
    let elapsed = 0;
    const interval = 100;
    
    const checkReady = () => {
      if (cv.Mat && typeof cv.Mat === 'function') {
        resolve();
      } else if (elapsed >= timeout) {
        reject(new Error('OpenCV initialization timeout'));
      } else {
        elapsed += interval;
        setTimeout(checkReady, interval);
      }
    };
    
    checkReady();
  });
}

/**
 * SA ID Document Detection System
 * Detects and crops ID documents from scanned images using OpenCV
 */
class IDDocumentDetector {
  constructor() {
    this.debug = true;
    this.initialized = false;
  }

  async initialize() {
    if (!this.initialized) {
      console.log('🔧 Initializing OpenCV...');
      await waitForOpencv();
      this.initialized = true;
      console.log('✅ OpenCV ready');
    }
  }

  /**
   * Main detection function
   * @param {string} imagePath - Path to the image file
   * @returns {Promise<Array>} Array of detected documents with metadata
   */
  async detectIDDocuments(imagePath) {
    console.log(`🔍 Analyzing image: ${path.basename(imagePath)}`);
    
    await this.initialize(); // Ensure OpenCV is ready
    
    try {
      // Load image using Sharp and convert to format OpenCV WASM can handle
      const { data, info } = await sharp(imagePath)
        .raw()
        .toBuffer({ resolveWithObject: true });
      
      console.log(`📐 Image info: ${info.width}x${info.height}, channels: ${info.channels}`);
      
      // Create OpenCV Mat from raw pixel data
      let mat;
      if (info.channels === 3) {
        mat = cv.matFromArray(info.height, info.width, cv.CV_8UC3, Array.from(data));
      } else {
        mat = cv.matFromArray(info.height, info.width, cv.CV_8UC1, Array.from(data));
      }

      console.log(`📐 OpenCV Mat dimensions: ${mat.cols}x${mat.rows}`);
      
      // Detect rectangular documents
      const documents = await this.findDocumentRectangles(mat);
      
      // Classify and enhance detected documents
      const results = [];
      for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        const classification = this.classifyIDDocument(doc);
        
        console.log(`📄 Document ${i + 1}:`);
        console.log(`   📐 Dimensions: ${doc.width}x${doc.height}`);
        console.log(`   📏 Ratio: ${doc.ratio.toFixed(2)}`);
        console.log(`   🔄 Rotation: ${doc.rotation.toFixed(1)}°`);
        console.log(`   📋 Type: ${classification.type}`);
        console.log(`   🎯 Confidence: ${classification.confidence}%`);
        
        results.push({
          ...doc,
          classification,
          index: i + 1
        });
      }
      
      // Cleanup
      mat.delete();
      
      return results;
      
    } catch (error) {
      console.error('❌ Detection error:', error.message);
      throw error;
    }
  }

  /**
   * Find rectangular document shapes in the image
   * @param {cv.Mat} mat - OpenCV image matrix
   * @returns {Array} Array of detected rectangles with metadata
   */
  async findDocumentRectangles(mat) {
    console.log('🔎 Finding document rectangles...');
    
    // Convert to grayscale
    const gray = new cv.Mat();
    cv.cvtColor(mat, gray, cv.COLOR_BGR2GRAY);
    
    // Apply Gaussian blur to reduce noise
    const blurred = new cv.Mat();
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    
    // Edge detection using Canny
    const edges = new cv.Mat();
    cv.Canny(blurred, edges, 50, 150);
    
    // Find contours
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    
    console.log(`🔍 Found ${contours.size()} contours`);
    
    const documents = [];
    const imageArea = mat.rows * mat.cols;
    const minArea = imageArea * 0.001; // Minimum 0.1% of image area (much more sensitive)
    const maxArea = imageArea * 0.6;   // Maximum 60% of image area
    
    // Analyze each contour
    let potentialContours = 0;
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      
      // Debug: Track contours that pass area filter
      if (area >= minArea && area <= maxArea) {
        potentialContours++;
      }
      
      // Filter by area
      if (area < minArea || area > maxArea) {
        continue;
      }
      
      // Get bounding rectangle
      const rect = cv.boundingRect(contour);
      const ratio = rect.width / rect.height;
      
      // Filter by aspect ratio (ID documents are typically rectangular)
      // Allow wider range to catch rotated documents
      if (ratio < 0.5 || ratio > 3.0) {
        continue;
      }
      
      // Calculate rotation angle using minimum area rectangle
      const rotatedRect = cv.minAreaRect(contour);
      let rotation = rotatedRect.angle;
      
      // Adjust rotation to be between -45 and 45 degrees
      if (rotation < -45) {
        rotation += 90;
      }
      
      // Extract the document region
      const documentMat = mat.roi(rect);
      
      documents.push({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        area: area,
        ratio: ratio,
        rotation: rotation,
        contour: contour,
        documentMat: documentMat,
        confidence: this.calculateDetectionConfidence(area, ratio, rotation)
      });
      
      console.log(`📄 Potential document found: ${rect.width}x${rect.height}, ratio: ${ratio.toFixed(2)}, rotation: ${rotation.toFixed(1)}°`);
    }
    
    // Sort by confidence (highest first)
    documents.sort((a, b) => b.confidence - a.confidence);
    
    // Debug information
    console.log(`📊 Contour analysis: ${potentialContours} passed area filter, ${documents.length} passed all filters`);
    console.log(`📏 Area range: ${minArea.toFixed(0)} - ${maxArea.toFixed(0)} pixels`);
    
    // Cleanup
    gray.delete();
    blurred.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
    
    console.log(`✅ Found ${documents.length} potential ID documents`);
    return documents;
  }

  /**
   * Calculate detection confidence based on document characteristics
   * @param {number} area - Document area
   * @param {number} ratio - Width/height ratio
   * @param {number} rotation - Rotation angle
   * @returns {number} Confidence score 0-100
   */
  calculateDetectionConfidence(area, ratio, rotation) {
    let confidence = 50; // Base confidence
    
    // Boost confidence for ideal aspect ratios
    if (ratio >= 1.4 && ratio <= 1.8) {
      confidence += 30; // SA ID book/card typical ratios
    } else if (ratio >= 1.2 && ratio <= 2.0) {
      confidence += 15; // Acceptable ratios
    }
    
    // Boost confidence for minimal rotation
    if (Math.abs(rotation) < 5) {
      confidence += 15;
    } else if (Math.abs(rotation) < 15) {
      confidence += 8;
    }
    
    // Boost confidence for reasonable size
    confidence += Math.min(20, area / 10000); // Area bonus up to 20 points
    
    return Math.min(100, Math.max(0, confidence));
  }

  /**
   * Classify detected document as SA ID Book or Smart Card
   * @param {Object} doc - Detected document object
   * @returns {Object} Classification with type and confidence
   */
  classifyIDDocument(doc) {
    const { ratio, width, height, area } = doc;
    
    let type = 'Unknown';
    let confidence = 0;
    let characteristics = [];
    
    // Handle rotated documents by normalizing ratio
    const normalizedRatio = ratio > 1 ? ratio : 1 / ratio;
    
    // SA ID Book characteristics (more flexible - LOWERED THRESHOLDS)
    if (normalizedRatio >= 1.2 && normalizedRatio <= 2.2 && area > 30000) { // More flexible ratio and size
      if (normalizedRatio >= 1.3 && normalizedRatio <= 1.9) { // Wider range
        type = 'SA ID Book';
        confidence = 80; // Reduced from 85
        characteristics.push('Good ID Book ratio', 'Good size');
      } else {
        type = 'SA ID Book (possible)';
        confidence = 60; // Reduced from 70
        characteristics.push('ID Book-like ratio', 'Reasonable size');
      }
    }
    
    // SA Smart Card characteristics (smaller documents) - LOWERED THRESHOLDS
    else if (normalizedRatio >= 1.3 && normalizedRatio <= 1.9 && area > 8000 && area < 250000) { // More flexible
      type = 'SA Smart Card';
      confidence = 65; // Reduced from 75
      characteristics.push('Smart Card ratio', 'Card-like size');
    }
    
    // Generic rectangular document - LOWERED THRESHOLD
    else if (normalizedRatio >= 1.1 && normalizedRatio <= 3.0) { // Much more flexible
      type = 'Document';
      confidence = 40; // Reduced from 50
      characteristics.push('Document-like ratio');
      
      // Special case: very rectangular might be ID-like
      if (normalizedRatio >= 1.4 && normalizedRatio <= 1.7 && area > 15000) {
        type = 'Possible ID Document';
        confidence = 55;
        characteristics.push('ID-like rectangular shape');
      }
    }
    
    return {
      type,
      confidence,
      characteristics
    };
  }

  /**
   * Save detected document as separate image for analysis
   * @param {Object} doc - Document object with OpenCV Mat
   * @param {string} outputDir - Output directory
   * @param {string} basename - Base filename
   * @param {number} index - Document index
   */
  async saveDetectedDocument(doc, outputDir, basename, index) {
    try {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      // Extract the detected document region
      const roi = doc.documentMat;
      
      // Convert Mat to Buffer using Sharp
      const width = roi.cols;
      const height = roi.rows;
      const channels = roi.channels();
      
      // Get raw pixel data from Mat
      let rawData;
      if (channels === 3) {
        // BGR to RGB conversion for 3-channel images
        const rgbMat = new cv.Mat();
        cv.cvtColor(roi, rgbMat, cv.COLOR_BGR2RGB);
        rawData = new Uint8Array(rgbMat.data);
        rgbMat.delete();
      } else {
        rawData = new Uint8Array(roi.data);
      }
      
      // Create filename with document type and confidence (PNG format)
      const safeType = doc.classification.type.replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `${basename}_detected_${index}_${safeType}_${doc.classification.confidence}pct.png`;
      const filepath = path.join(outputDir, filename);
      
      // Save using Sharp
      await sharp(rawData, {
        raw: {
          width: width,
          height: height,
          channels: channels
        }
      })
      .png({ compressionLevel: 6 })
      .toFile(filepath);
      
      console.log(`💾 Saved detected document: ${filename}`);
      console.log(`   📐 Size: ${width}x${height}, Type: ${doc.classification.type}, Confidence: ${doc.classification.confidence}%`);
      
      return filepath;
    } catch (error) {
      console.error('❌ Error saving detected document:', error.message);
      return null;
    }
  }
}

// Test function to analyze our sample images
async function testIDDetection() {
  console.log('🚀 Testing ID Document Detection System');
  console.log('='.repeat(50));
  
  const detector = new IDDocumentDetector();
  
  // Test images (updated for new case-based structure)
  const testImages = [
    'pdf-images/104739204/LETTER NEDBANK/page3.jpg',
    'pdf-images/104739204/LETTER NEDBANK/page4.jpg'
  ];
  
  for (const imagePath of testImages) {
    const fullPath = path.join(__dirname, imagePath);
    
    if (!fs.existsSync(fullPath)) {
      console.log(`⚠️  Image not found: ${fullPath}`);
      continue;
    }
    
    try {
      console.log(`\n📸 Testing: ${imagePath}`);
      console.log('-'.repeat(40));
      
      const results = await detector.detectIDDocuments(fullPath);
      
      if (results.length === 0) {
        console.log('❌ No ID documents detected');
      } else {
        console.log(`✅ Detected ${results.length} potential ID document(s):`);
        results.forEach((doc, i) => {
          console.log(`\n   📄 Document ${doc.index}:`);
          console.log(`      🏷️  Type: ${doc.classification.type}`);
          console.log(`      🎯 Confidence: ${doc.classification.confidence}%`);
          console.log(`      📐 Size: ${doc.width}x${doc.height} (ratio: ${doc.ratio.toFixed(2)})`);
          console.log(`      🔄 Rotation: ${doc.rotation.toFixed(1)}°`);
          console.log(`      ✨ Features: ${doc.classification.characteristics.join(', ')}`);
        });
      }
      
    } catch (error) {
      console.error(`❌ Error processing ${imagePath}:`, error.message);
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('✅ ID Detection Test Complete!');
}

// Run tests if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  testIDDetection().catch(console.error);
}

export default IDDocumentDetector;

// v 1.12