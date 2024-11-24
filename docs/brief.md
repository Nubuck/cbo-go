I really need your help on a project that went to Prod and is now ruining my life. I'll spare your the story of how I got forced into this project, but I'll explain the project requirements, the solution I built under duress, the problems that emerged after going to prod and how I intend us to solve it.

I built an Hyper Automation and Document Intelligence product that has a contract for a large South African bank, and I was commissioned to built an automated Quality Verfication solution for the Personal Loans, Overdrafts and Credit Card department.

This is the CBO Quality Verification Bot solution that has replaced 9 human QA users.

The bot solution must:

- Monitor the CBO Verification Queue on the Banks IBM BPM system via the BAW Task REST API for new case tasks.
- When a new case task is added the CBO Verification Queue the bot will claim it which reassigns the task to the bot accounts queue.
- For each task to successfully complete a task the bot must:
  - Retrieve the case details for the task from BPM
  - Structure the case details into a model that can be used for the Verification process.
  - With the structured case model the bot then:
    - Establishes the product type of the case, either Personal Loan, Overdraft or Credit Card application.
    - The bot then queries the Banks ECM content system with diferent query params depending on product type.
    - This ECM query will return an array of case documents to analize and verify as correct or requires the documents to be corrected by another department
    - With the document pack results of the ECM query the bot will filter for Agreement Contracts (PAQ - Pre Agreement Quote), Application forms, FAIS forms and Loan Agreement document types and sort them by the upload date descending
    - The bot then applys different rules for each product type to the filtered and sorted document items:
      - Overdraft:
        - If the loan application channel is self assist and the application type is limit increase no documents are required and the task is completed in BPM
        - If the loan application channel is self assist and the application type is new then only a PAQ document is required, proceed to download first PAQ document for validation
        - if the loan application channel is staff assisted and the application type is limit increase then only an Application is required, proceed to download first Application Document
        - if the loan application channel is staff assisted and the application type is new then both a PAQ and an Application form are required, proceed to download both first PAQ and Application documents
      - Credit Card
        - If the credit application channel is self assist then only a PAQ documet is required, proceed to download first PAQ document
        - If the credit application channel is staff assisted then both a PAQ and Application document are required, proceed to download both first PAQ and Application Documents
      - Personal Loan
        - Proceed to download both first PAQ and Application Documents
    - Both the PAQ and Application documents have the following common verification check that must pass:
      - On the first page of the document the Quote ref number field at the top of the page must match the case model Case ID
      - On every page but the last the Case reference no field in the page footer must match the case model Case ID
      - On every page but the last the Merchant/Consultant no, Name and surname, Witness initial fields must contain a value (any value or marking)
      - On every page but the last the Client Intial field must have a value or hand written mark or any mark actually
      - Document Client Signature must have a mark in reasonably close vicinity
    - When any of the documents in the ECM document pack contain a Covid Cover Sheet page, with the case model Case ID value found in the content then no initials or signatures are required as the Covid Cover Sheet is a disbursement authorization confirmation that the customer consented to the PAQ and Application via voice Recording
    - Each product type has varying rules to verify the PAQ and / or Application documents against the case model data:
      - Personal Loan:
        - PAQ:
          - Payout amount field must match the case model loan amount value with a variance of 5 cents
          - Initiation fee field must match the case model Initiation fee field
          - Monthly service fee field must match the case model Service fee field
          - Montly Instalment field must match the case model Instalment field
          - Anual interest rate must match the case model Interest Rate field
          - Credit life insurance monthly premium must match the case model Insurance Premium field
          - Debit Order Account Number and Bank fields must match the case model Collection Account Number and Bank fields
          - When the Personal Loan is a consolidation the consolidations table must be compared row for row to the case model's consolidation list: Account number, Reference and Payout Amount must match a row in the case models consolidation list
        - Application:
          - Disbursement Account Number and Bank fields must match the case models Disbursement Accoutn and Bank fields
          - Debit Order Account Number and Bank fields must match the case model Collection Account Number and Bank fields
          - When Disbursement amount field is a Rand value it must match the case model loan amount field, else if the Disbursement amount field say refer to PAQ the ignore
      - Credit Card:
        - PAQ:
          - Total Card Facility field must match the case model loan amount value with a variance of 5 cents
          - Initiation fee field must match the case model Initiation fee field
          - Monthly service fee field must match the case model Service fee field
          - Montly Instalment field must match the case model Instalment field
          - Anual interest rate must match the case model Interest Rate field
          - Credit life insurance monthly premium must match the case model Insurance Premium field
          - Debit Order Account Number and Bank fields must match the case model Collection Account Number and Bank fields
        - Application:
          - Debit Order Account Number and Bank fields must match the case model Collection Account Number and Bank fields
      - Overdraft:
        - PAQ:
          - Loan Amount field must match the case model loan amount value with a variance of 5 cents
          - Initiation fee field must match the case model Initiation fee field
          - Monthly service fee field must match the case model Service fee field
          - Montly Instalment field must match the case model Instalment field
          - Anual interest rate must match the case model Interest Rate
          - Debit Order Account Number and Bank fields must match the case model Collection Account Number and Bank fields
      -  Application:
          - Debit Order Account Number and Bank fields must match the case model Collection Account Number and Bank fields
   - When any of the document fail verification the bot then starts the deep analysis process:
     - Classify each document independently of the ECM document pack type field
       - Check if any of the documents in the pack are PAQ, Application or Covid Cover Sheet
       - When a PAQ or Application document are found then repeat the verification process on each document
   - When the case documents are valid the complete the verification task on BPM Portal using a Playwright script we wrote together
   - When the case documents are certain to be invalid after deep analysis then structure the issues located into event flag parameters and flag a request documents event on BPM using a Playwright script we wrote together
   - The bot then uploads the valid documents or a batch of documents it checked that were invalid to the automation server
   - There are several checks for each case customer account via different account APIs that I've ommited as they are fine.
   - There are also several edge cases in these validations and alternative process that I've ommitted as they are not a problem.

