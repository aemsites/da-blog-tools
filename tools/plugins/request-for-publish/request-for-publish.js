/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console */
/* eslint-disable class-methods-use-this, function-paren-newline */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import {
  detectApprovers,
  submitPublishRequest,
  resendPublishRequest,
  withdrawPublishRequest,
  getUserEmail,
  checkExistingRequest,
} from './utils.js';

// Super Lite components
import 'https://da.live/nx/public/sl/components.js';

// RUM helper – safely fires a checkpoint if the RUM script is loaded
function sampleRUM(checkpoint, data = {}) {
  try {
    window.hlx?.rum?.sampleRUM?.(checkpoint, data);
  } catch { /* noop */ }
}

// Application styles - load with error handling
let styles = null;
try {
  const loadStyle = (await import('../../scripts/utils/styles.js')).default;
  styles = await loadStyle(import.meta.url);
} catch (e) {
  console.warn('Failed to load styles:', e);
}

class RequestForPublishPlugin extends LitElement {
  static properties = {
    context: { attribute: false },
    path: { attribute: false },
    token: { attribute: false },
    _isLoading: { state: true },
    _isSubmitting: { state: true },
    _message: { state: true },
    _userEmail: { state: true },
    _approvers: { state: true },
    _cc: { state: true },
    _approversSource: { state: true },
    _submitted: { state: true },
    _existingRequest: { state: true },
    _isResending: { state: true },
    _isWithdrawing: { state: true },
  };

  constructor() {
    super();
    this._isLoading = true;
    this._isSubmitting = false;
    this._message = null;
    this._userEmail = '';
    this._approvers = [];
    this._cc = [];
    this._approversSource = '';
    this._submitted = false;
    this._existingRequest = null;
    this._isResending = false;
    this._isWithdrawing = false;
  }

  connectedCallback() {
    super.connectedCallback();
    if (styles) {
      this.shadowRoot.adoptedStyleSheets = [styles];
    }
    this.init();
  }

  get contentPath() {
    // Remove org/site prefix to get the content path
    return this.path.replace(/^\/[^/]+\/[^/]+/, '');
  }

  get previewUrl() {
    // Build AEM preview URL: https://main--<site>--<org>.aem.page/<path>
    const { org, repo: site } = this.context;
    return `https://main--${site}--${org}.aem.page${this.contentPath}`;
  }

  get diffUrl() {
    // Use the Page Status diff tool with embed mode for clean iframe display
    // https://tools.aem.live/tools/page-status/diff.html?org={org}&site={site}&path={path}&embed=true
    const { org, repo: site } = this.context;
    return `https://tools.aem.live/tools/page-status/diff.html?org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}&path=${encodeURIComponent(this.contentPath)}`;
  }

  get requesterPendingRequestsUrl() {
    const { org, repo: site } = this.context;
    return `https://da.live/app/aemsites/da-blog-tools/tools/apps/publish-requests-inbox/publish-requests-inbox?org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}&requester=true`;
  }

  async init() {
    this._isLoading = true;

    // Fetch user email from Adobe IMS profile
    this._userEmail = await getUserEmail(this.token);

    // Detect approvers for this content path
    const { org, repo: site } = this.context;
    const result = await detectApprovers(this.contentPath, org, site, this.token);
    this._approvers = result.approvers || [];
    this._cc = result.cc || [];
    this._approversSource = result.source || 'unknown';

    // Show error if config is missing or no matching rule found
    if (result.error) {
      this._message = { type: 'error', text: result.error };
      this._isLoading = false;
      return;
    }

    // Check if there's already a pending request for this path by this user
    if (this._userEmail) {
      this._existingRequest = await checkExistingRequest(
        org, site, this.contentPath, this._userEmail, this.token,
      );
    }

    // Sample RUM enhancer if the RUM script is loaded
    window.hlx?.rum?.sampleRUM?.enhance?.();

    sampleRUM('request-for-publish:loaded', { source: this.contentPath });
    this._isLoading = false;
  }

