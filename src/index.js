import path from "path";
import fs from "fs/promises";
import DocumentValidationCLI from "./cli/document-validation.js";

async function main() {
  const caseModel = {
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
  const docPath = path.join(
    process.cwd(),
    "test",
    "samples",
    "digital-application.pdf"
  );
  const cli = new DocumentValidationCLI();
  const results = await cli.processDocument(docPath, caseModel);
  const resultPath = path.join(process.cwd(), "result.json");
  fs.writeFile(resultPath, JSON.stringify(results));
}

main().catch(console.error);
