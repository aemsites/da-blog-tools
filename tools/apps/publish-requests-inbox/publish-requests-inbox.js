/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console */
/* eslint-disable class-methods-use-this, function-paren-newline, indent */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import {
  getUserEmail,
  publishContent,
  bulkPublishContent,
  pollJobStatus,
  notifyRejection,
  notifyPublished,
  checkPublishRequest,
  removePublishRequest,
  removeMultiplePublishRequests,
  getApproversForPath,
  getAllPendingRequestsForUser,
  getAllPendingRequestsByRequester,
  resendPublishRequest,
} from './api.js';

// Super Lite components
import 'https://da.live/nx/public/sl/components.js';

// Application styles
import loadStyle from '../../scripts/utils/styles.js';

// RUM helper – safely fires a checkpoint if the RUM script is loaded
function sampleRUM(checkpoint, data = {}) {
  try {
    window.hlx?.rum?.sampleRUM?.(checkpoint, data);
  } catch { /* noop */ }
}

const styles = await loadStyle(import.meta.url);

class PublishRequestsApp extends LitElement {
  static properties = {
    context: { attribute: false },
    token: { attribute: false },
    // view states: 'loading', 'site-select', 'inbox', 'review', 'approved',
    //               'rejected', 'error', 'unauthorized', 'no-request'
    _state: { state: true },
    _isProcessing: { state: true },
    _message: { state: true },
    _userEmail: { state: true },
    _needsEmail: { state: true },
    // Request data from URL params
    _org: { state: true },
    _repo: { state: true },
    _path: { state: true },
    _authorEmail: { state: true },
    _previewUrl: { state: true },
    _comment: { state: true },
    _requester: { state: true },
    // Inbox mode
    _pendingRequests: { state: true },
    _processingPaths: { state: true },
    _approveAllProcessing: { state: true },
    // My-requests mode: tracks per-path action ('resending' | 'withdrawing')
    _myRequestActions: { state: true },
    // Site selection form
    _siteSelectLoading: { state: true },
  };

  constructor() {
    super();
    this._state = 'loading';
    this._isProcessing = false;
    this._message = null;
    this._userEmail = '';
    this._needsEmail = false;
    this._org = '';
    this._repo = '';
    this._path = '';
    this._authorEmail = '';
    this._previewUrl = '';
    this._comment = '';
    this._pendingRequests = [];
    this._processingPaths = new Set();
    this._approveAllProcessing = false;
    this._requester = false;
    this._myRequestActions = new Map();
    this._siteSelectLoading = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [styles];
    this.init();
  }

  /**
   * Build the parent DA app base URL from the context.
   * Since this app runs inside a DA iframe, window.location reflects the
   * iframe origin, not the parent DA URL. The context provides the host
   * org/repo used to construct the parent-level DA app path.
   */
  get appBaseUrl() {
    const { org, repo } = this.context || {};
    const appPath = 'tools/apps/publish-requests-inbox/publish-requests-inbox';
    return `https://da.live/app/${org}/${repo}/${appPath}`;
  }

  get liveUrl() {
    // Build live URL: https://main--<repo>--<org>.aem.live/<path>
    return `https://main--${this._repo}--${this._org}.aem.live${this._path}`;
  }

  get diffUrl() {
    // Use the Page Status diff tool with embed mode for clean iframe display
    return `https://tools.aem.live/tools/page-status/diff.html?org=${encodeURIComponent(this._org)}&site=${encodeURIComponent(this._repo)}&path=${encodeURIComponent(this._path)}`;
  }

  getDiffUrlForPath(path) {
    return `https://tools.aem.live/tools/page-status/diff.html?org=${encodeURIComponent(this._org)}&site=${encodeURIComponent(this._repo)}&path=${encodeURIComponent(path)}`;
  }

  getReviewUrl(request) {
    const params = new URLSearchParams();
    params.set('org', this._org);
    params.set('repo', this._repo);
    params.set('path', request.path);
    if (request.requester) params.set('author', request.requester);
    // Build preview URL for the request path
    const previewUrl = `https://main--${this._repo}--${this._org}.aem.page${request.path}`;
    params.set('preview', previewUrl);
    return `${this.appBaseUrl}?${params.toString()}`;
  }

