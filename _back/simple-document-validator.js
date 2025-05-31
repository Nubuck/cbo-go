import { pdf as pdfImageExtract } from "pdf-to-img";
import { PDFExtract } from "pdf.js-extract";
import { createOCREngine } from "tesseract-wasm";
import { loadWasmBinary } from "tesseract-wasm/node";
import { fuzzy } from "fast-fuzzy";
import sharp from "sharp";
import { promises as fs } from "node:fs";
import path from "path";

class SimpleDocumentValidator {
  constructor() {
    this.ocrEngine = null;
    this.pdfExtract = new PDFExtract();
    
    // Simple field definitions - exactly what we need to validate
    this.requiredFields = {
      caseId: {
        labels: ["Quote ref number", "Quote ref", "Case reference no"],
        type: "reference",
        required: true
      },
      loanAmount: {
        labels: ["Payout amount", "Credit advanced", "Loan Amount"],
        type: "currency", 
        required: true
      },
      instalment: {
        labels: ["Monthly instalment", "instalment", "Monthly Payment"],
        type: "currency",
        required: true
      },
      interestRate: {
        labels: ["Annual interest rate", "Interest Rate"],
        type: "percentage",
        required: true
      },
      insurancePremium: {
        labels: ["Credit life insurance", "Insurance Premium"],
        type: "currency",
        required: true
      },
      collectionAccountNo: {
        labels: ["Account number", "Account No"],
        type: "account",
        required: true
      }
    };

    // Simple tolerances
    this.tolerances = {
      currency: 0.05, // 5 cents
      percentage: 0.01, // 0.01%
      reference: 0, // Exact match
      account: 1 // Allow 1 character difference for OCR
    };
  }

  async initialize(modelPath) {
    const wasmBinary = await loadWasmBinary();
    this.ocrEngine = await createOCREngine({ wasmBinary });
    
    const model = await fs.readFile(modelPath);
    this.ocrEngine.loadModel(model);
    
    console.log("✅ Simple validator initialized");
  }

  async validateDocument(filePath, caseModel) {
    console.log(`🔍 Validating: ${path.basename(filePath)}`);
    
    try {
      // Step 1: Check if it's a digital PDF first
      const pdfData = await this.pdfExtract.extract(filePath);
      const isDigital = this.hasValidText(pdfData);
      
      console.log(`📄 Document type: ${isDigital ? 'Digital' : 'Scanned'}`);
      
      if (isDigital) {
        return await this.validateDigitalPDF(pdfData, caseModel);
      } else {
        return await this.validateScannedPDF(filePath, caseModel);
      }
      
    } catch (error) {
      console.error("❌ Validation failed:", error.message);
      return this.createFailureResult(error.message);
    }
  }

  async validateDigitalPDF(pdfData, caseModel) {
    console.log("🔤 Processing digital PDF");
    
    const allText = this.extractAllText(pdfData);
    const results = {};
    const issues = [];
    
    for (const [fieldName, fieldConfig] of Object.entries(this.requiredFields)) {
      const expectedValue = caseModel[fieldName];
      if (!expectedValue && fieldConfig.required) {
        issues.push(`Missing required field in case model: ${fieldName}`);
        continue;
      }
      
      const match = this.findFieldInText(allText, fieldConfig, expectedValue);
      if (match.found) {
        const isValid = this.validateValue(match.value, expectedValue, fieldConfig.type);
        results[fieldName] = {
          found: match.value,
          expected: expectedValue,
          valid: isValid.valid,
          confidence: isValid.confidence
        };
        
        if (!isValid.valid) {
          issues.push(`${fieldName}: expected ${expectedValue}, found ${match.value}`);
        }
      } else if (fieldConfig.required) {
        issues.push(`Required field not found: ${fieldName}`);
      }
    }
    
    return this.createResult(results, issues);
  }

