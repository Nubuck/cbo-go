import path from "path";
import fs from "fs/promises";
import DocumentValidationCLI from "./cli/document-validation.js";

async function main() {

// const sample = 'digital'
const sample = 'scanned'
let caseModel = null
let docPath = null

if (sample === 'digital'){
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
   };

   docPath = path.join(
    process.cwd(),
    "test",
    "samples",
    "digital-application.pdf"
  );

}else{
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
  };
   docPath = path.join(
    process.cwd(),
    "test",
    "samples",
    "scanned-application.pdf"
  );
}

  const cli = new DocumentValidationCLI();

  try {
    const results = await cli.processDocument(docPath, caseModel);
    const resultPath = path.join(process.cwd(), "result.json");
    fs.writeFile(resultPath, JSON.stringify(results));
    console.log("\nValidation Results:", JSON.stringify(results, null, 2));
  } catch (error) {
    console.error("Validation failed:", error);
  }
}

main().catch(console.error);