  getInboxUrl() {
    const params = new URLSearchParams();
    params.set('org', this._org);
    params.set('repo', this._repo);
    return `${this.appBaseUrl}?${params.toString()}`;
  }

  /**
   * Navigate the top-level (parent) browser window to the given URL.
   * Since this app runs inside an iframe, we must use window.top to
   * change the main browser URL.
   */
  navigateTop(url, e) {
    if (e) e.preventDefault();
    try {
      window.top.location.href = url;
    } catch {
      // Cross-origin fallback
      window.location.href = url;
    }
  }

  async init() {
    // Fetch user email from Adobe IMS profile
    this._userEmail = await getUserEmail(this.token);
    this._needsEmail = !this._userEmail;

    // Parse URL parameters
    const urlParams = new URLSearchParams(window.location.search);

    // Only use explicit URL params for org/repo — do NOT fall back to
    // this.context because that reflects the *current* DA site the app is
    // hosted on, not the site the user wants to manage.
    this._org = urlParams.get('org') || '';
    this._repo = urlParams.get('repo') || '';
    this._path = urlParams.get('path') || '';
    this._authorEmail = urlParams.get('author') || '';
    this._previewUrl = urlParams.get('preview') || '';
    this._comment = urlParams.get('comment') || '';
    this._requester = urlParams.get('requester') || false;

    // If org/repo are missing, show the site selection form
    if (!this._org || !this._repo) {
      this._state = 'site-select';
      return;
    }

    // Sample RUM enhancer if the RUM script is loaded
    window.hlx?.rum?.sampleRUM?.enhance?.();

    sampleRUM('publish-requests-app:loaded', { source: window.location.href });

    // If no path specified → inbox or my-requests mode
    if (!this._path) {
      if (this._requester) {
        await this.initMyRequests();
      } else {
        await this.initInbox();
      }
      return;
    }

    // Path specified → single-request review mode
    await this.initReview();
  }

  /**
   * Initialize inbox mode: fetch all pending requests the user can approve
   */
  async initInbox() {
    if (this._needsEmail) {
      this._state = 'error';
      this._message = { type: 'error', text: 'Unable to determine your email. Please log in to DA first.' };
      return;
    }

    try {
      const requests = await getAllPendingRequestsForUser(
        this._org, this._repo, this._userEmail, this.token,
      );

      this._pendingRequests = requests;
      this._state = 'inbox';
    } catch (error) {
      console.error('Error initializing inbox:', error);
      this._state = 'error';
      this._message = { type: 'error', text: error.message };
    }
  }

  /**
   * Initialize my-requests mode: fetch all pending requests submitted by the current user
   */
  async initMyRequests() {
    if (this._needsEmail) {
      this._state = 'error';
      this._message = { type: 'error', text: 'Unable to determine your email. Please log in to DA first.' };
      return;
    }

    try {
      const requests = await getAllPendingRequestsByRequester(
        this._org, this._repo, this._userEmail, this.token,
      );

      this._pendingRequests = requests;
      this._state = 'my-requests';
    } catch (error) {
      console.error('Error loading my requests:', error);
      this._state = 'error';
      this._message = { type: 'error', text: error.message };
    }
  }

  /**
   * Initialize single-request review mode (existing behavior)
   */
  async initReview() {
    // Check if this path has a pending publish request in the requests sheet
    const pendingRequest = await checkPublishRequest(this._org, this._repo, this._path, this.token);
    if (!pendingRequest) {
      this._state = 'no-request';
      this._message = { type: 'error', text: 'No pending publish request found for this content path.' };
      return;
    }

    // Use requester from sheet if author not in URL params
    if (!this._authorEmail && pendingRequest.requester) {
      this._authorEmail = pendingRequest.requester;
    }

    // Check if the current user is an authorized approver for this content path
    if (this._userEmail) {
      try {
        const approvers = await getApproversForPath(this._org, this._repo, this._path, this.token);
        const normalizedUser = this._userEmail.toLowerCase();
        const isApprover = approvers.some((a) => a.toLowerCase() === normalizedUser);
        if (!isApprover) {
          this._state = 'unauthorized';
          this._message = {
            type: 'error',
            text: `You (${this._userEmail}) are not authorized to approve or reject this request. Only the following approvers can act on this content: ${approvers.join(', ')}`,
          };
          return;
        }
      } catch (error) {
        console.error('Error checking approvers:', error);
        this._state = 'error';
        this._message = { type: 'error', text: error.message };
        return;
      }
    }

    this._state = 'review';
  }

