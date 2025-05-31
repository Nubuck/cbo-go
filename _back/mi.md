CBO

```sql
CREATE TABLE `static_storage_record` (`_id` char(36), `createdAt` datetime, `updatedAt` datetime, `storageId` varchar(255), `entryData` json, primary key (`_id`))

```

```sql
select
json_extract(entryData,'$.dateNumber') as dateNumber
,json_extract(entryData,'$.status') as status
,json_extract(entryData,'$.productType') as productType
,count(json_extract(entryData,'$.productType')) as productTypeCount
,ROUND(AVG(json_extract(entryData,'$.duration')),2) as avgDuration

from
static_storage_record
group by
json_extract(entryData,'$.dateNumber') 
,json_extract(entryData,'$.status')
,json_extract(entryData,'$.productType')

order by json_extract(entryData,'$.dateNumber')
;

select
json_extract(entryData,'$.dateNumber') as dateNumber
,json_extract(entryData,'$.status') as status
,count(_id) as totalCount
,ROUND(AVG(json_extract(entryData,'$.duration')),2) as avgDuration

from
static_storage_record
group by
json_extract(entryData,'$.dateNumber') 
,json_extract(entryData,'$.status')
order by json_extract(entryData,'$.dateNumber')


-- update static_storage_record
-- set entryData = json_patch(entryData, '{"status":"complete"}')
-- where json_extract(entryData,'$.status') = 'review' and json_extract(entryData,'$.dateNumber') < 20241026


SELECT
    json_extract(entryData, '$.dateNumber') AS dateNumber,
	CASE WHEN json_extract(entryData, '$.status') = 'review' THEN 'reassigned' ELSE json_extract(entryData, '$.status') END as status,
    COUNT(CASE WHEN json_extract(entryData, '$.productType') = 'Personal Loan' THEN 1 END) AS PersonalLoanCount,
    COUNT(CASE WHEN json_extract(entryData, '$.productType') = 'Credit Card' THEN 1 END) AS CreditCardCount,
    COUNT(CASE WHEN json_extract(entryData, '$.productType') = 'Overdraft' THEN 1 END) AS OverdraftCount
FROM
    static_storage_record
WHERE
json_extract(entryData, '$.dateNumber') > 20241020
GROUP BY
    json_extract(entryData, '$.dateNumber'),
    json_extract(entryData, '$.status')
ORDER BY
    json_extract(entryData, '$.dateNumber');


-- SELECT
--     json_extract(entryData, '$.dateNumber') AS dateNumber,
--     json_extract(entryData, '$.status') AS status,
--     COUNT(CASE WHEN json_extract(entryData, '$.productType') = 'Personal Loan' THEN 1 END) AS PersonalLoanCount,
--     COUNT(CASE WHEN json_extract(entryData, '$.productType') = 'Credit Card' THEN 1 END) AS CreditCardCount,
--     COUNT(CASE WHEN json_extract(entryData, '$.productType') = 'Overdraft' THEN 1 END) AS OverdraftCount
-- FROM
--     static_storage_record
-- WHERE
-- json_extract(entryData, '$.dateNumber') > 20241020
-- GROUP BY
--     json_extract(entryData, '$.dateNumber'),
--     json_extract(entryData, '$.status')
-- ORDER BY
--     json_extract(entryData, '$.dateNumber');
	
	
	
	
-- SELECT
--     json_extract(entryData, '$.dateNumber') AS dateNumber,
--     COUNT(CASE WHEN json_extract(entryData, '$.status') = 'complete' THEN 1 END) AS CompleteCount,
--     COUNT(CASE WHEN json_extract(entryData, '$.status') = 'request' THEN 1 END) AS RequestCount
-- FROM
--     static_storage_record
-- WHERE
-- json_extract(entryData, '$.dateNumber') > 20241020
-- GROUP BY
--     json_extract(entryData, '$.dateNumber')
-- ORDER BY
--     json_extract(entryData, '$.dateNumber');


SELECT
    json_extract(entryData, '$.dateNumber') AS dateNumber,
    COUNT(json_extract(entryData, '$.status')) AS ProcessCount,
    COUNT(CASE WHEN json_extract(entryData, '$.status') = 'complete' THEN 1 END) AS CompleteCount,
    COUNT(CASE WHEN json_extract(entryData, '$.status') = 'request' THEN 1 END) AS RequestCount,
    COUNT(CASE WHEN json_extract(entryData, '$.status') = 'review' THEN 1 END) AS ReassignCount
FROM
    static_storage_record
WHERE
json_extract(entryData, '$.dateNumber') > 20241020
GROUP BY
    json_extract(entryData, '$.dateNumber')
ORDER BY
    json_extract(entryData, '$.dateNumber');


```

