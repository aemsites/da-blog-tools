/* eslint-disable no-console, no-restricted-syntax, no-continue, no-await-in-loop */
/**
 * WSU Publish Request Workflow - MVP Worker
 * Cloudflare Worker for email-only publish request orchestration
 *
 * NO D1 database, NO n8n - direct Email integration
 */

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * JSON response helper
 */
function jsonResponse(data, headers = {}, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, ...headers, 'Content-Type': 'application/json' },
  });
}

/**
 * Decode a JWT token (without signature verification)
 * For DA tokens, we validate claims instead of signature
 */
function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    // Decode the payload (second part)
    const payload = parts[1];
    // Handle base64url encoding (replace - with +, _ with /)
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const jsonStr = atob(base64);
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error('JWT decode error:', error);
    return null;
  }
}

/**
 * Validate DA token by decoding and checking claims
 * Checks: client_id is 'darkalley', token not expired, has user
 */
function validateDAToken(request) {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('Missing or invalid Authorization header');
    return { valid: false, error: 'Missing or invalid Authorization header' };
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  // Decode the JWT
  const payload = decodeJWT(token);

  if (!payload) {
    console.error('Invalid token format');
    return { valid: false, error: 'Invalid token format' };
  }

  // Check client_id is from DA (darkalley)
  if (payload.client_id !== 'darkalley') {
    console.error('Token not from DA');
    return { valid: false, error: 'Token not from DA' };
  }

  // Check token is not expired
  const createdAt = parseInt(payload.created_at, 10);
  const expiresIn = parseInt(payload.expires_in, 10);
  const now = Date.now();

  if (createdAt + expiresIn < now) {
    console.error('Token expired');
    return { valid: false, error: 'Token expired' };
  }

  // Check has valid user
  if (!payload.aa_id && !payload.user_id) {
    console.error('Token missing user identity');
    return { valid: false, error: 'Token missing user identity' };
  }

  return {
    valid: true,
    user: {
      id: payload.user_id,
      email: payload.aa_id,
    },
  };
}

/**
 * Get a fresh Gmail OAuth access token using the refresh token
 */
async function getGmailAccessToken(env) {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.PUBLISH_REQUESTS_GMAIL_CLIENT_ID,
      client_secret: env.PUBLISH_REQUESTS_GMAIL_CLIENT_SECRET,
      refresh_token: env.PUBLISH_REQUESTS_GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const tokenData = await tokenResponse.json();

  if (!tokenData.access_token) {
    console.error('Gmail OAuth token error:', JSON.stringify(tokenData));
    throw new Error(`Failed to get Gmail access token: ${JSON.stringify(tokenData)}`);
  }

  return tokenData.access_token;
}

/**
 * Send email via Gmail API using OAuth
 */
async function sendEmailGmail(env, {
  to, cc, subject, html,
}) {
  const accessToken = await getGmailAccessToken(env);

  const fromAddress = env.GMAIL_FROM || `DA Publishing <${env.PUBLISH_REQUESTS_GMAIL_EMAIL}>`;
  const toList = Array.isArray(to) ? to : [to];
  let ccList = [];
  if (cc && cc.length > 0) {
    ccList = Array.isArray(cc) ? cc : [cc];
  }

  // Build RFC 2822 email with HTML content
  const emailLines = [
    `From: ${fromAddress}`,
    `To: ${toList.join(', ')}`,
  ];
  if (ccList.length > 0) {
    emailLines.push(`Cc: ${ccList.join(', ')}`);
  }
  emailLines.push(
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    '',
    html,
  );

  const emailContent = emailLines.join('\r\n');

  // Base64URL encode the email
  const encodedEmail = btoa(unescape(encodeURIComponent(emailContent)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // Send via Gmail API
  const sendResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encodedEmail }),
  });

  if (!sendResponse.ok) {
    const error = await sendResponse.text();
    console.error('Gmail API error:', error);
    throw new Error(`Email send failed: ${error}`);
  }

  return sendResponse.json();
}

/**
 * Convert a plain email string or object into a { email, name } object
 * accepted by the WSU AEM Cloud API.
 */
function toRecipientObject(recipient) {
  if (typeof recipient === 'string') {
    return { email: recipient };
  }
  return recipient; // already { email, name? }
}

/**
 * Send email via the WSU AEM Cloud API
 * POST https://publish-p136310-e1368284.adobeaemcloud.com/bin/wsu/sendEmail.json
 * Header: x-auth-api-key: <WSU_EMAIL_API_KEY>
 * Body follows the SendGrid-style personalizations format.
 * TODO: CC support for sending emails
 */