  // ======== Site selection handler ========

  async handleSiteSelect(e) {
    e.preventDefault();
    this._message = null;

    const form = this.shadowRoot.querySelector('#site-select-form');
    const formData = new FormData(form);
    const org = formData.get('org')?.trim();
    const repo = formData.get('repo')?.trim();

    if (!org || !repo) {
      this._message = { type: 'error', text: 'Please provide both Organization and Repository.' };
      return;
    }

    this._siteSelectLoading = true;

    // Fetch user email first (needed for permission check)
    if (!this._userEmail) {
      this._userEmail = await getUserEmail(this.token);
      this._needsEmail = !this._userEmail;
    }

    if (this._needsEmail) {
      this._siteSelectLoading = false;
      this._message = { type: 'error', text: 'Unable to determine your email. Please log in to DA first.' };
      return;
    }

    // Fetch pending requests — route based on requester vs approver mode
    try {
      const isRequesterMode = !!this._requester;
      const requests = isRequesterMode
        ? await getAllPendingRequestsByRequester(org, repo, this._userEmail, this.token)
        : await getAllPendingRequestsForUser(org, repo, this._userEmail, this.token);

      // If we got here without error, the user has access
      this._org = org;
      this._repo = repo;
      this._pendingRequests = requests;

      // Update URL params so the user can bookmark/share
      const url = new URL(window.location.href);
      url.searchParams.set('org', org);
      url.searchParams.set('repo', repo);
      try {
        window.top.history.replaceState({}, '', url.toString());
      } catch {
        // Cross-origin iframe — update own history instead
        window.history.replaceState({}, '', url.toString());
      }

      this._siteSelectLoading = false;
      this._state = isRequesterMode ? 'my-requests' : 'inbox';
    } catch (error) {
      this._siteSelectLoading = false;
      this._message = { type: 'error', text: error.message || `Unable to access site "${org}/${repo}". Please check the organization and repository names.` };
    }
  }

  // ======== Single-request action handlers ========

  async handleApprove() {
    // guard against re-entry before Lit re-render disables the button
    if (this._isProcessing) return;
    if (this._needsEmail) {
      this._message = { type: 'error', text: 'Unable to determine your email. Please log in again.' };
      return;
    }

    this._isProcessing = true;
    this._message = null;

    try {
      // Publish the content via Helix Admin API
      const result = await publishContent(this._org, this._repo, this._path);

      if (result.success) {
        // Remove the pending request from the requests sheet
        await removePublishRequest(this._org, this._repo, this._path, this.token);

        // Notify the author that their content has been published
        if (this._authorEmail) {
          notifyPublished(
            {
              org: this._org,
              repo: this._repo,
              paths: [{ path: this._path, authorEmail: this._authorEmail }],
              approverEmail: this._userEmail,
            },
            this.token,
          ).catch((err) => console.warn('Failed to send publish notification:', err));
        }

        this._state = 'approved';
        this._message = { type: 'success', text: 'Content published successfully!' };
      } else {
        this._message = { type: 'error', text: result.error };
      }
    } finally {
      this._isProcessing = false;
    }
  }