  async validateScannedPDF(filePath, caseModel) {
    console.log("🖼️  Processing scanned PDF");
    
    // Extract first page as image
    const pages = await this.extractPageImages(filePath);
    const firstPageBuffer = pages[0];
    
    // Initial OCR attempt
    let ocrText = await this.performBasicOCR(firstPageBuffer);
    console.log(`📝 Initial OCR extracted ${ocrText.length} characters`);
    
    // Save OCR text for debugging
    if (process.env.DEBUG || true) { // Always save for now
      await fs.writeFile('debug_ocr_text.txt', ocrText);
      console.log(`💾 OCR text saved to debug_ocr_text.txt for inspection`);
    }
    
    const results = {};
    const issues = [];
    let needsEnhancement = false;
    
    console.log(`\n🔍 Searching for ${Object.keys(this.requiredFields).length} required fields...`);
    console.log("─".repeat(60));
    
    // Try to find each required field
    for (const [fieldName, fieldConfig] of Object.entries(this.requiredFields)) {
      const expectedValue = caseModel[fieldName];
      if (!expectedValue && fieldConfig.required) {
        issues.push(`Missing required field in case model: ${fieldName}`);
        continue;
      }
      
      console.log(`\n🎯 Looking for: ${fieldName}`);
      const match = this.findFieldInText(ocrText, fieldConfig, expectedValue);
      
      if (match.found) {
        const isValid = this.validateValue(match.value, expectedValue, fieldConfig.type);
        results[fieldName] = {
          found: match.value,
          expected: expectedValue,
          valid: isValid.valid,
          confidence: isValid.confidence
        };
        
        const status = isValid.valid ? "✅ VALID" : "❌ INVALID";
        console.log(`${status} - Found: ${match.value}, Expected: ${expectedValue}`);
        
        if (!isValid.valid) {
          issues.push(`${fieldName}: expected ${expectedValue}, found ${match.value}`);
          needsEnhancement = true;
        }
      } else if (fieldConfig.required) {
        console.log(`❌ NOT FOUND`);
        issues.push(`Required field not found: ${fieldName}`);
        needsEnhancement = true;
      }
    }
    
    console.log("─".repeat(60));
    
    // If we have issues, try enhanced OCR on financial sections
    if (needsEnhancement && issues.length > 0) {
      console.log("\n🔍 Issues found, trying enhanced OCR on financial sections...");
      const enhancedResults = await this.enhanceFinancialSections(firstPageBuffer, caseModel, issues);
      
      // Merge enhanced results
      Object.assign(results, enhancedResults.results);
      // Replace issues with enhanced issues
      issues.length = 0;
      issues.push(...enhancedResults.issues);
    }
    
    return this.createResult(results, issues);
  }

  async enhanceFinancialSections(imageBuffer, caseModel, failedFields) {
    console.log("🎯 Enhancing financial sections for better OCR");
    
    // Create sections for different parts of the document
    const sections = await this.createDocumentSections(imageBuffer);
    const results = {};
    const issues = [];
    
    for (const section of sections) {
      console.log(`🔍 Processing section: ${section.name}`);
      
      // Enhanced OCR on this section
      const enhancedText = await this.performEnhancedOCR(section.buffer);
      
      // Try to find missing fields in this section
      for (const [fieldName, fieldConfig] of Object.entries(this.requiredFields)) {
        if (results[fieldName]) continue; // Already found
        
        const expectedValue = caseModel[fieldName];
        if (!expectedValue) continue;
        
        const match = this.findFieldInText(enhancedText, fieldConfig, expectedValue);
        if (match.found) {
          const isValid = this.validateValue(match.value, expectedValue, fieldConfig.type);
          results[fieldName] = {
            found: match.value,
            expected: expectedValue,
            valid: isValid.valid,
            confidence: isValid.confidence,
            section: section.name
          };
          
          if (!isValid.valid) {
            issues.push(`${fieldName}: expected ${expectedValue}, found ${match.value} (enhanced)`);
          } else {
            console.log(`✅ Found ${fieldName} in ${section.name}: ${match.value}`);
          }
        }
      }
    }
    
    // Add issues for still missing required fields
    for (const [fieldName, fieldConfig] of Object.entries(this.requiredFields)) {
      if (fieldConfig.required && !results[fieldName]) {
        issues.push(`Required field not found even with enhancement: ${fieldName}`);
      }
    }
    
    return { results, issues };
  }