The plan to production:

The bot solution was run in UAT with 3 bot machine instances and handling between 30 to 60 cases a day while the rest of the human QA team handled the rest of the tasks. This was meant to be a gradual adoption with more bots and sophisticated enhancements to the bots OCR and Document Kung fu as at this scale and gradual adoptions as when the bot fails to locate fiels to validate because of weak OCR or crazy digital PDF content, the bot would route the case to an automation operator to verfiy through the project real time dashboard that displays the case model data, the document pack of PDFs the bot has checked during validation and a list of failed validations. The operator could then make a decision and let the bot send the documents for request of complete the task for disbursal. during this period the bot collection, structuring, upscaling and enhancing document extracted image for OCR was meant to be refined and when the false positive or unlocated field exceptions slowed to an acceptable rate the bot solution would then manage the whole CBO Quality Verification queues tasks confidently.

The problematic reality: 

Once the bot had been confirmed to be able to disburse cases after much user account access and policy investigation and requesting to resolve exceptions which took around a week, the Loan Business Department pulled all the human QA users off the CBO Verification Queue and made quality verification of the banks Personal loans, Overdraft and Credit Card applications and be responsible for whether these applications are disbursesd or pended for correction.
The volume of tasks the bot solution had to process rose from 40 - 60 a day to 400 - 800 tasks a day.
A perfect document pack verifcation to task completion takes around 3 - 5 minutes. 
A failed document pack verifcation with deep analysis to bot decision and action of disbursal or pending can take from 7 - 45 minutes depending on how many documents a case has or how badly the front line bankers uploaded the documents, swatching around the documents types, scanning in upside down, mirrored, across multiple documents, combining all into one document, uploading the wrong cases... you name it, they invent new ways to waste the bots time every day.
Then the quality of the PDF documents is something to behold. Some of the PAQ and Application digital PDFs generated by the banks system have a custom font that none of the npm packages I tried could save those digital pdfs to image for signature and initial checks and some of the digital PDF extracted text bounding boxes are structred as each character as its own box rathern work or phrase which need to be recursively normalized.
So either way 3 bot machines was not going to cut it, so I scaled the solution up to 5 bot machines another automation server, on a sqlite db rather an MS SQL and naturally the capacity of the solution increased.
Here's where the problem arose. The period to refine and handle all the esoteric forms these applications took was never award to me and now anything the bot cannot get a read on or is just genuinely confused by the document configuration the front line bankers have made are routed to me for manual review because I just can't trust the bot to make the right call when half the comparision data from the document extraction is missing because the scan is skew.