  async handleReject(e) {
    e.preventDefault();

    if (this._needsEmail) {
      this._message = { type: 'error', text: 'Unable to determine your email. Please log in again.' };
      return;
    }

    const form = this.shadowRoot.querySelector('#reject-form');
    const formData = new FormData(form);
    const reason = formData.get('reason')?.trim();

    if (!reason) {
      this._message = { type: 'error', text: 'Please provide a reason for rejection.' };
      return;
    }

    this._isProcessing = true;
    this._message = null;

    // Send rejection notification
    const result = await notifyRejection(
      {
        org: this._org,
        repo: this._repo,
        path: this._path,
        authorEmail: this._authorEmail,
        rejecterEmail: this._userEmail,
        reason,
      },
      this.token,
    );

    this._isProcessing = false;

    if (result.success) {
      // Remove the pending request from the requests sheet
      await removePublishRequest(this._org, this._repo, this._path, this.token);
      this._state = 'rejected';
      this._message = { type: 'info', text: 'Rejection notification sent to author.' };
    } else {
      this._message = { type: 'error', text: result.error };
    }
  }

  // ======== Inbox action handlers ========

  async handleInboxApprove(request) {
    if (this._processingPaths.has(request.path)) return; // guard against re-entry
    this._processingPaths = new Set([...this._processingPaths, request.path]);
    this.requestUpdate();

    const result = await publishContent(this._org, this._repo, request.path);

    if (result.success) {
      await removePublishRequest(this._org, this._repo, request.path, this.token);

      // Notify the author that their content has been published
      const authorEmail = request.requester || request.authorEmail;
      if (authorEmail) {
        notifyPublished(
          {
            org: this._org,
            repo: this._repo,
            paths: [{ path: request.path, authorEmail }],
            approverEmail: this._userEmail,
          },
          this.token,
        ).catch((err) => console.warn('Failed to send publish notification:', err));
      }

      this._pendingRequests = this._pendingRequests.filter((r) => r.path !== request.path);
      this._message = { type: 'success', text: `Published: ${request.path}` };
    } else {
      this._message = { type: 'error', text: `Failed to publish ${request.path}: ${result.error}` };
    }

    const updated = new Set(this._processingPaths);
    updated.delete(request.path);
    this._processingPaths = updated;
  }

  async handleApproveAll() {
    if (this._pendingRequests.length === 0) return;

    this._approveAllProcessing = true;
    this._message = null;

    const allPaths = this._pendingRequests.map((r) => r.path);
    const totalCount = allPaths.length;

    // Use bulk publish API for all paths in a single request
    // https://www.aem.live/docs/admin.html#tag/publish/operation/bulkPublish
    this._message = { type: 'info', text: `Starting bulk publish of ${totalCount} pages...` };
    this.requestUpdate();

    const bulkResult = await bulkPublishContent(this._org, this._repo, allPaths);

    if (!bulkResult.success) {
      this._approveAllProcessing = false;
      this._message = { type: 'error', text: `Bulk publish failed: ${bulkResult.error}` };
      return;
    }

    // Poll the job until it completes using the self link from the response
    const jobSelfUrl = bulkResult.links?.self;
    if (jobSelfUrl) {
      this._message = { type: 'info', text: 'Bulk publish job started. Waiting for completion...' };
      this.requestUpdate();

      const jobResult = await pollJobStatus(jobSelfUrl);

      if (!jobResult.success) {
        this._approveAllProcessing = false;
        this._message = {
          type: 'error',
          text: `Bulk publish job did not complete in time. Some pages may still be publishing. ${jobResult.error || ''}`,
        };
        return;
      }

      // Check for any failures in the job details
      const jobData = jobResult.job;
      // 200 = published, 304 = already up-to-date — both are success
      const failedResources = jobData?.data?.resources
        ?.filter((r) => r.status !== 200 && r.status !== 304) || [];

      if (failedResources.length > 0) {
        const failedPaths = failedResources.map((r) => r.path);
        const succeededPaths = allPaths.filter((p) => !failedPaths.includes(p));

        // Remove only succeeded requests from the sheet in one write
        if (succeededPaths.length > 0) {
          await removeMultiplePublishRequests(this._org, this._repo, succeededPaths, this.token);

          // Notify authors of successfully published pages
          const succeededSet = new Set(succeededPaths);
          const succeededEntries = this._pendingRequests
            .filter((r) => succeededSet.has(r.path))
            .map((r) => ({ path: r.path, authorEmail: r.requester || r.authorEmail }));
          if (succeededEntries.length > 0) {
            notifyPublished(
              {
                org: this._org,
                repo: this._repo,
                paths: succeededEntries,
                approverEmail: this._userEmail,
              },
              this.token,
            ).catch((err) => console.warn('Failed to send publish notifications:', err));
          }
        }

        const succeededSet = new Set(succeededPaths);
        this._pendingRequests = this._pendingRequests.filter((r) => !succeededSet.has(r.path));

        this._approveAllProcessing = false;
        this._message = {
          type: 'error',
          text: `Published ${succeededPaths.length} of ${totalCount}. Failed: ${failedPaths.join(', ')}`,
        };
        return;
      }
    }

    // All succeeded — remove all requests from the sheet in a single write
    await removeMultiplePublishRequests(this._org, this._repo, allPaths, this.token);

    // Notify all authors that their content has been published
    const publishedEntries = this._pendingRequests
      .map((r) => ({ path: r.path, authorEmail: r.requester || r.authorEmail }));
    if (publishedEntries.length > 0) {
      notifyPublished(
        {
          org: this._org,
          repo: this._repo,
          paths: publishedEntries,
          approverEmail: this._userEmail,
        },
        this.token,
      ).catch((err) => console.warn('Failed to send publish notifications:', err));
    }

    this._pendingRequests = [];
    this._approveAllProcessing = false;
    this._message = { type: 'success', text: `All ${totalCount} requests published successfully!` };
  }

