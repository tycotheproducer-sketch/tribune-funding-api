const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL || 'https://ddicbebzovvuonuxbhck.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'sb_publishable_5UeztQgVFiYvswRBAYvTUw_xOj8n9lW';
const supabase = createClient(supabaseUrl, supabaseKey);

// Middleware
app.use(cors());
app.use(express.json());

// Email configuration
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER || process.env.SMTP_USER,
    pass: process.env.EMAIL_PASS || process.env.SMTP_PASS
  }
});

// Team emails that always get copied
const TEAM_EMAILS = [
  'loans@tribunefunding.com',
  'tyler@tribunefunding.com'
];

// Email sender identity
const SENDER_NAME = 'Tribune Funding Network';
const SENDER_EMAIL = process.env.EMAIL_USER || 'tyler@tribunefunding.com';

// Format currency
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0
  }).format(amount);
}

// Generate email body
function generateEmailBody(data, type) {
  const { borrowerProfile, matchedLenders, applicationId } = data;
  const topLenders = matchedLenders ? matchedLenders.slice(0, 3) : [];

  const propertyTypeLabels = {
    'single_family': 'Single Family', 'multi_family': 'Multi-Family',
    'condo': 'Condo', 'townhouse': 'Townhouse', 'mixed_use': 'Mixed-Use',
    'commercial': 'Commercial', 'land': 'Land', 'other': 'Other'
  };

  const loanPurposeLabels = {
    'purchase': 'Purchase', 'refinance': 'Refinance', 'cash_out': 'Cash-Out',
    'fix_and_flip': 'Fix & Flip', 'construction': 'Construction',
    'bridge': 'Bridge', 'land': 'Land'
  };

  let subject = '';
  if (type === 'submission') {
    subject = `New Loan Application - ${applicationId} - ${borrowerProfile.borrowerName}`;
  } else if (type === 'lender') {
    subject = `Loan Pre-Qualification Match - ${applicationId}`;
  }

  const body = `
═══════════════════════════════════════════════════════════════
TRIBUNE FUNDING NETWORK - LOAN PRE-QUALIFICATION REPORT
Application ID: ${applicationId}
Type: ${type === 'submission' ? 'New Application' : 'Lender Inquiry'}
═══════════════════════════════════════════════════════════════

${type === 'submission' ? '📋 NEW LOAN APPLICATION RECEIVED' : '📤 LENDER INQUIRY SENT'}

─────────────────────────────────────────────────────────────
BORROWER INFORMATION
─────────────────────────────────────────────────────────────
Name: ${borrowerProfile.borrowerName}
Email: ${borrowerProfile.borrowerEmail}
Phone: ${borrowerProfile.borrowerPhone || 'Not provided'}
${borrowerProfile.isBroker ? `Broker: ${borrowerProfile.brokerName || borrowerProfile.borrowerName}` : ''}

─────────────────────────────────────────────────────────────
LOAN DETAILS
─────────────────────────────────────────────────────────────
Property Type: ${propertyTypeLabels[borrowerProfile.propertyType] || borrowerProfile.propertyType}
Location: ${borrowerProfile.propertyState}
Property Value: ${formatCurrency(borrowerProfile.propertyValue)}
Loan Amount: ${formatCurrency(borrowerProfile.loanAmount)}
Loan Purpose: ${loanPurposeLabels[borrowerProfile.loanPurpose] || borrowerProfile.loanPurpose}
Term: ${borrowerProfile.loanTerm === 0 ? 'Other' : borrowerProfile.loanTerm + ' months'}
LTV: ${borrowerProfile.propertyValue > 0 ? Math.round((borrowerProfile.loanAmount / borrowerProfile.propertyValue) * 100) + '%' : 'N/A'}

─────────────────────────────────────────────────────────────
BORROWER QUALIFICATIONS
─────────────────────────────────────────────────────────────
Credit Score: ${borrowerProfile.creditScore || 'Not provided'}
Monthly Income: ${borrowerProfile.monthlyRent ? formatCurrency(borrowerProfile.monthlyRent) : 'Not provided'}
Monthly Expenses: ${borrowerProfile.monthlyExpenses ? formatCurrency(borrowerProfile.monthlyExpenses) : 'Not provided'}

Special Conditions:
${borrowerProfile.isFirstTimeInvestor ? '✓ First-time real estate investor' : ''}
${borrowerProfile.isForeignNational ? '✓ Foreign national / ITIN borrower' : ''}
${borrowerProfile.needsNoIncomeVerification ? '✓ No income verification needed' : ''}
${borrowerProfile.hasExistingLoan ? '✓ Has existing loan on property' : ''}

─────────────────────────────────────────────────────────────
ADDITIONAL NOTES
─────────────────────────────────────────────────────────────
${borrowerProfile.additionalNotes || 'No additional notes provided'}

${type === 'submission' && topLenders.length > 0 ? `
─────────────────────────────────────────────────────────────
RECOMMENDED LENDERS (Top 3)
─────────────────────────────────────────────────────────────
${topLenders.map((match, i) => `
${i + 1}. ${match.lender.company}
   Match Score: ${match.matchScore}%
   Contact: ${match.lender.contact_name || 'N/A'}
   Email: ${match.lender.email}
   Phone: ${match.lender.phone || 'N/A'}
   Match Reasons: ${match.matchReasons.join(', ')}
`).join('\n')}
` : ''}

═══════════════════════════════════════════════════════════════
This email was sent via Tribune Funding Network
loans@tribunefunding.com
═══════════════════════════════════════════════════════════════
  `.trim();

  return { subject, body };
}

