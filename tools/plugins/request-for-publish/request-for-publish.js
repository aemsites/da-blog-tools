/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console */
/* eslint-disable class-methods-use-this, function-paren-newline */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import {
  resolveWorkflowConfig,
  previewContent,
  submitPublishRequest,
  resendPublishRequest,
  withdrawPublishRequest,
  getUserEmail,
  checkExistingRequest,
} from './utils.js';

// Super Lite (sl-*) — Spectrum-aligned controls for DA; pairs with S2 tokens in CSS.
// NX style pipeline matches other da.live shell apps: nexter.js loadStyle + getStyle.
const NX = 'https://da.live/nx';
let nexter = null;
let sl = null;
let styles = null;
let buttons = null;
try {
  const [{ default: getStyle }, { loadStyle }] = await Promise.all([
    import(`${NX}/utils/styles.js`),
    import(`${NX}/scripts/nexter.js`),
  ]);
  await Promise.all([
    loadStyle(`${NX}/styles/nexter.css`),
    loadStyle(`${NX}/public/sl/styles.css`),
  ]);
  await import(`${NX}/public/sl/components.js`);
  [nexter, sl, styles, buttons] = await Promise.all([
    getStyle(`${NX}/styles/nexter.css`),
    getStyle(`${NX}/public/sl/styles.css`),
    getStyle(import.meta.url),
    getStyle(`${NX}/styles/buttons.css`),
  ]);
} catch (e) {
  console.warn('Failed to load styles:', e);
}

