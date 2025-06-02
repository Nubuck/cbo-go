// Updated simple-main.js to test OCR validation

import path from "path";
import { promises as fs } from "node:fs";
import SpatialDocumentValidator from "./cli/spatial-document-validator.js";

async function main() {
  // 🎯 Switch to OCR testing mode
  const testMode = "scanned"; // Testing the OCR pipeline
  
  let caseModel, docPath;

  if (testMode === "digital") {
    // Digital PDF test case (100% working)
    caseModel = {
      product: "pl",
      productDescription: "Personal Loan",
      caseId: "10016998899",
      clientIdNo: "8702150972084",
      clientIsStaff: true,
      loanAmount: 90640.57,
      initiationFee: 1207.5,
      serviceFee: 69,
      instalment: 3393.49,
      interestRate: 29.25,
      insurancePremium: 321.46,
      collectionBank: "Nedbank",
      collectionAccountNo: "1148337962",
      isStaff: "Yes",
    };

    docPath = path.join(
      process.cwd(),
      "test",
      "samples", 
      "digital-application.pdf"
    );
  } else {
    // 🎯 SCANNED PDF TEST CASE - OCR Challenge
    caseModel = {
      product: "pl",
      productDescription: "Personal Loan", 
      caseId: "10017007279",
      clientIdNo: "9912080155082",
      clientIsStaff: false,
      loanAmount: 147126.55,
      initiationFee: 1207.5,
      serviceFee: 69,
      instalment: 5436.68,
      interestRate: 29.25,
      insurancePremium: 519.16,
      collectionBank: "Nedbank",
      collectionAccountNo: "1171851065",
      isStaff: "No", // Non-staff = single financial table
    };

    docPath = path.join(
      process.cwd(),
      "test",
      "samples",
      "scanned-application.pdf"
    );
  }

  console.log("🚀 Starting OCR-enhanced spatial document validation!");
  console.log(`📁 Document: ${path.basename(docPath)}`);
  console.log(`🔄 Test Mode: ${testMode.toUpperCase()}`);
  console.log(`💰 Expected loan amount: R${caseModel.loanAmount.toLocaleString()}`);
  console.log(`📈 Expected instalment: R${caseModel.instalment.toLocaleString()}`);
  console.log(`📊 Expected interest rate: ${caseModel.interestRate}%`);
  console.log(`🛡️  Expected insurance: R${caseModel.insurancePremium}`);
  console.log(`💳 Expected account: ${caseModel.collectionAccountNo}`);
  console.log(`🔢 Expected case ID: ${caseModel.caseId}`);
  console.log(`👤 Staff status: ${caseModel.isStaff}`);
  console.log("─".repeat(60));

  const validator = new SpatialDocumentValidator();

  try {
    // Initialize with tesseract model
    const modelPath = path.join(process.cwd(), "eng.traineddata");
    await validator.initialize(modelPath);

    // Validate the document
    const startTime = Date.now();
    const results = await validator.validateDocument(docPath, caseModel);
    const duration = Date.now() - startTime;

    // Display results with OCR-specific metrics
    console.log("\n📊 OCR VALIDATION RESULTS");
    console.log("─".repeat(60));
    console.log(`Status: ${results.status}`);
    console.log(`Overall Confidence: ${results.summary.confidence}`);
    console.log(`Processing Time: ${duration}ms`);
    console.log(`Fields Found: ${results.summary.found}/${results.summary.total}`);
    console.log(`Fields Valid: ${results.summary.valid}/${results.summary.total}`);
    
    // Calculate success rate
    const successRate = Math.round((results.summary.valid / results.summary.total) * 100);
    console.log(`Success Rate: ${successRate}%`);
    
    // Target achievement check
    const targetMet = successRate >= 80;
    console.log(`🎯 Target (80%): ${targetMet ? "✅ MET" : "❌ NOT MET"}`);

    if (Object.keys(results.fields).length > 0) {
      console.log("\n📋 FIELD DETAILS");
      console.log("─".repeat(60));

      for (const [field, result] of Object.entries(results.fields)) {
        const status = result.valid ? "✅" : "❌";
        const confidence = Math.round(result.confidence * 100);
        console.log(`${status} ${field}:`);
        console.log(`   Found: ${result.found}`);
        console.log(`   Expected: ${result.expected}`);
        console.log(`   Confidence: ${confidence}%`);
        
        if (result.method) {
          console.log(`   Method: ${result.method}`);
        }
        
        if (result.ocrQuality) {
          console.log(`   OCR Quality: ${result.ocrQuality}`);
        }
        
        console.log();
      }
    }

    if (results.issues.length > 0) {
      console.log("⚠️  ISSUES FOUND");
      console.log("─".repeat(60));
      results.issues.forEach((issue, index) => {
        console.log(`${index + 1}. ${issue}`);
      });
    }

    // Save results with OCR suffix
    const resultPath = path.join(process.cwd(), `${testMode}_validation_result.json`);
    await fs.writeFile(resultPath, JSON.stringify(results, null, 2));
    console.log(`\n💾 Results saved to: ${resultPath}`);

    // OCR-specific debugging advice
    if (testMode === "scanned") {
      console.log("\n🔧 OCR DEBUGGING FILES CREATED:");
      console.log("─".repeat(60));
      console.log("• scanned_validation_log.txt - Detailed OCR processing log");
      console.log("• debug_ocr_raw_boxes.json - Raw Tesseract bounding boxes");
      console.log("• debug_ocr_merged_boxes.json - Merged OCR bounding boxes");
      console.log("• debug_scanned-application_page1_original.png - Original extracted page");
      console.log("• debug_scanned-application_page1_enhanced.png - Sharp-enhanced page");
      console.log("• scanned_validation_result.json - Final OCR results");
      
      console.log("\n🖼️  IMAGE QUALITY COMPARISON:");
      console.log("─".repeat(60));
      console.log("• Compare original vs enhanced images to assess preprocessing");
      console.log("• Enhanced image: Grayscale + Normalized + 2x Scale");
      console.log("• Look for improved text clarity and contrast");
      
      if (successRate < 80) {
        console.log("\n💡 OCR IMPROVEMENT SUGGESTIONS:");
        console.log("─".repeat(60));
        console.log("• Check debug_ocr_raw_boxes.json for text recognition quality");
        console.log("• Compare original vs enhanced image quality");
        console.log("• Verify financial values are being detected by Tesseract");
        console.log("• Consider additional preprocessing if enhancement insufficient");
        console.log("• Check if document orientation or skew affects OCR");
      }
    }

    // Performance comparison
    if (testMode === "digital") {
      console.log("\n⚡ DIGITAL PDF PERFORMANCE (BASELINE)");
    } else {
      console.log("\n🖼️  SCANNED PDF PERFORMANCE (OCR)");
    }
    console.log("─".repeat(60));
    console.log(`Processing speed: ${(duration/1000).toFixed(1)}s`);
    console.log(`Accuracy: ${successRate}%`);

    return results;
  } catch (error) {
    console.error("\n❌ CRITICAL ERROR");
    console.error("─".repeat(60));
    console.error("Error:", error.message);
    console.error("Stack:", error.stack);

    // OCR-specific debugging info
    console.log("\n🔍 DEBUG INFO");
    console.log("─".repeat(60));
    console.log(`Node version: ${process.version}`);
    console.log(`Working directory: ${process.cwd()}`);
    console.log(`Document exists: ${await fs.access(docPath).then(() => true).catch(() => false)}`);
    console.log(`Model exists: ${await fs.access(path.join(process.cwd(), "eng.traineddata")).then(() => true).catch(() => false)}`);
    
    if (testMode === "scanned") {
      console.log("🖼️  OCR-specific checks:");
      console.log("• Ensure sufficient memory for image processing");
      console.log("• Verify Tesseract model is compatible");
      console.log("• Check if PDF pages extracted successfully");
    }

    return null;
  } finally {
    validator.destroy();
  }
}

// Handle unhandled rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

main().catch((error) => {
  console.error("Main function failed:", error);
  process.exit(1);
});