async function sendEmailWSU(env, {
  to, cc, subject, html,
}) {
  const toList = (Array.isArray(to) ? to : [to]).map(toRecipientObject);
  const ccList = cc && cc.length > 0
    ? (Array.isArray(cc) ? cc : [cc]).map(toRecipientObject)
    : undefined;

  const personalization = { to: toList, subject };
  if (ccList) personalization.cc = ccList;

  const payload = {
    personalizations: [personalization],
    from: {
      email: env.WSU_EMAIL_FROM_ADDRESS || 'aem-noreply@westernsydney.edu.au',
      name: env.WSU_EMAIL_FROM_NAME || 'WSU',
    },
    content: [
      { type: 'text/html', value: html },
    ],
  };

  const response = await fetch(env.WSU_EMAIL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-auth-api-key': env.WSU_EMAIL_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('WSU Email API error:', error);
    throw new Error(`Email send failed (WSU API): ${error}`);
  }

  return response.json();
}

/**
 * Unified sendEmail — routes to the correct provider based on EMAIL_PROVIDER env var.
 * Set EMAIL_PROVIDER = "wsu-api" in wrangler.toml to test the WSU AEM Cloud endpoint;
 * set it back to "gmail" (or leave it unset) to use Gmail OAuth.
 */
async function sendEmail(env, params) {
  const provider = (env.EMAIL_PROVIDER || 'gmail').toLowerCase();
  if (provider === 'wsu-api') {
    console.log('sendEmail: using WSU AEM Cloud API');
    return sendEmailWSU(env, params);
  }
  console.log('sendEmail: using Gmail API');
  return sendEmailGmail(env, params);
}

// /**
//  * Send email via Resend API (kept for reference / fallback)
//  */
// async function sendEmailResend(env, { to, cc, subject, html }) {
//   const emailPayload = {
//     from: env.RESEND_FROM || 'WSU Publishing <noreply@wsu.edu>',
//     to: Array.isArray(to) ? to : [to],
//     subject,
//     html,
//   };
//
//   // Add CC recipients if provided
//   if (cc && cc.length > 0) {
//     emailPayload.cc = Array.isArray(cc) ? cc : [cc];
//   }
//
//   const response = await fetch('https://api.resend.com/emails', {
//     method: 'POST',
//     headers: {
//       'Content-Type': 'application/json',
//       Authorization: `Bearer ${env.RESEND_API_KEY}`,
//     },
//     body: JSON.stringify(emailPayload),
//   });
//
//   if (!response.ok) {
//     const error = await response.text();
//     console.error('Resend API error:', error);
//     throw new Error(`Email send failed: ${error}`);
//   }
//
//   return await response.json();
// }

/**
 * Build approval request email HTML
 * Styled to match DA.live design system (Spectrum 2 / nexter.css)
 */