  // ======== My-requests action handlers ========

  async handleMyRequestResend(request) {
    if (this._myRequestActions.has(request.path)) return;
    this._myRequestActions = new Map([...this._myRequestActions, [request.path, 'resending']]);
    this._message = null;

    const result = await resendPublishRequest(
      this._org, this._repo, request.path, this._userEmail, this.token,
    );

    const updated = new Map(this._myRequestActions);
    updated.delete(request.path);
    this._myRequestActions = updated;

    if (result.success) {
      this._message = { type: 'success', text: `Publish request re-sent for ${request.path}` };
    } else {
      this._message = { type: 'error', text: `Failed to resend: ${result.error}` };
    }
  }

  async handleMyRequestWithdraw(request) {
    if (this._myRequestActions.has(request.path)) return;
    this._myRequestActions = new Map([...this._myRequestActions, [request.path, 'withdrawing']]);
    this._message = null;

    const result = await removePublishRequest(
      this._org, this._repo, request.path, this.token,
    );

    const updated = new Map(this._myRequestActions);
    updated.delete(request.path);
    this._myRequestActions = updated;

    if (result.success) {
      this._pendingRequests = this._pendingRequests.filter((r) => r.path !== request.path);
      this._message = { type: 'success', text: `Withdrawn: ${request.path}` };
    } else {
      this._message = { type: 'error', text: `Failed to withdraw: ${result.error}` };
    }
  }

  // ======== Render helpers ========

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

  // ======== Site Selection render ========

  renderSiteSelect() {
    const isRequesterMode = !!this._requester;
    const title = isRequesterMode ? 'My Publish Requests' : 'Publish Request Inbox';
    const subtitle = isRequesterMode
      ? 'Select a DA site to view your pending publish requests.'
      : 'Select a DA site to view pending publish requests for approval.';

    return html`
      <div class="site-select-container">
        <header class="site-select-header">
          <h1>${title}</h1>
          <p class="site-select-subtitle">${subtitle}</p>
        </header>

        ${this._userEmail
          ? html`<p class="reviewer-info">Logged in as: <strong>${this._userEmail}</strong></p>`
          : nothing}

        ${this.renderMessage()}

        <form id="site-select-form" @submit=${this.handleSiteSelect} class="site-select-form">
          <div class="form-group">
            <label for="org">Organization <span class="required">*</span></label>
            <input
              type="text"
              id="org"
              name="org"
              placeholder="e.g. my-org"
              required
              autocomplete="off"
            />
          </div>

          <div class="form-group">
            <label for="repo">Repository <span class="required">*</span></label>
            <input
              type="text"
              id="repo"
              name="repo"
              placeholder="e.g. my-repo"
              required
              autocomplete="off"
            />
          </div>

          <button
            type="submit"
            class="btn-primary btn-large"
            ?disabled=${this._siteSelectLoading}
          >
            ${this._siteSelectLoading ? 'Loading...' : 'View Publish Requests'}
          </button>
        </form>
      </div>
    `;
  }