  async handleSubmit(e) {
    e.preventDefault();
    if (this._isSubmitting) return;
    this._isSubmitting = true;
    this._message = null;

    const form = this.shadowRoot.querySelector('form');
    const formData = new FormData(form);
    const comment = formData.get('comment');

    // Use auto-fetched email from IMS profile
    const authorEmail = this._userEmail;
    if (!authorEmail) {
      this._isSubmitting = false;
      this._message = { type: 'error', text: 'Could not determine your email. Please try again.' };
      return;
    }

    const { org, repo: site } = this.context;

    const result = await submitPublishRequest(
      {
        org,
        site,
        path: this.contentPath,
        previewUrl: this.previewUrl,
        authorEmail,
        comment,
        approvers: this._approvers,
        cc: this._cc,
      },
      this.token,
    );

    this._isSubmitting = false;

    if (result.success) {
      this._message = { type: 'success', text: 'Publish request sent! Approvers have been notified.' };
      this._submitted = true;
    } else {
      this._message = { type: 'error', text: result.message };
    }
  }

  async handleResend() {
    if (this._isResending) return;
    this._isResending = true;
    this._message = null;

    const { org, repo: site } = this.context;

    const result = await resendPublishRequest(
      {
        org,
        site,
        path: this.contentPath,
        previewUrl: this.previewUrl,
        authorEmail: this._userEmail,
        approvers: this._approvers,
        cc: this._cc,
      },
      this.token,
    );

    this._isResending = false;

    if (result.success) {
      this._message = { type: 'success', text: 'Publish request re-sent to approvers.' };
    } else {
      this._message = { type: 'error', text: result.message };
    }
  }

  async handleWithdraw() {
    if (this._isWithdrawing) return;
    this._isWithdrawing = true;
    this._message = null;

    const { org, repo: site } = this.context;

    const result = await withdrawPublishRequest(
      org, site, this.contentPath, this._userEmail, this.token,
    );

    this._isWithdrawing = false;

    if (result.success) {
      this._existingRequest = null;
      this._message = { type: 'success', text: 'Publish request withdrawn successfully.' };
    } else {
      this._message = { type: 'error', text: result.error || 'Failed to withdraw request.' };
    }
  }

  renderLoading() {
    return html`
      <div class="loading-container">
        <div class="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    `;
  }

  renderMessage() {
    if (!this._message) return nothing;
    return html`<div class="message ${this._message.type}">${this._message.text}</div>`;
  }

  renderExistingRequest() {
    const actionDisabled = this._isResending || this._isWithdrawing;
    return html`
      <div class="result-container pending">
        <div class="result-icon"></div>
        <h3>Request Pending</h3>
        <p>You already have a pending publish request for this content. Please wait while your request is reviewed.</p>
        <div class="info-card">
          <div class="info-row">
            <span class="label">Content Path:</span>
            <code>${this._existingRequest.path}</code>
          </div>
          <div class="info-row">
            <span class="label">Approver:</span>
            <code>${this._existingRequest.approver}</code>
          </div>
          <div class="info-row">
            <span class="label">Status:</span>
            <code>${this._existingRequest.status}</code>
          </div>
        </div>

        ${this.renderMessage()}

        <div class="form-actions">
          <button
            class="btn-primary"
            @click=${this.handleResend}
            ?disabled=${actionDisabled}
          >
            ${this._isResending ? 'Resending...' : 'Resend Publish Request'}
          </button>
          <button
            class="btn-secondary btn-withdraw"
            @click=${this.handleWithdraw}
            ?disabled=${actionDisabled}
          >
            ${this._isWithdrawing ? 'Withdrawing...' : 'Withdraw Publish Request'}
          </button>
        </div>

        <p class="result-note">If your content owner is away please contact <a href="mailto:digiops@westernsydney.edu.au">digiops@westernsydney.edu.au</a> for assistance with content approvals.</p>
      </div>
    `;
  }

  renderSubmitted() {
    return html`
      <div class="result-container success">
        <div class="result-icon"></div>
        <h3>Request Sent!</h3>
        <p>Your publish request has been sent to the following approvers:</p>
        <ul class="approvers-list">
          ${this._approvers.map((approver) => html`<li>${approver}</li>`)}
        </ul>
        ${this._cc.length > 0 ? html`
          <p style="margin-top: 8px;">CC'd:</p>
          <ul class="approvers-list">
            ${this._cc.map((email) => html`<li>${email}</li>`)}
          </ul>
        ` : nothing}
        <p class="result-note">You will receive an email when your request is approved or rejected.</p>
        <p class="my-pending-requests-link">
          <a target="_blank" rel="noopener" href="${this.requesterPendingRequestsUrl}">View all my pending publish requests ↗</a>
        </p>
      </div>
    `;
  }