function buildApprovalRequestEmail({
  org, repo, path, previewUrl, authorEmail, authorName, comment, appUrl, inboxUrl,
}) {
  const authorDisplay = authorName || authorEmail;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Content Publish Request</title>
</head>
<body style="font-family: 'Adobe Clean', adobe-clean, 'Trebuchet MS', sans-serif; line-height: 1.5; color: #292929; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #f7f7f7; -webkit-font-smoothing: antialiased;">
  <div style="background: #990033; padding: 24px 24px 20px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 22px; font-weight: 700;">Content Publish Request</h1>
  </div>

  <div style="background: #ffffff; padding: 24px; border: 1px solid #e1e1e1; border-top: none; border-radius: 0 0 10px 10px;">
    <p style="margin: 0 0 16px 0; font-size: 16px;">
      <strong>${authorDisplay}</strong> has requested approval to publish the following content:
    </p>

    <div style="background: #f7f7f7; border: 1px solid #e1e1e1; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <p style="margin: 0 0 8px 0; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em; color: #505050;">Content URL</p>
      <p style="margin: 0 0 16px 0; font-weight: 700; word-break: break-all; font-size: 14px;">${path}</p>

      ${previewUrl ? `
      <p style="margin: 0 0 8px 0; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em; color: #505050;">Preview Page URL</p>
      <p style="margin: 0 0 16px 0;">
        <a href="${previewUrl}" style="color: #3b63fb; text-decoration: none; font-size: 14px;">${previewUrl}</a>
      </p>
      ` : ''}

      ${comment ? `
      <p style="margin: 0 0 8px 0; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em; color: #505050;">CONTENT UPDATE DESCRIPTION:</p>
      <p style="margin: 0; font-style: italic; background: #f1f1f1; padding: 12px; border-radius: 8px; font-size: 14px;">"${comment}"</p>
      ` : ''}
    </div>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${appUrl}"
         style="display: inline-block; background: #990033; color: white; padding: 12px 32px; text-decoration: none; border-radius: 16px; font-weight: 700; font-size: 15px; line-height: 16px;">
        Review &amp; Approve
      </a>
    </div>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${inboxUrl}"
         style="color: #3b63fb; text-decoration: none; font-size: 14px;">
        View all pending approvals
      </a>
    </div>

    <p style="margin: 20px 0 0 0; font-size: 13px; color: #505050; text-align: center;">
      Review content for compliance with Western Sydney University quality standards.
    </p>
  </div>

  <div style="padding: 16px; text-align: center; font-size: 12px; color: #505050;">
    <p style="margin: 0;">Content Publishing Workflow</p>
    <p style="margin: 4px 0 0 0;">Org: ${org} | Repo: ${repo}</p>
  </div>
</body>
</html>
  `;
}

/**
 * Build rejection notification email HTML
 * Styled to match DA.live design system (Spectrum 2 / nexter.css)
 */
function buildRejectionEmail({
  org, repo, path, authorEmail, authorName, rejecterEmail, rejecterName, reason,
}) {
  const authorDisplay = authorName || authorEmail;
  const rejecterDisplay = rejecterName || rejecterEmail;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Publish Request Rejected</title>
</head>
<body style="font-family: 'Adobe Clean', adobe-clean, 'Trebuchet MS', sans-serif; line-height: 1.5; color: #292929; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #f7f7f7; -webkit-font-smoothing: antialiased;">
  <div style="background: #990033; padding: 24px 24px 20px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 22px; font-weight: 700;">Publish Request Rejected</h1>
  </div>

  <div style="background: #ffffff; padding: 24px; border: 1px solid #e1e1e1; border-top: none; border-radius: 0 0 10px 10px;">
    <p style="margin: 0 0 16px 0; font-size: 16px;">
      A publish request has been <strong style="color: #990033;">rejected</strong>.
    </p>

    <div style="background: #f7f7f7; border: 1px solid #e1e1e1; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr>
          <td style="padding: 8px 0; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em; color: #505050; width: 120px; vertical-align: top;">Content Path</td>
          <td style="padding: 8px 0; font-weight: 700; word-break: break-all;">${path}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em; color: #505050; vertical-align: top;">Requested By</td>
          <td style="padding: 8px 0;">${authorDisplay}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em; color: #505050; vertical-align: top;">Rejected By</td>
          <td style="padding: 8px 0;">${rejecterDisplay}</td>
        </tr>
      </table>
    </div>

    <div style="background: #fce8e6; border: 1px solid #f5c6c2; border-radius: 8px; padding: 16px;">
      <p style="margin: 0 0 8px 0; font-weight: 700; color: #990033; font-size: 14px;">Reason for Rejection</p>
      <p style="margin: 0; font-style: italic; font-size: 14px;">"${reason}"</p>
    </div>

    <p style="margin: 24px 0 0 0; font-size: 13px; color: #505050;">
      Please review the feedback and make necessary changes before resubmitting for approval.
    </p>
  </div>

  <div style="padding: 16px; text-align: center; font-size: 12px; color: #505050;">
    <p style="margin: 0;">Content Publishing Workflow</p>
    <p style="margin: 4px 0 0 0;">Org: ${org} | Repo: ${repo}</p>
  </div>
</body>
</html>
  `;
}

/**
 * Build publish-success notification email HTML
 * Styled to match DA.live design system (Spectrum 2 / nexter.css)
 */