// Route: Submit new application
app.post('/api/submit', async (req, res) => {
  const { borrowerProfile, matchedLenders, applicationId } = req.body;

  if (!borrowerProfile || !applicationId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  let submissionData = null;

  // Step 1: Store submission in Supabase (CRITICAL - must succeed)
  try {
    const { data, error } = await supabase
      .from('loan_submissions')
      .insert({
        application_id: applicationId,
        borrower_name: borrowerProfile.borrowerName,
        borrower_email: borrowerProfile.borrowerEmail,
        borrower_phone: borrowerProfile.borrowerPhone || null,
        property_type: borrowerProfile.propertyType,
        property_state: borrowerProfile.propertyState,
        property_value: borrowerProfile.propertyValue || null,
        loan_amount: borrowerProfile.loanAmount,
        loan_purpose: borrowerProfile.loanPurpose || null,
        credit_score: borrowerProfile.creditScore || null,
        status: 'pending'
      })
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      return res.status(500).json({ error: 'Failed to store submission in database' });
    }

    submissionData = data;
    console.log(`[${new Date().toISOString()}] Submission ${applicationId} stored in database`);
  } catch (error) {
    console.error('Database error:', error);
    return res.status(500).json({ error: 'Failed to store submission' });
  }

  // Step 2: Send email notification to team (non-critical)
  try {
    const { subject, body } = generateEmailBody({ borrowerProfile, matchedLenders, applicationId }, 'submission');
    const mailOptions = {
      from: `"${SENDER_NAME}" <${SENDER_EMAIL}>`,
      to: TEAM_EMAILS.join(', '),
      subject: subject,
      text: body
    };
    await transporter.sendMail(mailOptions);
    console.log(`[${new Date().toISOString()}] Application ${applicationId} - Email sent to team`);
  } catch (emailError) {
    console.error('Email error (non-blocking):', emailError.message);
  }

  res.json({
    success: true,
    message: 'Application submitted successfully',
    applicationId: applicationId,
    submissionId: submissionData?.id
  });
});