  renderForm() {
    return html`
      <div class="form-container">
        <h3>Request Publish</h3>
        <p class="form-subtitle">Submit this website update for approval</p>

        <div class="info-card">
          <div class="info-row">
            <span class="label">Page URL:</span>
            <code>${this.contentPath}</code>
          </div>
           <div class="info-row">
              <span class="label">Requested By:</span>
              <code>${this._userEmail}</code>
          </div>
          <div class="info-row">
            <span class="label">Preview Page URL:</span>
            <a href="${this.previewUrl}" target="_blank" rel="noopener">
              View Preview ↗
            </a>
          </div>
        </div>

        <div class="diff-section">
          <div class="diff-header">
            <span class="diff-title">Content Changes</span>
          </div>
          <p class="diff-description">
            Before submitting for approval please carefully proofread and review your edits. Have you been SMART? <br />
            S – Streamline Site Structure <br />
            M – Metadata for SEO <br />
            A – Accessibility compliant <br />
            R – Redirects requested <br />
            T – Tested all links <br />
           <a href="${this.diffUrl}" target="_blank" rel="noopener" class="open-diff-link">View Existing Page↗</a>
          </p>
          <!--<div class="diff-iframe-container">
            <iframe
              src="${this.diffUrl}"
              class="diff-iframe"
              title="Content Diff"
              sandbox="allow-scripts allow-same-origin allow-popups"
            ></iframe>
          </div> -->
        </div>

        <div class="approvers-section">
          <div class="approvers-header">
            <span class="approvers-icon"></span>
            <span class="approvers-title">Will be reviewed by:</span>
          </div>
          <ul class="approvers-list">
            ${this._approvers.map((approver) => html`<li>${approver}</li>`)}
          </ul>
          ${this._cc.length > 0 ? html`
            <div class="approvers-header" style="margin-top: 8px;">
              <span class="approvers-icon"></span>
              <span class="approvers-title">CC:</span>
            </div>
            <ul class="approvers-list">
              ${this._cc.map((email) => html`<li>${email}</li>`)}
            </ul>
          ` : nothing}
        </div>

        ${this.renderMessage()}


        <form @submit=${this.handleSubmit}>
          <div class="form-group">
            <label for="comment">Please provide a description of your website content changes and reason for the content update.</label>
            <textarea
              id="comment"
              name="comment"
              placeholder="Overview of the website updates and context for the content update request."
              rows="3"
            ></textarea>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn-primary btn-large" ?disabled=${this._isSubmitting}>
              ${this._isSubmitting ? 'Submitting...' : 'Request Publish'}
            </button>
          </div>
        </form>
      </div>
    `;
  }

  render() {
    if (this._isLoading) {
      return this.renderLoading();
    }

    if (this._submitted) {
      return this.renderSubmitted();
    }

    if (this._existingRequest) {
      return this.renderExistingRequest();
    }

    return this.renderForm();
  }
}

customElements.define('request-for-publish', RequestForPublishPlugin);

/**
 * Self-initialize when loaded as HTML (fullsize-dialog mode)
 * This runs when the script is loaded directly via the HTML file
 */
(async function initAsDialog() {
  console.log('[Request Publish Plugin] Initializing...');

  // Only run if we're in a browser context with a body
  if (typeof window === 'undefined' || !document.body) {
    console.log('[Request Publish Plugin] No window or body, skipping');
    return;
  }

  try {
    // Wait for DA SDK
    console.log('[Request Publish Plugin] Waiting for DA SDK...');
    const { context, token } = await DA_SDK;
    console.log('[Request Publish Plugin] Got SDK context:', context);

    const { org, repo: site, path } = context;

    // Create and append the component
    const cmp = document.createElement('request-for-publish');
    cmp.context = context;
    cmp.path = `/${org}/${site}${path}`;
    cmp.token = token;

    console.log('[Request Publish Plugin] Appending component to body');
    document.body.append(cmp);
  } catch (error) {
    console.error('[Request Publish Plugin] Initialization error:', error);
  }
}());

/**
 * DA Plugin export - for Sidekick panel mode (not currently used)
 * @param {Object} sdk - The DA SDK with context, token, actions
 * @returns {Object} Plugin configuration
 */
export default async function init({ context, token }) {
  return {
    title: 'Request Publish',
    searchEnabled: false,
    panel: {
      render: (container) => {
        const { org, repo: site, path } = context;
        const cmp = document.createElement('request-for-publish');
        cmp.context = context;
        cmp.path = `/${org}/${site}${path}`;
        cmp.token = token;
        container.append(cmp);
      },
    },
  };
}