function buildPublishedEmail({
  org, repo, paths, approverEmail, approverName,
}) {
  const approverDisplay = approverName || approverEmail;
  const isBulk = paths.length > 1;
  const title = isBulk
    ? `${paths.length} Pages Published`
    : 'Content Published';
  const introText = isBulk
    ? `<strong>${approverDisplay}</strong> has approved and published the following <strong>${paths.length}</strong> pages:`
    : `<strong>${approverDisplay}</strong> has approved and published the following content:`;

  const pathRows = paths
    .map(
      (p) => `<tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e1e1e1; word-break: break-all; font-size: 14px;">
          <a href="https://main--${repo}--${org}.aem.live${p}" style="color: #3b63fb; text-decoration: none;">${p}</a>
        </td>
      </tr>`,
    )
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="font-family: 'Adobe Clean', adobe-clean, 'Trebuchet MS', sans-serif; line-height: 1.5; color: #292929; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #f7f7f7; -webkit-font-smoothing: antialiased;">
  <div style="background: #990033; padding: 24px 24px 20px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 22px; font-weight: 700;">${title}</h1>
  </div>

  <div style="background: #ffffff; padding: 24px; border: 1px solid #e1e1e1; border-top: none; border-radius: 0 0 10px 10px;">
    <p style="margin: 0 0 16px 0; font-size: 16px;">
      ${introText}
    </p>

    <div style="background: #f7f7f7; border: 1px solid #e1e1e1; border-radius: 8px; overflow: hidden; margin-bottom: 24px;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="background: #f1f1f1;">
          <th style="padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em; color: #505050;">Published Path${isBulk ? 's' : ''}</th>
        </tr>
        ${pathRows}
      </table>
    </div>

    <p style="margin: 24px 0 0 0; font-size: 13px; color: #505050;">
      The content is now live. No further action is needed on your part.
    </p>
  </div>

  <div style="padding: 16px; text-align: center; font-size: 12px; color: #505050;">
    <p style="margin: 0;">Content Publishing Workflow</p>
    <p style="margin: 4px 0 0 0;">Org: ${org} | Repo: ${repo}</p>
  </div>
</body>
</html>
  `;
}

// ============================================================================
// API Handlers
// ============================================================================

/**
 * Health check endpoint
 * GET /health
 */
async function handleHealth(env) {
  return jsonResponse({
    status: 'ok',
    service: 'publish-requests',
    timestamp: new Date().toISOString(),
    environment: env.ENVIRONMENT || 'unknown',
  });
}

/**
 * Send publish request email to approvers
 * POST /api/request-publish
 * Body: { org, repo, path, previewUrl, authorEmail, authorName?, comment?, approvers }
 */
async function handleRequestPublish(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, {}, 400);
  }

  const {
    path,
    previewUrl,
    authorEmail,
    authorName,
    comment,
    approvers,
    cc,
  } = body;
  const org = body.org || env.DA_ORG;
  const repo = body.repo || env.DA_REPO;

  // Validation
  if (!path) {
    return jsonResponse({ error: 'path is required' }, {}, 400);
  }
  if (!authorEmail) {
    return jsonResponse({ error: 'authorEmail is required' }, {}, 400);
  }
  if (!approvers || approvers.length === 0) {
    return jsonResponse({ error: 'approvers is required' }, {}, 400);
  }

  // Build approval URL with parameters
  // Format: https://da.live/app/{org}/{repo}/tools/apps/publish-requests-inbox/publish-requests-inbox?org={org}&repo={repo}&...
  const appParams = new URLSearchParams({
    org,
    repo,
    path,
    author: authorEmail,
    ...(previewUrl && { preview: previewUrl }),
    ...(comment && { comment }),
  });
  const appUrl = `https://da.live/app/${org}/${repo}/tools/apps/publish-requests-inbox/publish-requests-inbox?${appParams.toString()}`;
  const inboxUrl = `https://da.live/app/${org}/${repo}/tools/apps/publish-requests-inbox/publish-requests-inbox`;

  // Send email to approvers
  try {
    const emailHtml = buildApprovalRequestEmail({
      org,
      repo,
      path,
      previewUrl,
      authorEmail,
      authorName,
      comment,
      appUrl,
      inboxUrl,
    });

    // Filter CC to exclude anyone already in the approvers list (avoid duplicate emails)
    const approverSet = new Set((approvers || []).map((a) => a.toLowerCase()));
    const filteredCC = (cc || []).filter((c) => !approverSet.has(c.toLowerCase()));

    await sendEmail(env, {
      to: approvers,
      cc: filteredCC,
      subject: `[Website Publish Request] ${path}`,
      html: emailHtml,
    });

    return jsonResponse({
      success: true,
      message: 'Publish request sent to approvers',
      approvers,
      cc: filteredCC,
    });
  } catch (error) {
    console.error('Error sending publish request email:', error);
    return jsonResponse({ error: `Failed to send email: ${error.message}` }, {}, 500);
  }
}

/**
 * Send rejection notification email
 * POST /api/notify-rejection
 * Body: { org, repo, path, authorEmail, authorName?, rejecterEmail,
 *         rejecterName?, reason, digiops? }
 */
