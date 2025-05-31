import path from "path";
import { promises as fs } from "node:fs";
import SpatialDocumentValidator from "./cli/spatial-document-validator.js";

async function main() {
  // 🎯 Easy switching between test documents
  // const testMode = 'scanned'; // Change to 'digital' or 'scanned'
  const testMode = "digital"; // Change to 'digital' or 'scanned'

  let caseModel, docPath;

  if (testMode === "digital") {
    // Digital PDF test case
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
    // Scanned PDF test case (the problematic one)
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
      isStaff: "No",
    };

    docPath = path.join(
      process.cwd(),
      "test",
      "samples",
      "scanned-application.pdf"
    );
  }

  console.log("🚀 Starting spatial document validation with Fuse.js power!");
  console.log(`📁 Document: ${path.basename(docPath)}`);
  console.log(`💰 Expected loan amount: R${caseModel.loanAmount}`);
  console.log(`💳 Expected account: ${caseModel.collectionAccountNo}`);
  console.log(`🔢 Expected case ID: ${caseModel.caseId}`);
  console.log("─".repeat(50));

  const validator = new SpatialDocumentValidator();

  try {
    // Initialize with tesseract model
    const modelPath = path.join(process.cwd(), "eng.traineddata");
    await validator.initialize(modelPath);

    // Validate the document
    const startTime = Date.now();
    const results = await validator.validateDocument(docPath, caseModel);
    const duration = Date.now() - startTime;

    // Display results
    console.log("\n📊 VALIDATION RESULTS");
    console.log("─".repeat(50));
    console.log(`Status: ${results.status}`);
    console.log(`Overall Confidence: ${results.summary.confidence}`);
    console.log(`Processing Time: ${duration}ms`);
    console.log(
      `Fields Found: ${results.summary.found}/${results.summary.total}`
    );
    console.log(
      `Fields Valid: ${results.summary.valid}/${results.summary.total}`
    );

    if (Object.keys(results.fields).length > 0) {
      console.log("\n📋 FIELD DETAILS");
      console.log("─".repeat(50));

      for (const [field, result] of Object.entries(results.fields)) {
        const status = result.valid ? "✅" : "❌";
        const confidence = Math.round(result.confidence * 100);
        console.log(`${status} ${field}:`);
        console.log(`   Found: ${result.found}`);
        console.log(`   Expected: ${result.expected}`);
        console.log(`   Confidence: ${confidence}%`);
        if (result.section) {
          console.log(`   Section: ${result.section}`);
        }
        console.log();
      }
    }

    if (results.issues.length > 0) {
      console.log("⚠️  ISSUES FOUND");
      console.log("─".repeat(50));
      results.issues.forEach((issue, index) => {
        console.log(`${index + 1}. ${issue}`);
      });
    }

    // Save results
    const resultPath = path.join(process.cwd(), "spatial_result.json");
    await fs.writeFile(resultPath, JSON.stringify(results, null, 2));
    console.log(`\n💾 Results saved to: ${resultPath}`);

    // If we have major issues, suggest next steps
    if (results.status === "INVALID" && results.summary.found < 3) {
      console.log("\n🔧 TROUBLESHOOTING SUGGESTIONS");
      console.log("─".repeat(50));
      console.log("• Check if the PDF contains the expected document type");
      console.log("• Verify the case model data matches the document");
      console.log(
        "• Consider adjusting field labels if document format differs"
      );
      console.log("• Check OCR quality by examining individual sections");
    }

    console.log("\n📁 DEBUG FILES CREATED:");
    console.log("─".repeat(50));
    console.log("• spatial_validation_log.txt - Detailed processing log");
    console.log("• debug_bounding_boxes.json - Raw bounding boxes");
    console.log("• debug_merged_boxes.json - Merged bounding boxes");
    console.log("• spatial_result.json - Final validation results");

    return results;
  } catch (error) {
    console.error("\n❌ CRITICAL ERROR");
    console.error("─".repeat(50));
    console.error("Error:", error.message);
    console.error("Stack:", error.stack);

    // Provide helpful debugging info
    console.log("\n🔍 DEBUG INFO");
    console.log("─".repeat(50));
    console.log(`Node version: ${process.version}`);
    console.log(`Working directory: ${process.cwd()}`);
    console.log(
      `Document exists: ${await fs
        .access(docPath)
        .then(() => true)
        .catch(() => false)}`
    );
    console.log(
      `Model exists: ${await fs
        .access(path.join(process.cwd(), "eng.traineddata"))
        .then(() => true)
        .catch(() => false)}`
    );

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