  // ======== Inbox renders ========

  renderInbox() {
    return html`
      <div class="inbox-container">
        <header class="inbox-header">
          <div>
            <h1>Publish Request Inbox</h1>
            <p class="inbox-subtitle">Logged in as <strong>${this._userEmail}</strong></p>
          </div>
          ${this._pendingRequests.length > 0
            ? html`<span class="inbox-count">${this._pendingRequests.length} pending</span>`
            : nothing}
        </header>

        ${this.renderMessage()}

        ${this._pendingRequests.length === 0
          ? this.renderInboxEmpty()
          : this.renderInboxList()}
      </div>
    `;
  }

  renderInboxEmpty() {
    return html`
      <div class="inbox-empty">
        <div class="inbox-empty-icon"></div>
        <h2>No Pending Requests</h2>
        <p>You have no publish requests waiting for your approval.</p>
      </div>
    `;
  }

  renderInboxList() {
    return html`
      <div class="inbox-actions-bar">
        <button
          class="btn-approve-all"
          @click=${this.handleApproveAll}
          ?disabled=${this._approveAllProcessing}
        >
          ${this._approveAllProcessing
            ? 'Publishing all...'
            : `Approve & Publish All (${this._pendingRequests.length})`}
        </button>
      </div>

      <div class="inbox-list">
        ${this._pendingRequests.map((request) => this.renderInboxItem(request))}
      </div>
    `;
  }

  renderInboxItem(request) {
    const isProcessing = this._processingPaths.has(request.path);
    const reviewUrl = this.getReviewUrl(request);
    const diffUrl = this.getDiffUrlForPath(request.path);

    return html`
      <div class="inbox-item">
        <div class="inbox-item-info">
          <div class="inbox-item-path">${request.path}</div>
          <div class="inbox-item-meta">
            Requested by: ${request.requester || 'Unknown'}
          </div>
        </div>
        <div class="inbox-item-actions">
          <a href="${diffUrl}" target="_blank" rel="noopener" class="btn-sm btn-diff">Diff ↗</a>
          <a href="${reviewUrl}" class="btn-sm btn-review-link" @click=${(e) => this.navigateTop(reviewUrl, e)}>Review</a>
          <button
            class="btn-sm btn-approve-sm"
            @click=${() => this.handleInboxApprove(request)}
            ?disabled=${isProcessing || this._approveAllProcessing}
          >
            ${isProcessing ? 'Publishing...' : 'Approve & Publish'}
          </button>
        </div>
      </div>
    `;
  }

  // ======== My Requests (requester view) renders ========

  renderMyRequests() {
    return html`
      <div class="inbox-container">
        <header class="inbox-header">
          <div>
            <h1>My Publish Requests</h1>
            <p class="inbox-subtitle">Logged in as <strong>${this._userEmail}</strong></p>
          </div>
          ${this._pendingRequests.length > 0
            ? html`<span class="inbox-count">${this._pendingRequests.length} pending</span>`
            : nothing}
        </header>

        ${this.renderMessage()}

        ${this._pendingRequests.length === 0
          ? this.renderMyRequestsEmpty()
          : this.renderMyRequestsList()}
      </div>
    `;
  }

  renderMyRequestsEmpty() {
    return html`
      <div class="inbox-empty">
        <div class="inbox-empty-icon"></div>
        <h2>No Pending Requests</h2>
        <p>You have no pending publish requests awaiting approval.</p>
      </div>
    `;
  }

  renderMyRequestsList() {
    return html`
      <div class="inbox-list">
        ${this._pendingRequests.map((request) => this.renderMyRequestItem(request))}
      </div>
    `;
  }