// RUM helper – safely fires a checkpoint if the RUM script is loaded
function sampleRUM(checkpoint, data = {}) {
  try {
    window.hlx?.rum?.sampleRUM?.(checkpoint, data);
  } catch { /* noop */ }
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
    _withdrawn: { state: true },
    _commentsRequired: { state: true },
    _commentsMinLength: { state: true },
    _submitPhase: { state: true },
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
    this._withdrawn = false;
    this._commentsRequired = false;
    this._commentsMinLength = 10;
    this._submitPhase = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [nexter, sl, buttons, styles].filter(Boolean);
    this.init();
  }

  get contentPath() {
    // Remove org/site prefix to get the content path
    return this.path.replace(/^\/[^/]+\/[^/]+/, '');
  }

  get previewUrl() {
    // Build AEM preview URL: https://main--<site>--<org>.aem.page/<path>
    const { org, repo: site } = this.context;
    const path = this.contentPath?.replace(/\/index$/, '') || '';
    return `https://main--${site}--${org}.aem.page${path}`;
  }

  get diffUrl() {
    // Use the Page Status diff tool with embed mode for clean iframe display
    // https://tools.aem.live/tools/page-status/diff.html?org={org}&site={site}&path={path}&embed=true
    const { org, repo: site } = this.context;
    return `https://tools.aem.live/tools/page-status/diff.html?org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}&path=${encodeURIComponent(this.contentPath)}`;
  }

  get _submitButtonLabel() {
    if (this._submitPhase === 'previewing') return 'Previewing content...';
    if (this._submitPhase === 'submitting') return 'Submitting request...';
    return 'Request Publish';
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
    const result = await resolveWorkflowConfig(this.contentPath, org, site, this.token);
    this._approvers = result.approvers || [];
    this._cc = result.cc || [];
    this._approversSource = result.source || 'unknown';
    this._commentsRequired = result.commentsRequired || false;
    this._commentsMinLength = result.commentsMinLength ?? 10;

    if (result.accentColor) {
      this.style.setProperty('--pw-accent', result.accentColor);
    }
    if (result.accentColorHover) {
      this.style.setProperty('--pw-accent-hover', result.accentColorHover);
    }

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

  async handleSubmit() {
    if (this._isSubmitting) return;
    this._isSubmitting = true;
    this._message = null;

    const textarea = this.shadowRoot.querySelector('#comment');
    const comment = (textarea?.value ?? '').trim();

    if (this._commentsRequired && comment.length < this._commentsMinLength) {
      this._isSubmitting = false;
      this._message = { type: 'error', text: `Please provide a description of at least ${this._commentsMinLength} characters.` };
      return;
    }

    const authorEmail = this._userEmail;
    if (!authorEmail) {
      this._isSubmitting = false;
      this._message = { type: 'error', text: 'Could not determine your email. Please try again.' };
      return;
    }

    const { org, repo: site } = this.context;

    // Preview content first so .aem.page is up to date for approvers
    this._submitPhase = 'previewing';
    await previewContent(org, site, this.contentPath);

    this._submitPhase = 'submitting';
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
    this._submitPhase = '';

    if (result.success) {
      this._submitted = true;
      if (result.sheetWriteError) {
        this._message = { type: 'warning', text: 'An email was sent to approvers, but your request could not be logged because you do not have write access. Please reach out to your site administrator for help.' };
      } else {
        this._message = { type: 'success', text: 'Publish request sent! Approvers have been notified.' };
      }
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
      this._withdrawn = true;
    } else {
      this._message = { type: 'error', text: result.error || 'Failed to withdraw request.' };
    }
  }

  renderLoading() {
    return html`
      <div class="loading-container" role="status" aria-live="polite" aria-busy="true">
        <div class="spectrum-loading-indicator" aria-hidden="true"></div>
        <p class="loading-label">Loading…</p>
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
      <div class="status-page">
        <div class="status-icon status-icon--neutral">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 15a1 1 0 1 1 1-1 1 1 0 0 1-1 1Zm1-4.5a1 1 0 0 1-2 0v-4a1 1 0 0 1 2 0Z" fill="currentColor"/></svg>
        </div>
        <h3 class="status-heading">Request Pending</h3>
        <p class="status-body">You already have a pending publish request for this content. Please wait while your request is reviewed.</p>

        <section class="review-card">
          <dl class="detail-list">
            <div class="detail-row">
              <dt>Content</dt>
              <dd><code>${this._existingRequest.path}</code></dd>
            </div>
            <div class="detail-row">
              <dt>Approver</dt>
              <dd><code>${this._existingRequest.approver}</code></dd>
            </div>
            <div class="detail-row">
              <dt>Status</dt>
              <dd><code>${this._existingRequest.status}</code></dd>
            </div>
          </dl>
        </section>

        ${this.renderMessage()}

        <div class="status-actions">
          <sl-button
            class="pw-fill-accent"
            @click=${this.handleResend}
            ?disabled=${actionDisabled}
          >
            ${this._isResending ? 'Resending...' : 'Resend Publish Request'}
          </sl-button>
          <sl-button
            class="pw-fill-negative"
            @click=${this.handleWithdraw}
            ?disabled=${actionDisabled}
          >
            ${this._isWithdrawing ? 'Withdrawing...' : 'Withdraw Publish Request'}
          </sl-button>
        </div>

        <p class="status-note">If your content owner is away please contact <a href="mailto:digiops@westernsydney.edu.au">digiops@westernsydney.edu.au</a> for assistance with content approvals.</p>
      </div>
    `;
  }

  renderWithdrawn() {
    return html`
      <div class="status-page">
        <div class="status-icon status-icon--success">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 17.5L3.5 11.5l1.41-1.41L9.5 14.67l9.59-9.59L20.5 6.5z" fill="currentColor"/></svg>
        </div>
        <h3 class="status-heading status-heading--success">Request Withdrawn</h3>
        <p class="status-body">Your publish request for <strong>${this.contentPath}</strong> has been withdrawn successfully.</p>
        <p class="status-note">You can submit a new publish request at any time.</p>
      </div>
    `;
  }

  renderSubmitted() {
    return html`
      <div class="status-page">
        <div class="status-icon status-icon--success">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 17.5L3.5 11.5l1.41-1.41L9.5 14.67l9.59-9.59L20.5 6.5z" fill="currentColor"/></svg>
        </div>
        <h3 class="status-heading status-heading--success">Request Sent!</h3>
        <p class="status-body">Your publish request has been sent to the following approvers:</p>

        <section class="review-card">
          <ul class="approvers-list">
            ${this._approvers.map((approver) => html`<li><code>${approver}</code></li>`)}
          </ul>
          ${this._cc.length > 0 ? html`
            <h4 class="review-card-title cc-title">CC'd</h4>
            <ul class="approvers-list">
              ${this._cc.map((email) => html`<li><code>${email}</code></li>`)}
            </ul>
          ` : nothing}
        </section>

        ${this.renderMessage()}
        <p class="status-note">You will receive an email when your request is approved or rejected.</p>
        <p class="status-note">
          <a target="_blank" rel="noopener" href="${this.requesterPendingRequestsUrl}" class="action-link">
            <svg class="action-icon" viewBox="0 0 18 18"><path d="M15.5 1h-13A1.5 1.5 0 0 0 1 2.5v13A1.5 1.5 0 0 0 2.5 17h13a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 15.5 1Zm.5 14.5a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 .5.5v13ZM13 4.5a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 0-.354.854L9.793 6.5 5.146 11.146a.5.5 0 0 0 .708.708L10.5 7.207l1.646 1.647A.5.5 0 0 0 13 8.5v-4Z"/></svg>
            View all my pending publish requests
          </a>
        </p>
      </div>
    `;
  }

  renderForm() {
    return html`
      <div class="form-container">
        <header class="form-header">
          <h3>Request Publish</h3>
          <p class="form-subtitle">Submit this website update for approval</p>
        </header>

        <section class="review-card">
          <h4 class="review-card-title">Request Details</h4>
          <dl class="detail-list">
            <div class="detail-row">
              <dt>Page</dt>
              <dd><code>${this.contentPath}</code></dd>
            </div>
            <div class="detail-row">
              <dt>Requested by</dt>
              <dd><code>${this._userEmail}</code></dd>
            </div>
            <div class="detail-row">
              <dt>Preview</dt>
              <dd>
                <a href="${this.previewUrl}" target="_blank" rel="noopener" class="action-link">
                  <svg class="action-icon" viewBox="0 0 18 18"><path d="M15.5 1h-13A1.5 1.5 0 0 0 1 2.5v13A1.5 1.5 0 0 0 2.5 17h13a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 15.5 1Zm.5 14.5a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 .5.5v13ZM13 4.5a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 0-.354.854L9.793 6.5 5.146 11.146a.5.5 0 0 0 .708.708L10.5 7.207l1.646 1.647A.5.5 0 0 0 13 8.5v-4Z"/></svg>
                  View Preview
                </a>
              </dd>
            </div>
          </dl>
        </section>

        <section class="review-card">
          <h4 class="review-card-title">Content Changes</h4>
          <p class="review-card-body">Before submitting, please proofread and review your edits. Have you been SMART?</p>
          <ul class="smart-checklist">
            <li><strong>S</strong> Streamline Site Structure</li>
            <li><strong>M</strong> Metadata for SEO</li>
            <li><strong>A</strong> Accessibility compliant</li>
            <li><strong>R</strong> Redirects requested</li>
            <li><strong>T</strong> Tested all links</li>
          </ul>
          <a href="${this.diffUrl}" target="_blank" rel="noopener" class="action-link">
            <svg class="action-icon" viewBox="0 0 18 18"><path d="M16.5 1h-15A1.5 1.5 0 0 0 0 2.5v13A1.5 1.5 0 0 0 1.5 17h15a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 16.5 1ZM9 16H1.5a.5.5 0 0 1-.5-.5V3h8v13Zm8-.5a.5.5 0 0 1-.5.5H10V3h7v12.5Z"/></svg>
            View Existing Page
          </a>
        </section>

        <section class="review-card">
          <h4 class="review-card-title">Will be reviewed by</h4>
          <ul class="approvers-list">
            ${this._approvers.map((approver) => html`<li><code>${approver}</code></li>`)}
          </ul>
          ${this._cc.length > 0 ? html`
            <h4 class="review-card-title cc-title">CC</h4>
            <ul class="approvers-list">
              ${this._cc.map((email) => html`<li><code>${email}</code></li>`)}
            </ul>
          ` : nothing}
        </section>

        <div class="form-group">
          <label for="comment">Please provide a description of your website content changes and reason for the content update.${this._commentsRequired ? html` <span class="required-marker">*</span>` : nothing}</label>
          <sl-textarea
            id="comment"
            placeholder="Overview of the website updates and context for the content update request."
            rows="3"
          ></sl-textarea>
          ${this._commentsRequired ? html`<span class="field-hint">Minimum ${this._commentsMinLength} characters required.</span>` : nothing}
        </div>

        ${this.renderMessage()}

        <div class="form-actions">
          <sl-button
            class="pw-fill-accent"
            @click=${() => this.handleSubmit()}
            ?disabled=${this._isSubmitting}
          >
            ${this._submitButtonLabel}
          </sl-button>
        </div>
      </div>
    `;
  }

  render() {
    if (this._isLoading) {
      return this.renderLoading();
    }

    if (this._withdrawn) {
      return this.renderWithdrawn();
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