Today I manually verified 240 cases, yesterday it was 180 because front line bankers are pushing to make end year targets and submitting any garbage. Comparitively I felt the problem previously where a bad day would only have 80 cases to check and average days were around 30 - which is unimaginably time consuming, as the CTO of my company, lead developer consultant in the bank, and senior developoer for my freelance projects - i have just not had time to sleep. I try improve the bots extraction and reasoning daily but which everything else it's just not possible.

Proposed solution:

Since the bank environment is air gapped and no AI cloud services are permitted, I had to write the document processing custom because my document intelligence product is not sophisticated enough.
I used a pdf extraction set of packages from npm, jimp and tesseract-js in node 16 with my own framework for utilities. 
There are thousands of lines of code to perform the verifcation process and some problems in how I located the field lables and their relative values because its based of either digital pds bounding boxes with text or text bounding boxes from tesseract-js. A skew page does not have the same x, y and a straight page, and all the location methods for match field lables and their values disappears.

In the project knowledge I have added a basic proof of concept for a rebuild of the bot. I'm using node 20 and I feel a better set of packages. I have pdf-to-img to extract and scale pdf pages as images, with the exception of those Bank genearted PDFs with a custom font. 
I have pdf-js.extract to get an array of bouncing boxes with text from digital pdfs. Scanned documents need to be converted to images for ocr
I have tesseract-wasm for a faster more stable OCR
I have sharp as a better alternative to jimp
And finally I have @techstark/opencv-js as wasm version of OpenCV i did not have previously.

In the basic proof of concept I demonstrate the very basics of extracting digital data, converting pages to images and performing an OCR of the first page.

I need your help using these improved packages, node version and perspective to rebuild the verification and deep analysis features of the bots, please.

I have also added fast-fuzzy and fuse.js to the cli in project knowledge as I think a fuzzy method of checking for case model data with proximity to field labels that fuzzy match will reduce the extraction misses and false positives.

I have included 2 PDF examples of PAQ documents, one digital and once scanned for reference. I'll increase the sample volume after our kick off.

--- 

Amazing, thanks I appreciate the help, would be the first time on this project.

1. have attached the digital image extractions - it does work but there is not text, only signatures and non Bank brand font are extracted - which is a pain because of how wild the digital pdf text boxes can be. I have also attached the raw output from the pdf.js-extract and the tesseract boxes and orientation output. I'll attached the scanned document output in another message for comparision

2. he majority of OCR required documents is quite good, but there are still many cases where the quality is really poor. Im my current solution I try work out where the image needs to be enhanced and adjusted lighter, darker, sharpened, double layered, rotated, skewed to varying success.
I also do an initial OCR to find section labels and indicators of field sections, then crop that section and scale it up and perform any enhancements possible to get terract to pick up all the number values, as the comparisons are pretty much all number comparisons.

3. wish I could give static average - on a good day I'll get 10 out of 100, on a bad day like today ill get 30 - 70 out of 100, a static average would be probaly in the 30 - 50 percent

4. Right now I'm not so concerned about time because accuracy takes priority - I can commission more bot machines as long as it's accurate - I have another 3 machines coming next week, so 8 in total, if the results are accurate but still too slow, Ill add more machines and another server to handle only deep analysis - time is secondary to accurracy

I think let's look at the scanned first - reason being is the ocr accurracy is a problem, and the fuzzy finding by proximity would be applied to both the tesseract produced text boxes or the digital text boxes.
The digital pdf text boxes also need solutions. I have a long word list that I use in the current word list to reconstruct words that the PDF stores randomly as separate boxes in the middle of word. The wild pdfs that have a text box for each character can be solved with an intersecting boxes recursive merge, but it is super slow. I know I said time is not a factor - this this can get out of hand.

Have a look at the attached output from the weird digital PDF and I'll attached the scanned ones next. Let me know if you have any questions anytime