  renderMyRequestItem(request) {
    const previewUrl = `https://main--${this._repo}--${this._org}.aem.page${request.path}`;
    const action = this._myRequestActions.get(request.path);
    const isBusy = !!action;

    return html`
      <div class="inbox-item">
        <div class="inbox-item-info">
          <div class="inbox-item-path">${request.path}</div>
          <div class="inbox-item-meta">
            Status: <strong>Pending Approval</strong>
          </div>
        </div>
        <div class="inbox-item-actions">
          <a href="${previewUrl}" target="_blank" rel="noopener" class="btn-sm btn-review-link">Preview ↗</a>
          <button
            class="btn-sm btn-resend-sm"
            @click=${() => this.handleMyRequestResend(request)}
            ?disabled=${isBusy}
          >
            ${action === 'resending' ? 'Resending...' : 'Resend Request'}
          </button>
          <button
            class="btn-sm btn-withdraw-sm"
            @click=${() => this.handleMyRequestWithdraw(request)}
            ?disabled=${isBusy}
          >
            ${action === 'withdrawing' ? 'Withdrawing...' : 'Withdraw Request'}
          </button>
        </div>
      </div>
    `;
  }

  // ======== Status page renders ========

  renderUnauthorized() {
    return html`
      <div class="error-container">
        <div class="error-icon"></div>
        <h2>Not Authorized</h2>
        ${this.renderMessage()}
        <div class="info-card">
          <div class="info-row">
            <span class="label">Content:</span>
            <code>${this._path}</code>
          </div>
          <div class="info-row">
            <span class="label">Logged in as:</span>
            <span>${this._userEmail}</span>
          </div>
        </div>
        <p class="error-help">
          You do not have permission to approve or reject this publish request.
          Please contact the listed approvers if you believe this is an error.
        </p>
      </div>
    `;
  }

  renderNoRequest() {
    return html`
      <div class="error-container">
        <div class="error-icon"></div>
        <h2>No Pending Request</h2>
        ${this.renderMessage()}
        <div class="info-card">
          <div class="info-row">
            <span class="label">Content:</span>
            <code>${this._path}</code>
          </div>
        </div>
        <p class="error-help">
          There is no pending publish request for this content.
          It may have already been approved, rejected, or was never submitted.
        </p>
        <div class="back-to-inbox">
          <a href="${this.getInboxUrl()}" class="back-link" @click=${(e) => this.navigateTop(this.getInboxUrl(), e)}>Back to Inbox</a>
        </div>
      </div>
    `;
  }

  renderError() {
    return html`
      <div class="error-container">
        <div class="error-icon"></div>
        <h2>Error</h2>
        ${this.renderMessage()}
        <p class="error-help">
          This page requires URL parameters to identify the content to review.
          Please access this page via the link in your approval email.
        </p>
      </div>
    `;
  }

  renderApproved() {
    return html`
      <div class="result-container approved">
        <div class="result-icon"></div>
        <h2>Published!</h2>
        <p>The content has been published successfully.</p>

        <div class="info-card">
          <div class="info-row">
            <span class="label">Content:</span>
            <code>${this._path}</code>
          </div>
          <div class="info-row">
            <span class="label">Live URL:</span>
            <a href="${this.liveUrl}" target="_blank" rel="noopener">${this.liveUrl}</a>
          </div>
        </div>

        <div class="result-actions">
          <a href="${this.liveUrl}" target="_blank" rel="noopener" class="btn-primary">
            View Published Content
          </a>
          <a href="${this.getInboxUrl()}" class="back-link" @click=${(e) => this.navigateTop(this.getInboxUrl(), e)}>Back to Inbox</a>
        </div>
      </div>
    `;
  }

  renderRejected() {
    return html`
      <div class="result-container rejected">
        <div class="result-icon"></div>
        <h2>Request Rejected</h2>
        ${this.renderMessage()}

        <div class="info-card">
          <div class="info-row">
            <span class="label">Page URL:</span>
            <code>${this._path}</code>
          </div>
          <div class="info-row">
            <span class="label">Requested By:</span>
            <span>${this._authorEmail}</span>
          </div>
        </div>

        <p class="result-note">
          The author has been notified about the rejection.
        </p>

        <div class="result-actions">
          <a href="${this.getInboxUrl()}" class="back-link" @click=${(e) => this.navigateTop(this.getInboxUrl(), e)}>Back to Inbox</a>
        </div>
      </div>
    `;
  }

  // ======== Single-request review render ========