async function handleNotifyRejection(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, {}, 400);
  }

  const {
    path,
    authorEmail,
    authorName,
    rejecterEmail,
    rejecterName,
    reason,
    digiops,
  } = body;
  const org = body.org || env.DA_ORG;
  const repo = body.repo || env.DA_REPO;

  // Validation
  if (!path) {
    return jsonResponse({ error: 'path is required' }, {}, 400);
  }
  if (!authorEmail) {
    return jsonResponse({ error: 'authorEmail is required' }, {}, 400);
  }
  if (!rejecterEmail) {
    return jsonResponse({ error: 'rejecterEmail is required' }, {}, 400);
  }
  if (!reason) {
    return jsonResponse({ error: 'reason is required' }, {}, 400);
  }

  // Build recipient list (author + DigiOps if provided)
  const recipients = [authorEmail];
  if (digiops && digiops !== authorEmail) {
    recipients.push(digiops);
  }

  // Send rejection email
  try {
    const emailHtml = buildRejectionEmail({
      org,
      repo,
      path,
      authorEmail,
      authorName,
      rejecterEmail,
      rejecterName,
      reason,
    });

    await sendEmail(env, {
      to: recipients,
      subject: `[Rejected] Website Publish Request: ${path}`,
      html: emailHtml,
    });

    return jsonResponse({
      success: true,
      message: 'Rejection notification sent',
      recipients,
    });
  } catch (error) {
    console.error('Error sending rejection email:', error);
    return jsonResponse({ error: `Failed to send email: ${error.message}` }, {}, 500);
  }
}

/**
 * Send publish-success notification to authors
 * POST /api/notify-published
 * Body: { org, repo, paths: [{ path, authorEmail }], approverEmail, approverName? }
 */
async function handleNotifyPublished(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, {}, 400);
  }

  const {
    paths,
    approverEmail,
    approverName,
  } = body;
  const org = body.org || env.DA_ORG;
  const repo = body.repo || env.DA_REPO;

  // Validation
  if (!paths || paths.length === 0) {
    return jsonResponse({ error: 'paths is required (array of { path, authorEmail })' }, {}, 400);
  }
  if (!approverEmail) {
    return jsonResponse({ error: 'approverEmail is required' }, {}, 400);
  }

  try {
    // Group paths by author so each author gets one consolidated email
    const byAuthor = {};
    for (const entry of paths) {
      const author = entry.authorEmail || entry.requester;
      if (!author) continue;
      if (!byAuthor[author]) byAuthor[author] = [];
      byAuthor[author].push(entry.path);
    }

    const notifiedAuthors = [];
    for (const [authorEmail, authorPaths] of Object.entries(byAuthor)) {
      const emailHtml = buildPublishedEmail({
        org,
        repo,
        paths: authorPaths,
        approverEmail,
        approverName,
      });

      await sendEmail(env, {
        to: [authorEmail],
        subject: authorPaths.length > 1
          ? `[Published] ${authorPaths.length} pages published`
          : `[Published] ${authorPaths[0]}`,
        html: emailHtml,
      });
      notifiedAuthors.push(authorEmail);
    }

    return jsonResponse({
      success: true,
      message: 'Publish notifications sent to authors',
      notifiedAuthors,
    });
  } catch (error) {
    console.error('Error sending publish notification email:', error);
    return jsonResponse({ error: `Failed to send email: ${error.message}` }, {}, 500);
  }
}

// ============================================================================
// Main Request Handler
// ============================================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const { method } = request;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Health check - no auth required (root / and /health)
      if ((pathname === '/health' || pathname === '/') && method === 'GET') {
        return await handleHealth(env);
      }

      // All other endpoints require DA token validation
      const authResult = validateDAToken(request);
      if (!authResult.valid) {
        return jsonResponse({ error: authResult.error }, {}, 401);
      }

      // Route handling
      if (pathname === '/api/request-publish' && method === 'POST') {
        return await handleRequestPublish(request, env);
      }

      if (pathname === '/api/notify-rejection' && method === 'POST') {
        return await handleNotifyRejection(request, env);
      }

      if (pathname === '/api/notify-published' && method === 'POST') {
        return await handleNotifyPublished(request, env);
      }

      // Not found
      return jsonResponse({ error: 'Not found' }, {}, 404);
    } catch (error) {
      console.error('Unhandled error:', error);
      return jsonResponse({ error: 'Internal server error' }, {}, 500);
    }
  },
};