// Route: Send to individual lender
app.post('/api/send-to-lender', async (req, res) => {
  try {
    const { borrowerProfile, lender, applicationId } = req.body;

    if (!borrowerProfile || !lender || !applicationId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Find the submission in database
    const { data: submission } = await supabase
      .from('loan_submissions')
      .select('id')
      .eq('application_id', applicationId)
      .single();

    // Record lender contact if submission exists
    if (submission) {
      await supabase
        .from('lender_contacts')
        .insert({
          submission_id: submission.id,
          lender_id: lender.id || null,
          lender_company: lender.company,
          lender_email: lender.email,
          status: 'sent'
        });
      console.log(`[${new Date().toISOString()}] Lender contact recorded for ${applicationId}`);
    }

    // Send email to lender with CC to team
    const propertyTypeLabels = {
      'single_family': 'Single Family', 'multi_family': 'Multi-Family',
      'condo': 'Condo', 'townhouse': 'Townhouse', 'mixed_use': 'Mixed-Use',
      'commercial': 'Commercial', 'land': 'Land', 'other': 'Other'
    };

    const loanPurposeLabels = {
      'purchase': 'Purchase', 'refinance': 'Refinance', 'cash_out': 'Cash-Out',
      'fix_and_flip': 'Fix & Flip', 'construction': 'Construction',
      'bridge': 'Bridge', 'land': 'Land'
    };

    const lenderSubject = `Loan Pre-Qualification Summary - ${applicationId}`;
    const lenderBody = `
Dear ${lender.contact_name || 'Team'} at ${lender.company},

You have been selected as a potential lender match for the following loan opportunity:

═══════════════════════════════════════════════════════════════
LOAN OPPORTUNITY SUMMARY
Application ID: ${applicationId}
═══════════════════════════════════════════════════════════════

─────────────────────────────────────────────────────────────
PROPERTY & LOAN DETAILS
─────────────────────────────────────────────────────────────
Property Type: ${propertyTypeLabels[borrowerProfile.propertyType] || borrowerProfile.propertyType}
Location: ${borrowerProfile.propertyState}
Property Value: ${formatCurrency(borrowerProfile.propertyValue)}
Loan Amount: ${formatCurrency(borrowerProfile.loanAmount)}
Loan Purpose: ${loanPurposeLabels[borrowerProfile.loanPurpose] || borrowerProfile.loanPurpose}
Term: ${borrowerProfile.loanTerm === 0 ? 'Other' : borrowerProfile.loanTerm + ' months'}
LTV: ${borrowerProfile.propertyValue > 0 ? Math.round((borrowerProfile.loanAmount / borrowerProfile.propertyValue) * 100) + '%' : 'N/A'}

─────────────────────────────────────────────────────────────
BORROWER QUALIFICATIONS
─────────────────────────────────────────────────────────────
Credit Score: ${borrowerProfile.creditScore || 'Not provided'}
Monthly Income: ${borrowerProfile.monthlyRent ? formatCurrency(borrowerProfile.monthlyRent) : 'Not provided'}
Monthly Expenses: ${borrowerProfile.monthlyExpenses ? formatCurrency(borrowerProfile.monthlyExpenses) : 'Not provided'}

Special Conditions:
${borrowerProfile.isFirstTimeInvestor ? '✓ First-time real estate investor' : ''}
${borrowerProfile.isForeignNational ? '✓ Foreign national / ITIN borrower' : ''}
${borrowerProfile.needsNoIncomeVerification ? '✓ No income verification needed' : ''}
${borrowerProfile.hasExistingLoan ? '✓ Has existing loan on property' : ''}
${borrowerProfile.preferredNoPrepay ? '✓ Prefers no prepayment penalty' : ''}

─────────────────────────────────────────────────────────────
ADDITIONAL NOTES
─────────────────────────────────────────────────────────────
${borrowerProfile.additionalNotes || 'No additional notes provided'}

─────────────────────────────────────────────────────────────
INTERESTED?
─────────────────────────────────────────────────────────────
To express interest in this loan opportunity, please contact:
Tribune Funding Network
Email: loans@tribunefunding.com
CC: tyler@tribunefunding.com

Reference Application ID: ${applicationId}

Note: Borrower contact information is protected. All inquiries must go through Tribune Funding Network.

Best regards,
Tribune Funding Network
    `.trim();

    try {
      const lenderMailOptions = {
        from: `"${SENDER_NAME}" <${SENDER_EMAIL}>`,
        to: lender.email,
        cc: TEAM_EMAILS.join(', '),
        subject: lenderSubject,
        text: lenderBody
      };
      await transporter.sendMail(lenderMailOptions);
      console.log(`[${new Date().toISOString()}] Lender inquiry sent to ${lender.email} for ${applicationId}`);
    } catch (emailError) {
      console.error('Email error (non-blocking):', emailError.message);
    }

    res.json({ success: true, message: 'Email sent to lender and team' });
  } catch (error) {
    console.error('Error in /api/send-to-lender:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Supabase configured: ${supabaseUrl}`);
  console.log(`Email will be sent to: ${TEAM_EMAILS.join(', ')}`);
});