  renderReview() {
    return html`
      <div class="review-container">
        <a href="${this.getInboxUrl()}" class="back-link" @click=${(e) => this.navigateTop(this.getInboxUrl(), e)}>Back to Inbox</a>

        <header class="review-header">
          <h1>Publish Request Review</h1>
          <p class="review-subtitle">Review requested website content changes for accuracy and compliance with Western Sydney University website standards.</p>
        </header>

        <div class="request-details">
          <h3>Request Details</h3>
          <div class="details-grid">
            <div class="detail-item">
              <span class="detail-label">Page URL:</span>
              <code class="detail-value">${this._path}</code>
            </div>
            <div class="detail-item">
              <span class="detail-label">Requested By:</span>
              <code class="detail-value">${this._authorEmail || 'Unknown'}</code>
            </div>
            ${this._comment
              ? html`
                  <div class="detail-item full-width">
                    <span class="detail-label">Author's Note:</span>
                    <p class="detail-value comment">"${this._comment}"</p>
                  </div>
                `
              : nothing}
            ${this._previewUrl
              ? html`
                  <div class="detail-item">
                    <span class="detail-label">Preview Page URL:</span>
                    <a href="${this._previewUrl}" target="_blank" rel="noopener" class="detail-value link">
                      View Preview ↗
                    </a>
                  </div>
                `
              : nothing}
          </div>
        </div>

        <div class="diff-section">
          <h3>Content Changes</h3>
          <p class="diff-description">
            Before publishing, please carefully review the requested changes and existing page version. Have they been SMART? <br />
            S – Streamline Site Structure <br />
            M – Metadata for SEO <br />
            A – Accessibility compliant <br />
            R – Redirects requested <br />
            T – Tested all links <br />
            <a href="${this.diffUrl}" target="_blank" rel="noopener" class="open-diff-link">View Existing Page↗ </a>
          </p>
        </div>

        ${this.renderMessage()}

        <div class="decision-section">
          <h3>Review Request</h3>

          ${this._needsEmail
            ? html`
                <div class="warning-banner">
                  <span class="warning-icon"></span>
                  <span>Unable to determine your email from session. Please log in to DA first.</span>
                </div>
              `
            : html`
                <p class="reviewer-info">Reviewing as: <strong>${this._userEmail}</strong></p>
              `}

          <div class="decision-buttons">
            <button
              class="btn-approve"
              @click=${this.handleApprove}
              ?disabled=${this._isProcessing || this._needsEmail}
            >
              ${this._isProcessing ? 'Publishing...' : 'Approve & Publish'}
            </button>
          </div>

          <details class="reject-section">
            <summary class="reject-toggle">Reject this request</summary>
            <form id="reject-form" @submit=${this.handleReject} class="reject-form">
              <div class="form-group">
                <label for="reason">Reason for rejection <span class="required">*</span></label>
                <textarea
                  id="reason"
                  name="reason"
                  rows="3"
                  placeholder="Please explain why this content cannot be published..."
                  required
                ></textarea>
              </div>
              <button
                type="submit"
                class="btn-reject"
                ?disabled=${this._isProcessing || this._needsEmail}
              >
                ${this._isProcessing ? 'Sending...' : 'Reject Request'}
              </button>
            </form>
          </details>
        </div>
      </div>
    `;
  }

  render() {
    switch (this._state) {
      case 'loading':
        return this.renderLoading();
      case 'site-select':
        return this.renderSiteSelect();
      case 'error':
        return this.renderError();
      case 'unauthorized':
        return this.renderUnauthorized();
      case 'no-request':
        return this.renderNoRequest();
      case 'inbox':
        return this.renderInbox();
      case 'my-requests':
        return this.renderMyRequests();
      case 'approved':
        return this.renderApproved();
      case 'rejected':
        return this.renderRejected();
      case 'review':
      default:
        return this.renderReview();
    }
  }
}

customElements.define('publish-requests-app', PublishRequestsApp);

(async function init() {
  const { context, token } = await DA_SDK;

  const cmp = document.createElement('publish-requests-app');
  cmp.context = context;
  cmp.token = token;

  document.body.append(cmp);
}());