```sql

select
_id
,json_extract(entryData,'$.dateNumber') as dateNumber
,json_extract(entryData,'$.status') as status
,json_extract(entryData,'$.assignedTo') as assignedTo
,json_extract(entryData,'$.result') as result
,json_extract(entryData,'$.reason') as reason
,json_extract(entryData,'$.comments') as comments
,json_extract(entryData,'$.issues') as issues
,json_extract(entryData,'$.product') as product
,json_extract(entryData,'$.productType') as productType
,json_extract(entryData,'$.productDescription') as productDescription
,json_extract(entryData,'$.caseId') as caseId
,json_extract(entryData,'$.processId') as processId
,json_extract(entryData,'$.taskId') as taskId
,json_extract(entryData,'$.partyId') as partyId
,json_extract(entryData,'$.arrangementId') as arrangementId
,json_extract(entryData,'$.accountNumber') as accountNumber
,json_extract(entryData,'$.applicationDate') as applicationDate
,json_extract(entryData,'$.applicationType') as applicationType
,json_extract(entryData,'$.entityName') as entityName
,json_extract(entryData,'$.entityIdNumber') as entityIdNumber
,json_extract(entryData,'$.entityDob') as entityDob
,json_extract(entryData,'$.entityGender') as entityGender
,json_extract(entryData,'$.entityNationality') as entityNationality
,json_extract(entryData,'$.isNedbankAccount') as isNedbankAccount
,json_extract(entryData,'$.mainBanked') as mainBanked
,json_extract(entryData,'$.bankName') as bankName
,json_extract(entryData,'$.bankAccountNumber') as bankAccountNumber
,json_extract(entryData,'$.bankAccountType') as bankAccountType
,json_extract(entryData,'$.disbursementBankName') as disbursementBankName
,json_extract(entryData,'$.disbursementBankAccountNumber') as disbursementBankAccountNumber
,json_extract(entryData,'$.disbursementBankAccountType') as disbursementBankAccountType
,json_extract(entryData,'$.collectionBankName') as collectionBankName
,json_extract(entryData,'$.collectionBankAccountNumber') as collectionBankAccountNumber
,json_extract(entryData,'$.collectionBankAccountType') as collectionBankAccountType
,json_extract(entryData,'$.isFraudFlagged') as isFraudFlagged
,json_extract(entryData,'$.isConsolidation') as isConsolidation
,json_extract(entryData,'$.isPensioner') as isPensioner
,json_extract(entryData,'$.employmentType') as employmentType
,json_extract(entryData,'$.occupation') as occupation
,json_extract(entryData,'$.employmentIndustry') as employmentIndustry
,json_extract(entryData,'$.employerName') as employerName
,json_extract(entryData,'$.monthlyIncome') as monthlyIncome
,json_extract(entryData,'$.requestedAmount') as requestedAmount
,json_extract(entryData,'$.interestRate') as interestRate
,json_extract(entryData,'$.installment') as installment
,json_extract(entryData,'$.initiationFee') as initiationFee
,json_extract(entryData,'$.upfrontInitiationFee') as upfrontInitiationFee
,json_extract(entryData,'$.newAccNum') as newAccNum
,json_extract(entryData,'$.newLoanAmtTotal') as newLoanAmtTotal
,json_extract(entryData,'$.newLoadAmtAdmin') as newLoadAmtAdmin
,json_extract(entryData,'$.totalInstallment') as totalInstallment
,json_extract(entryData,'$.loanTerm') as loanTerm
,json_extract(entryData,'$.insurancePremium') as insurancePremium
,json_extract(entryData,'$.totalRepayment') as totalRepayment
,json_extract(entryData,'$.accountInitiationFee') as accountInitiationFee
,json_extract(entryData,'$.accountInterestRate') as accountInterestRate
,json_extract(entryData,'$.accountInterestRateType') as accountInterestRateType
,json_extract(entryData,'$.productAppliedName') as productAppliedName
,json_extract(entryData,'$.activationTime') as activationTime
,json_extract(entryData,'$.dueTime') as dueTime
,json_extract(entryData,'$.action') as action
,json_extract(entryData,'$.machineName') as machineName
,json_extract(entryData,'$.machineId') as machineId
from
static_storage_record
```

PAQ

```sql
select
_id
,json_extract(entryData,'$.dateNumber') as dateNumber
,json_extract(entryData,'$.status') as status
,json_extract(entryData,'$.assignedTo') as assignedTo
,json_extract(entryData,'$.result') as result
,json_extract(entryData,'$.reason') as reason
,json_extract(entryData,'$.comments') as comments
,json_extract(entryData,'$.issues') as issues
,json_extract(entryData,'$.product') as product
,json_extract(entryData,'$.productType') as productType
,json_extract(entryData,'$.productDescription') as productDescription
,json_extract(entryData,'$.caseId') as caseId
,json_extract(entryData,'$.processId') as processId
,json_extract(entryData,'$.taskId') as taskId
,json_extract(entryData,'$.partyId') as partyId
,json_extract(entryData,'$.arrangementId') as arrangementId
,json_extract(entryData,'$.accountNumber') as accountNumber
,json_extract(entryData,'$.applicationDate') as applicationDate
,json_extract(entryData,'$.applicationType') as applicationType
,json_extract(entryData,'$.entityName') as entityName
,json_extract(entryData,'$.entityIdNumber') as entityIdNumber
,json_extract(entryData,'$.entityDob') as entityDob
,json_extract(entryData,'$.entityGender') as entityGender
,json_extract(entryData,'$.entityNationality') as entityNationality
,json_extract(entryData,'$.isNedbankAccount') as isNedbankAccount
,json_extract(entryData,'$.mainBanked') as mainBanked
,json_extract(entryData,'$.bankName') as bankName
,json_extract(entryData,'$.bankAccountNumber') as bankAccountNumber
,json_extract(entryData,'$.bankAccountType') as bankAccountType
,json_extract(entryData,'$.isFraudFlagged') as isFraudFlagged
,json_extract(entryData,'$.isConsolidation') as isConsolidation
,json_extract(entryData,'$.isPensioner') as isPensioner
,json_extract(entryData,'$.employmentType') as employmentType
,json_extract(entryData,'$.occupation') as occupation
,json_extract(entryData,'$.employmentIndustry') as employmentIndustry
,json_extract(entryData,'$.employerName') as employerName
,json_extract(entryData,'$.monthlyIncome') as monthlyIncome
,json_extract(entryData,'$.requestedAmount') as requestedAmount
,json_extract(entryData,'$.interestRate') as interestRate
,json_extract(entryData,'$.installment') as installment
,json_extract(entryData,'$.initiationFee') as initiationFee
,json_extract(entryData,'$.upfrontInitiationFee') as upfrontInitiationFee
,json_extract(entryData,'$.newAccNum') as newAccNum
,json_extract(entryData,'$.newLoanAmtTotal') as newLoanAmtTotal
,json_extract(entryData,'$.newLoadAmtAdmin') as newLoadAmtAdmin
,json_extract(entryData,'$.totalInstallment') as totalInstallment
,json_extract(entryData,'$.loanTerm') as loanTerm
,json_extract(entryData,'$.totalRepayment') as totalRepayment
,json_extract(entryData,'$.accountInitiationFee') as accountInitiationFee
,json_extract(entryData,'$.accountInterestRate') as accountInterestRate
,json_extract(entryData,'$.accountInterestRateType') as accountInterestRateType
,json_extract(entryData,'$.productAppliedName') as productAppliedName
,json_extract(entryData,'$.activationTime') as activationTime
,json_extract(entryData,'$.dueTime') as dueTime
,json_extract(entryData,'$.paqValid') as paqValid
,json_extract(entryData,'$.paqDataValid') as paqDataValid
,json_extract(entryData,'$.paqInitialType') as paqInitialType
,json_extract(entryData,'$.paqSignatureType') as paqSignatureType
,json_extract(entryData,'$.applicationValid') as applicationValid
,json_extract(entryData,'$.applicationDataValid') as applicationDataValid
,json_extract(entryData,'$.applicationInitialType') as applicationInitialType
,json_extract(entryData,'$.applicationSignatureType') as applicationSignatureType
,json_extract(entryData,'$.paq') as paq
,json_extract(entryData,'$.application') as application
,json_extract(entryData,'$.validation') as validation
,json_extract(entryData,'$.sourcePath') as sourcePath
,json_extract(entryData,'$.paqUploadId') as paqUploadId
,json_extract(entryData,'$.appUploadId') as appUploadId
,json_extract(entryData,'$.step') as step
,json_extract(entryData,'$.paqWidth') as paqWidth
,json_extract(entryData,'$.paqHeight') as paqHeight
,json_extract(entryData,'$.paqPages') as paqPages
,json_extract(entryData,'$.appWidth') as appWidth
,json_extract(entryData,'$.appHeight') as appHeight
,json_extract(entryData,'$.appPages') as appPages
,json_extract(entryData,'$.paqMethod') as paqMethod
,json_extract(entryData,'$.appMethod') as appMethod
,json_extract(entryData,'$.duration') as duration
from
static_storage_record

```


```json
{"dateNumber":20241124,"status":"complete","assignedTo":null,"result":"Valid","reason":"","comments":["PAQ Quote Reference Number matches BPM Case Number","PAQ Case Reference Numbers valid on all pages","PAQ Covid page found for Client Initials","PAQ Witness Initials valid","PAQ Covid page found for Client Signature","Application Case Reference Number matches BPM Case Number","Application Case Reference Numbers valid on all pages","Application Covid page found for Client Initials","PAQ Witness Initials valid","Application Covid page found for Client Signature","Validation of New loan amt total passed","Validation of Account interest rate passed","Validation of Installment passed","Validation of Initiation fee passed","Validation of New load amt admin passed","Validation of Insurance premium passed","Validation of Disbursement bank account number passed","Validation of App collection bank account number passed"],"issues":[],"product":"pl","productType":"Personal Loan","productDescription":"Personal Loan","caseId":"xxx","processId":"xxx","taskId":"xxx","partyId":"xxx","arrangementId":"xxx","accountNumber":"xxx","applicationDate":"24-11-2024","applicationType":"New","entityName":"MONGEZI MDEPA","entityIdNumber":"xxx","entityDob":"1984-11-10T00:00:00.000Z","entityGender":"Male","entityNationality":"SOUTH AFRICA","isNedbankAccount":"Yes","mainBanked":"Yes","bankName":"Nedbank Limited","bankAccountNumber":"xxx","bankAccountType":"Cheque Account","disbursementBankName":"NEDBANK","disbursementBankAccountNumber":"xxx","disbursementBankAccountType":"Cheque","collectionBankName":"NEDBANK","collectionBankAccountNumber":"xxx","collectionBankAccountType":"Cheque","isFraudFlagged":"No","isConsolidation":"No","isPensioner":"No","employmentType":"Permanent Salaried Employee","occupation":"OPERATOR","employmentIndustry":"CONSTR/ENGINEER SUPPLIES-BLDR PLANT HIRE","employerName":"LEOMAT PLANT HIRE","monthlyIncome":17618.74,"requestedAmount":20000,"interestRate":28.75,"installment":890.63,"initiationFee":1207.5,"upfrontInitiationFee":"No","newAccNum":"xxx","newLoanAmtTotal":20000,"newLoadAmtAdmin":69,"totalInstallment":890.63,"loanTerm":"48","insurancePremium":53.01,"totalRepayment":20000,"accountInitiationFee":"1207.5","accountInterestRate":28.75,"accountInterestRateType":"Prime Linked / Variable","productAppliedName":"Personal Loan","activationTime":"2024-11-24T13:12:12Z","dueTime":"2024-11-25T11:00:00Z","consolidations":[],"action":null,"machineName":"VM9","machineId":"e4a608db-1798-4e5d-864a-d5f62bc6218a","requestPaq":"No","requestPaqOption":"","requestPaqComment":"","requestApplication":"No","requestApplicationOption":"","requestApplicationComment":"","verifyComment":"PAQ and Application Verification Successful:\nPAQ Quote Reference Number matches BPM Case Number; \nPAQ Case Reference Numbers valid on all pages; \nPAQ Client Initials Valid; \nPAQ Covid page found for Client Initials; \nPAQ Witness Initials valid; \nPAQ Covid page found for Client Signature; \nPAQ Client Signature Valid; \nApplication Case Reference Number matches BPM Case Number; \nApplication Case Reference Numbers valid on all pages; \nApplication Client Initials Valid; \nApplication Client Signature Valid; \nValidation of Requested amount passed; \nValidation of Account interest rate passed; \nValidation of Installment passed; \nValidation of Initiation fee passed; \nValidation of New load amt admin passed; \nValidation of Insurance premium passed; \nValidation of Collection bank account number passed; \nValidation of Disbursement bank account number passed; \nValidation of App collection bank account number passed; \n"}

```


