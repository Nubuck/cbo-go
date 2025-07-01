Amazing. Let's give it a try. I have added the new project-context.md document and latest repomix.xml file with the digital-application.pdf and scanned-application.pdf to project knowledge.
After running the simple-main.js test with the digital application I have added the following outputs to project knowledge:
- debug_merged_boxes.json (I left out debug_bounding_boxes.json cause it was too big from project knowledge)
- spatial_result.json
- spatial_validation_log.txt

Please review if this is enough information to investigate the issues and resolve them?

---

Please have a look at the project-context.md, project-status.md and repomix.xml files in project knowledge.

We have had a successful start to rebuilding a critical solution for me with a robust and vastly simplified base validation engine for digital PDFs, particularly the digitial-application.pdf in project knowledge.

Now that we have a control case for digital, we must progress into the main and most challenging part of the project, the OCR validation engine for scanned PDFs as seen in scanned-application.pdf, of which the first page I have extracted to png and attached as page_1_raw.png as it contains all the values we are validating.

Our repomix codebase has a very basic OCR implementation, I have included a simple working example of image extraction of pdfs using our installed package pdf-to-img and running OCR with tesseract-wasm to get the spatial text boxes from the page. The tesseract-wasm typescript definitions are in tesseract-repomix.xml

Since our control sample for scanned PDF pages in page_1_raw.png is good quality, I think for a first pass of the OCR feature we can:

- determine if pdf is digital or scanned and switch methods - already in place
- extract pages of the pdf and save them as images - we will do one page at a time so save to disk, perform ocr process, move to next page
- use tesseract to get the spatial bounding boxes - normalize them to be the same format as the digital boxes and use the same validation process

That proves a basic working model.

Once we have a base working system we will need to start on the real world elements (some apply to the digital process as well)

- first classify the document - bankers often upload the wrong type of documents into the PAQ space for cases - we need to first identify if the document is a PAQ or is a PAQ and Application form joined into a single PDF
- Once we confirm document is a PAQ - we need to find the page with the financial information - often dispensation forms are page 1 or any number of other pages
- For scanned documents we need to check if the page is scanned in upside down or very skew and adjust before OCR because it will affect the spatial hunt and validate process
- If the teseract read misses finanical values as is often the case we will need to locate the financials block, crop it and enlarge it and read it with tesseract again as that often help catch all the numeric values
- If the tesseract read is still bad we will evaluate the document quality - is it too light, too dark, is it a photo with real world elements around it affecting the tesseract read - adjust it and try again
- If we get alpha character mixed in with our financial or numeric values, we should replace them with a symbol like a hash and use fuzzy matching to get an overall confidence - often the scans might have lines running over numbers but if its just one or 2 numbers that are not readable but the first and last numbers match, theres a strong chance it's correct because these documents are system generated
- Non matching values are often far off - lower offers are generally hundreds or thousands of Rands or percentages in interest are 1 to 3 percent different - case numbers are seldom close together due to he way BPM generates them.

Please ask any clarifying questions if any otherwise lets implement our first pass over ther scanned document validation.

---

okay after some debugging and trying a few variations I got the scanned PDF process to finish, some notes:

- the sharp enlargement and adjustments are causing issues for tesseract - I've commented them out for now and increased the page extraction scale to 3
- tesseract wasm text boxes are not the same format as tesseract.js - I've updated the normalization function to cater for the rect box format - please check is tesseract-repomix.xml typescript definitions has this box output format

I've attached the spacial_validation_log.txt from the last test, the scanned_validation_result.json and the debug_ocr_merged_boxes.json to evaluate where we can go to improve our changes of:
- more accurate tesseract read (like crop the financials block and enhance just that)
- broader and more forgiving fuzzy search for label names
- handle financial values that have non numeric values in them - this is sometimes unavoidable

What do you think?  

---


For a first pass the isolation of the financials block is not bad but it needs work: the isolated table needs to be cropped more dynamically and the combined bounding boxes with the original full page extraction needs to be fixed - currently only the isolated boxes are present.

- For the dynamic isolation, lets use a fuzzy search to 

PERSONAL LOAN - PRE-AGREEMENT STATEMENT AND QUOTATION SUMMARY - MONTHLY RESPONSIBILITIES 

Payout amount  

Annual interest rate  - fixed  

Merchant/Consultant no


---

ODD:


CBO Quality Verificaiton (PAQ):


DEP:

