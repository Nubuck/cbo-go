export const validationProfiles = {
  paq: {
    contentSections: {
      header: {
        markers: [
          'PRE-AGREEMENT STATEMENT',
          'QUOTATION AND TERMS AND CONDITIONS',
          'Quote ref number'
        ],
        expectedBounds: { top: 0, bottom: 0.2 },
        requiredFields: ['quoteRef']
      },
      summary: {
        markers: [
          'PRE-AGREEMENT STATEMENT AND QUOTATION SUMMARY',
          'MONTHLY RESPONSIBILITIES',
          'Payout amount',
          'Credit advanced'
        ],
        expectedBounds: { top: 0.2, bottom: 0.5 },
        requiredFields: [
          'loanAmount',
          'monthlyInstalment',
          'annualInterestRate',
          'creditLifeInsurance'
        ]
      },
      employeeBenefit: {
        markers: [
          'PERSONAL LOAN - EMPLOYEE BENEFIT',
          'Illustrated below is the benefit'
        ],
        expectedBounds: { top: 0.4, bottom: 0.6 },
        optional: true
      },
      payment: {
        markers: [
          'AUTHORITY TO DEBIT YOUR ACCOUNT',
          'PAYMENT OF INSTALMENTS'
        ],
        expectedBounds: { top: 0.5, bottom: 0.8 },
        requiredFields: ['bank', 'accountNumber']
      },
      signature: {
        markers: [
          'Client Signature',
          'IMPORTANT CONFIRMATION'
        ],
        expectedBounds: { top: 0.8, bottom: 1.0 }
      }
    },
    
    fieldDefinitions: {
      // Financial fields
      loanAmount: {
        type: 'currency',
        aliases: ['Payout amount', 'Credit advanced', 'Loan Amount', 'Total Card Facility'],
        section: 'summary',
        position: { top: 0.1, bottom: 0.3 },
        validation: {
          required: true,
          tolerance: 0.05, // 5 cents
          priority: 1.0
        }
      },
      monthlyInstalment: {
        type: 'currency',
        aliases: ['Monthly instalment', 'instalment', 'Monthly Payment'],
        section: 'summary',
        position: { top: 0.2, bottom: 0.4 },
        validation: {
          required: true,
          tolerance: 0.05,
          priority: 0.8
        }
      },
      annualInterestRate: {
        type: 'percentage',
        aliases: ['Annual interest rate', 'Interest Rate', 'Interest rate per annum'],
        section: 'summary',
        position: { top: 0.3, bottom: 0.5 },
        validation: {
          required: true,
          tolerance: 0.001, // Allow 29 vs 29.00
          priority: 0.7
        }
      },
      creditLifeInsurance: {
        type: 'currency',
        aliases: ['Credit life insurance', 'Insurance Premium', 'Monthly Premium'],
        section: 'summary',
        position: { top: 0.3, bottom: 0.5 },
        validation: {
          required: true,
          tolerance: 0.05,
          priority: 0.6
        }
      },
      initiationFee: {
        type: 'currency',
        aliases: ['Initiation fee', 'Initiation Fee'],
        section: 'summary',
        position: { top: 0.2, bottom: 0.4 },
        validation: {
          required: false,
          tolerance: 0.05,
          priority: 0.4
        }
      },
      monthlyServiceFee: {
        type: 'currency',
        aliases: ['Monthly service fee', 'Service Fee', 'Monthly Fee'],
        section: 'summary',
        position: { top: 0.2, bottom: 0.4 },
        validation: {
          required: false,
          tolerance: 0.05,
          priority: 0.4
        }
      },

      // Reference fields
      quoteRef: {
        type: 'reference',
        aliases: ['Quote ref number', 'Quote reference', 'Reference Number'],
        section: 'header',
        position: { top: 0, bottom: 0.2 },
        validation: {
          required: true,
          priority: 0.9,
          crossMatch: 'caseReference'
        }
      },
      caseReference: {
        type: 'reference',
        aliases: ['Case reference no', 'Case ID', 'Application Number'],
        repeating: true,
        validation: {
          required: true,
          priority: 0.9,
          crossMatch: 'quoteRef'
        }
      },

      // Bank details
      bank: {
        type: 'bankName',
        aliases: ['Bank', 'Bank Name', 'Banking Institution'],
        section: 'payment',
        position: { top: 0.1, bottom: 0.5 },
        validation: {
          required: true,
          priority: 0.3,
          fuzzyMatch: true,
          minScore: 0.6
        }
      },
      accountNumber: {
        type: 'accountNumber',
        aliases: ['Account number', 'Account No', 'Account Number'],
        section: 'payment',
        position: { top: 0.1, bottom: 0.5 },
        validation: {
          required: true,
          priority: 0.8,
          digitalTolerance: 0,
          ocrTolerance: 1
        }
      }
    },

    // Cross-validation rules
    crossValidation: {
      references: {
        fields: ['quoteRef', 'caseReference'],
        mustMatch: true,
        priority: 0.9
      },
      financials: {
        fields: ['loanAmount', 'creditAdvanced'],
        maxDifference: 0.05,
        priority: 0.8
      }
    },

    // Section-specific validation rules
    sectionRules: {
      summary: {
        requiredFields: ['loanAmount', 'monthlyInstalment', 'annualInterestRate'],
        minConfidence: 0.8
      },
      payment: {
        requiredFields: ['bank', 'accountNumber'],
        minConfidence: 0.7
      }
    }
  }
};