## NEW REPORTS

```sql
WITH CaseProcessing AS (
  SELECT 
    json_extract(entryData, '$.caseId') as case_id,
    COUNT(*) as total_attempts,
    SUM(CASE WHEN json_extract(entryData, '$.status') = 'complete' THEN 1 ELSE 0 END) as complete_count,
    SUM(CASE WHEN json_extract(entryData, '$.status') IN ('review', 'request') THEN 1 ELSE 0 END) as pended_count,
    MIN(CASE WHEN json_extract(entryData, '$.status') = 'complete' THEN json_extract(entryData, '$.dateNumber') END) as first_complete_date
  FROM static_storage_record
  WHERE json_extract(entryData, '$.dateNumber') > 20241020
  GROUP BY json_extract(entryData, '$.caseId')
)
SELECT 
  COUNT(DISTINCT case_id) as total_unique_cases,
  SUM(total_attempts) as total_processes,
  AVG(total_attempts) as avg_attempts_per_case,
  COUNT(CASE WHEN total_attempts = 1 AND complete_count = 1 THEN 1 END) as first_time_success,
  COUNT(CASE WHEN pended_count > 0 THEN 1 END) as cases_with_pends,
  AVG(pended_count) as avg_pends_per_case
FROM CaseProcessing;

```


```sql
WITH PendingReasons AS (
  SELECT 
    json_extract(entryData, '$.requestPaqComment') as paq_reason,
    json_extract(entryData, '$.requestApplicationComment') as app_reason,
    COUNT(*) as occurrence_count
  FROM static_storage_record
  WHERE (json_extract(entryData, '$.requestPaqComment') IS NOT NULL AND json_extract(entryData, '$.requestPaqComment') != '') 
     OR (json_extract(entryData, '$.requestApplicationComment') IS NOT NULL AND json_extract(entryData, '$.requestApplicationComment') != '')
  GROUP BY 
    json_extract(entryData, '$.requestPaqComment'),
    json_extract(entryData, '$.requestApplicationComment')
  ORDER BY occurrence_count DESC
  LIMIT 10
)
SELECT 
  COALESCE(paq_reason, app_reason) as pending_reason,
  occurrence_count,
  ROUND(occurrence_count * 100.0 / SUM(occurrence_count) OVER (), 2) as percentage
FROM PendingReasons;

```

```sql
-- Processing efficiency by product type
SELECT 
  json_extract(entryData, '$.productType') as product_type,
  AVG(CASE 
    WHEN json_extract(entryData, '$.status') = 'complete' 
    THEN ROUND((JULIANDAY(json_extract(entryData, '$.dueTime')) - JULIANDAY(json_extract(entryData, '$.activationTime'))) * 24 * 60, 2)
  END) as avg_processing_minutes,
  COUNT(*) as total_cases,
  ROUND(COUNT(CASE WHEN json_extract(entryData, '$.status') = 'complete' AND 
                   json_extract(entryData, '$.issues') = '[]' THEN 1 END) * 100.0 / COUNT(*), 2) as first_pass_yield_percentage
FROM static_storage_record
WHERE json_extract(entryData, '$.dateNumber') > 20241020
GROUP BY json_extract(entryData, '$.productType');

-- Fraud flag impact analysis
SELECT 
  json_extract(entryData, '$.isFraudFlagged') as fraud_flagged,
  COUNT(*) as total_cases,
  ROUND(AVG(CASE WHEN json_extract(entryData, '$.status') = 'complete' THEN 1 ELSE 0 END) * 100, 2) as completion_rate,
  ROUND(AVG(json_extract(entryData, '$.requestedAmount')), 2) as avg_requested_amount
FROM static_storage_record
WHERE json_extract(entryData, '$.dateNumber') > 20241020
GROUP BY json_extract(entryData, '$.isFraudFlagged');


```