  async createDocumentSections(imageBuffer) {
    // Create 3 main sections: top, middle, bottom
    const metadata = await sharp(imageBuffer).metadata();
    const { width, height } = metadata;
    
    const sections = [
      {
        name: "header", 
        top: 0, 
        left: 0, 
        width: width, 
        height: Math.floor(height * 0.3)
      },
      {
        name: "summary", 
        top: Math.floor(height * 0.2), 
        left: 0, 
        width: width, 
        height: Math.floor(height * 0.5)
      },
      {
        name: "footer", 
        top: Math.floor(height * 0.6), 
        left: 0, 
        width: width, 
        height: Math.floor(height * 0.4)
      }
    ];
    
    // Extract each section and scale it up
    for (const section of sections) {
      section.buffer = await sharp(imageBuffer)
        .extract({ 
          left: section.left, 
          top: section.top, 
          width: section.width, 
          height: section.height 
        })
        .resize(section.width * 2, section.height * 2, { // 2x scale
          kernel: sharp.kernel.lanczos3
        })
        .sharpen()
        .png()
        .toBuffer();
    }
    
    return sections;
  }

  async performBasicOCR(imageBuffer) {
    try {
      console.log(`🔍 Starting basic OCR (buffer size: ${imageBuffer.length} bytes)`);
      
      // Simple, reliable OCR without complex preprocessing
      const image = await sharp(imageBuffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      
      console.log(`📐 Image dimensions: ${image.info.width}x${image.info.height}, channels: ${image.info.channels}`);
      console.log(`📊 Raw data size: ${image.data.length} bytes`);
      
      // Validate buffer size matches expected
      const expectedSize = image.info.width * image.info.height * image.info.channels;
      if (image.data.length !== expectedSize) {
        throw new Error(`Buffer size mismatch: got ${image.data.length}, expected ${expectedSize}`);
      }
      
      // Create properly sized buffer for tesseract
      const imageData = {
        data: image.data,
        width: image.info.width,
        height: image.info.height
      };
      
      console.log(`🎯 Loading image into OCR engine...`);
      this.ocrEngine.loadImage(imageData);
      
      console.log(`📝 Extracting text...`);
      const text = this.ocrEngine.getText();
      console.log(`✅ OCR completed: ${text.length} characters extracted`);
      
      return text;
      
    } catch (error) {
      console.error(`❌ OCR failed:`, error.message);
      throw new Error(`OCR processing failed: ${error.message}`);
    }
  }

  async performEnhancedOCR(imageBuffer) {
    // Enhanced OCR with preprocessing for difficult sections
    const processedImage = await sharp(imageBuffer)
      .greyscale()
      .normalise()
      .sharpen({ sigma: 1.0, flat: 1.0, jagged: 2.0 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    const imageData = {
      data: processedImage.data,
      width: processedImage.info.width,
      height: processedImage.info.height
    };
    
    this.ocrEngine.loadImage(imageData);
    return this.ocrEngine.getText();
  }

  findFieldInText(text, fieldConfig, expectedValue) {
    console.log(`🔍 Searching for field with labels: [${fieldConfig.labels.join(', ')}]`);
    console.log(`🎯 Expected value: ${expectedValue} (type: ${fieldConfig.type})`);
    
    // Simple field finding using labels and proximity
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    console.log(`📄 Analyzing ${lines.length} text lines`);
    
    for (const label of fieldConfig.labels) {
      console.log(`🏷️  Searching for label: "${label}"`);
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const labelMatch = fuzzy(label.toLowerCase(), line.toLowerCase());
        
        if (labelMatch > 0.7) {
          console.log(`✨ Label match found (score: ${labelMatch.toFixed(2)}): "${line}"`);
          
          // Look for value in same line or next few lines
          const valuePattern = this.getValuePattern(fieldConfig.type);
          
          // Check same line first
          const sameLine = line.replace(label, '').trim();
          const sameLineMatch = sameLine.match(valuePattern);
          if (sameLineMatch) {
            const cleanedValue = this.cleanValue(sameLineMatch[0], fieldConfig.type);
            console.log(`✅ Value found in same line: "${sameLineMatch[0]}" → ${cleanedValue}`);
            return { found: true, value: cleanedValue };
          }
          
          // Check next 3 lines
          for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
            const nextLineMatch = lines[j].match(valuePattern);
            if (nextLineMatch) {
              const cleanedValue = this.cleanValue(nextLineMatch[0], fieldConfig.type);
              console.log(`✅ Value found in line ${j - i} below: "${nextLineMatch[0]}" → ${cleanedValue}`);
              return { found: true, value: cleanedValue };
            }
          }
          
          console.log(`⚠️  Label matched but no value found nearby`);
        }
      }
    }
    
    console.log(`❌ Field not found`);
    return { found: false };
  }

  getValuePattern(type) {
    switch (type) {
      case 'currency':
        return /R?\s*[\d\s,.']+(?:\.\d{2})?/;
      case 'percentage':
        return /[\d.,]+\s*%/;
      case 'reference':
        return /\d{10}/;
      case 'account':
        return /\d{6,12}/;
      default:
        return /\S+/;
    }
  }

  cleanValue(value, type) {
    switch (type) {
      case 'currency':
        return parseFloat(value.replace(/[R\s,]/g, ''));
      case 'percentage':
        return parseFloat(value.replace(/[%\s]/g, ''));
      case 'reference':
      case 'account':
        return value.replace(/\D/g, '');
      default:
        return value.trim();
    }
  }

  validateValue(found, expected, type) {
    const tolerance = this.tolerances[type];
    
    switch (type) {
      case 'currency':
      case 'percentage':
        const diff = Math.abs(found - expected);
        const valid = diff <= tolerance;
        return { 
          valid, 
          confidence: valid ? 1 - (diff / expected) : 0
        };
      
      case 'reference':
        const exact = found === expected.toString();
        return { valid: exact, confidence: exact ? 1 : 0 };
      
      case 'account':
        const accountDiff = this.levenshteinDistance(found, expected.toString());
        const valid_account = accountDiff <= tolerance;
        return { 
          valid: valid_account, 
          confidence: valid_account ? 1 - (accountDiff / expected.toString().length) : 0
        };
      
      default:
        return { valid: found === expected, confidence: found === expected ? 1 : 0 };
    }
  }

  levenshteinDistance(str1, str2) {
    const matrix = [];
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[str2.length][str1.length];
  }

  async extractPageImages(filePath) {
    const pdfDocument = await pdfImageExtract(filePath, {
      scale: 2, // Lower scale for initial processing
      docInitParams: {
        useSystemFonts: true,
        disableFontFace: true,
      },
    });
    
    const pages = [];
    for await (const pageBuffer of pdfDocument) {
      pages.push(pageBuffer);
    }
    
    return pages;
  }

  hasValidText(pdfData) {
    return pdfData.pages.some(page => 
      page.content && 
      page.content.length > 10 && 
      page.content.some(item => item.str && item.str.trim().length > 3)
    );
  }

  extractAllText(pdfData) {
    return pdfData.pages
      .flatMap(page => page.content || [])
      .map(item => item.str || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  createResult(results, issues) {
    const totalFields = Object.keys(this.requiredFields).length;
    const validFields = Object.values(results).filter(r => r.valid).length;
    const confidence = validFields / totalFields;
    
    return {
      status: issues.length === 0 ? "VALID" : "INVALID",
      confidence: confidence,
      fields: results,
      issues: issues,
      summary: {
        total: totalFields,
        found: Object.keys(results).length,
        valid: validFields,
        confidence: Math.round(confidence * 100) + '%'
      }
    };
  }

  createFailureResult(error) {
    return {
      status: "ERROR",
      confidence: 0,
      fields: {},
      issues: [error],
      summary: {
        total: 0,
        found: 0,
        valid: 0,
        confidence: '0%'
      }
    };
  }

  destroy() {
    if (this.ocrEngine) {
      this.ocrEngine.destroy();
    }
  }
}

export default SimpleDocumentValidator;