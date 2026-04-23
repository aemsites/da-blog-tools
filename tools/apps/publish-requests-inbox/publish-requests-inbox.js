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
  fetchSiteConfig,
  getLiveHostFromConfig,
  fetchAccentSettings,
  checkSiteExists,
  checkSiteRegistration,
  registerSite,
} from './api.js';

// Super Lite (sl-*) — Spectrum-aligned controls for DA; pairs with S2 tokens in CSS.
// NX style pipeline matches other da.live shell apps (e.g. MSM): nexter.js loadStyle + getStyle.
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

/** Parse `org/site` or `/org/site/` into `{ org, site }`. Returns null if invalid. */
function parseOrgSitePath(raw) {
  const normalized = (raw || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized) return null;
  const parts = normalized.split('/').filter((segment) => segment.length > 0);
  if (parts.length !== 2) return null;
  const [org, site] = parts;
  if (!org || !site) return null;
  return { org, site };
}

class PublishRequestsApp extends LitElement {
  static properties = {
    context: { attribute: false },
    token: { attribute: false },
    // view states: 'loading', 'idle', 'inbox', 'review', 'approved',
    //               'rejected', 'error', 'unauthorized', 'no-request',
    //               'site-not-found', 'unregistered'
    _state: { state: true },
    _isProcessing: { state: true },
    _message: { state: true },
    _userEmail: { state: true },
    _needsEmail: { state: true },
    // Request data
    _org: { state: true },
    _site: { state: true },
    _path: { state: true },
    _liveHost: { state: true },
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
    // Toolbar
    _siteSelectLoading: { state: true },
    _orgSiteValue: { state: true },
    // Inline reject error
    _rejectError: { state: true },
    // Registration
    _siteRegistered: { state: true },
    _registrationChecked: { state: true },
    _registerProcessing: { state: true },
    _showRegisterForm: { state: true },
    _availableProviders: { state: true },
  };

  constructor() {
    super();
    this._state = 'loading';
    this._isProcessing = false;
    this._message = null;
    this._userEmail = '';
    this._needsEmail = false;
    this._org = '';
    this._site = '';
    this._path = '';
    this._liveHost = null;
    this._authorEmail = '';
    this._previewUrl = '';
    this._comment = '';
    this._pendingRequests = [];
    this._processingPaths = new Set();
    this._approveAllProcessing = false;
    this._requester = false;
    this._myRequestActions = new Map();
    this._siteSelectLoading = false;
    this._orgSiteValue = '';
    this._siteRegistered = null;
    this._registrationChecked = false;
    this._registerProcessing = false;
    this._showRegisterForm = false;
    this._availableProviders = [];
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [nexter, sl, buttons, styles].filter(Boolean);
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
    const path = this._path?.replace(/\/index$/, '') || '';
    return `https://${this._liveHost}${path}`;
  }

  get diffUrl() {
    // Use the Page Status diff tool with embed mode for clean iframe display
    return `https://tools.aem.live/tools/page-status/diff.html?org=${encodeURIComponent(this._org)}&site=${encodeURIComponent(this._site)}&path=${encodeURIComponent(this._path)}`;
  }

  getDiffUrlForPath(path) {
    return `https://tools.aem.live/tools/page-status/diff.html?org=${encodeURIComponent(this._org)}&site=${encodeURIComponent(this._site)}&path=${encodeURIComponent(path)}`;
  }

  getReviewUrl(request) {
    const params = new URLSearchParams();
    params.set('org', this._org);
    params.set('site', this._site);
    params.set('path', request.path);
    if (request.requester) params.set('author', request.requester);
    // Build preview URL for the request path
    const path = request.path?.replace(/\/index$/, '') || '';
    const previewUrl = `https://main--${this._site}--${this._org}.aem.page${path}`;
    params.set('preview', previewUrl);
    return `${this.appBaseUrl}?${params.toString()}`;
  }

  getInboxUrl() {
    const params = new URLSearchParams();
    params.set('org', this._org);
    params.set('site', this._site);
    return `${this.appBaseUrl}?${params.toString()}`;
  }

  async loadSiteSettings(org, site) {
    try {
      const [siteConfig, accentSettings] = await Promise.all([
        fetchSiteConfig(org, site),
        fetchAccentSettings(org, site, this.token),
      ]);
      this._liveHost = getLiveHostFromConfig(org, site, siteConfig);
      if (accentSettings.accentColor) {
        this.style.setProperty('--pw-accent', accentSettings.accentColor);
      }
      if (accentSettings.accentColorHover) {
        this.style.setProperty('--pw-accent-hover', accentSettings.accentColorHover);
      }
    } catch {
      this._liveHost = null;
    }
  }

  updateUrl(params) {
    try {
      const qs = new URLSearchParams(params).toString();
      window.history.replaceState(null, '', `${window.location.pathname}?${qs}`);
    } catch { /* cross-origin iframe — ignore */ }
  }

  async init() {
    this._userEmail = await getUserEmail(this.token);
    this._needsEmail = !this._userEmail;

    const urlParams = new URLSearchParams(window.location.search);
    this._org = urlParams.get('org') || '';
    this._site = urlParams.get('site') || '';
    this._path = urlParams.get('path') || '';
    this._authorEmail = urlParams.get('author') || '';
    this._previewUrl = urlParams.get('preview') || '';
    this._comment = urlParams.get('comment') || '';
    this._requester = urlParams.get('requester') || false;

    if (this._org && this._site) {
      this._orgSiteValue = `/${this._org}/${this._site}`;
    }

    if (!this._org || !this._site) {
      this._state = 'idle';
      return;
    }

    // Check site existence and registration before proceeding
    const [siteExists, regStatus] = await Promise.all([
      checkSiteExists(this._org, this._site, this.token),
      checkSiteRegistration(this._org, this._site, this.token),
    ]);
    this._registrationChecked = true;
    this._siteRegistered = regStatus.registered;
    this._availableProviders = regStatus.availableProviders || [];

    if (!siteExists) {
      this._state = 'site-not-found';
      return;
    }

    if (!regStatus.registered) {
      this._state = 'unregistered';
      return;
    }

    await this.loadSiteSettings(this._org, this._site);

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
        this._org, this._site, this._userEmail, this.token,
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
        this._org, this._site, this._userEmail, this.token,
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
    const pendingRequest = await checkPublishRequest(this._org, this._site, this._path, this.token);
    if (!pendingRequest) {
      this._state = 'no-request';
      this._message = { type: 'error', text: 'No pending publish request found for this content path.' };
      return;
    }

    // Use requester from sheet if author not in URL params
    if (!this._authorEmail && pendingRequest.requester) {
      this._authorEmail = pendingRequest.requester;
    }

    // Use comment from sheet if not provided via URL params
    if (!this._comment && pendingRequest.comment) {
      this._comment = pendingRequest.comment;
    }

    // Check if the current user is an authorized approver for this content path
    if (this._userEmail) {
      try {
        const approvers = await getApproversForPath(this._org, this._site, this._path, this.token);
        const normalizedUser = this._userEmail.toLowerCase();
        const isApprover = approvers.some((a) => a.toLowerCase() === normalizedUser);
        if (!isApprover) {
          this._state = 'unauthorized';
          this._message = {
            type: 'error',
            text: `You (${this._userEmail}) are not authorized to approve or reject this request. Please contact your administrator.`,
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

  // ======== Toolbar handler — loads inbox inline ========

  async handleSiteSelect(e) {
    if (e) e.preventDefault();
    this._message = null;
    this._showRegisterForm = false;

    const input = this.shadowRoot.querySelector('#org-site');
    const orgSite = (input?.value ?? '').trim();
    const parsed = parseOrgSitePath(orgSite);
    if (!parsed) {
      this._message = {
        type: 'error',
        text: 'Enter organization and site as /org/site (for example aemsites/da-blog-tools).',
      };
      return;
    }
    const { org, site } = parsed;

    this._siteSelectLoading = true;

    if (!this._userEmail) {
      this._userEmail = await getUserEmail(this.token);
      this._needsEmail = !this._userEmail;
    }

    if (this._needsEmail) {
      this._siteSelectLoading = false;
      this._message = { type: 'error', text: 'Unable to determine your email. Please log in to DA first.' };
      return;
    }

    this._org = org;
    this._site = site;
    this._orgSiteValue = `/${org}/${site}`;
    this._path = '';
    this._pendingRequests = [];

    // Check site existence and registration in parallel
    const [siteExists, regStatus] = await Promise.all([
      checkSiteExists(org, site, this.token),
      checkSiteRegistration(org, site, this.token),
    ]);
    this._registrationChecked = true;
    this._siteRegistered = regStatus.registered;
    this._availableProviders = regStatus.availableProviders || [];

    if (!siteExists) {
      this._siteSelectLoading = false;
      this._state = 'site-not-found';
      const urlParams = { org, site };
      if (this._requester) urlParams.requester = 'true';
      this.updateUrl(urlParams);
      return;
    }

    if (!regStatus.registered) {
      this._siteSelectLoading = false;
      this._state = 'unregistered';
      const urlParams = { org, site };
      if (this._requester) urlParams.requester = 'true';
      this.updateUrl(urlParams);
      return;
    }

    await this.loadSiteSettings(org, site);

    const urlParams = { org, site };
    if (this._requester) urlParams.requester = 'true';
    this.updateUrl(urlParams);

    // Load inbox inline
    if (this._requester) {
      await this.initMyRequests();
    } else {
      await this.initInbox();
    }

    this._siteSelectLoading = false;
  }

  // ======== Inline review — opens detail view without page navigation ========

  async handleInlineReview(request) {
    this._path = request.path;
    this._authorEmail = request.requester || request.authorEmail || '';
    this._comment = request.comment || '';
    const path = request.path?.replace(/\/index$/, '') || '';
    this._previewUrl = `https://main--${this._site}--${this._org}.aem.page${path}`;
    this._message = null;
    this._state = 'loading';

    const urlParams = {
      org: this._org,
      site: this._site,
      path: request.path,
      preview: this._previewUrl,
    };
    if (request.requester) urlParams.author = request.requester;
    this.updateUrl(urlParams);

    await this.initReview();
  }

  // ======== Back to inbox — inline, no navigation ========

  backToInbox(e) {
    if (e) e.preventDefault();
    const reviewedPath = this._path;
    this._path = '';
    this._authorEmail = '';
    this._comment = '';
    this._previewUrl = '';
    this._message = null;
    this._rejectError = null;
    this._isProcessing = false;

    // Remove the just-processed request from the cached list
    if (reviewedPath && (this._state === 'approved' || this._state === 'rejected')) {
      this._pendingRequests = this._pendingRequests.filter((r) => r.path !== reviewedPath);
    }

    const urlParams = { org: this._org, site: this._site };
    if (this._requester) urlParams.requester = 'true';
    this.updateUrl(urlParams);

    if (this._pendingRequests.length > 0) {
      this._state = this._requester ? 'my-requests' : 'inbox';
    } else if (this._requester) {
      this.initMyRequests();
    } else {
      this.initInbox();
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
      const result = await publishContent(this._org, this._site, this._path);

      if (result.success) {
        // Remove the pending request from the requests sheet
        await removePublishRequest(this._org, this._site, this._path, this.token);

        this._state = 'approved';

        // Notify the author that their content has been published
        if (this._authorEmail) {
          const notifyResult = await notifyPublished(
            {
              org: this._org,
              site: this._site,
              paths: [{ path: this._path, authorEmail: this._authorEmail }],
              approverEmail: this._userEmail,
            },
            this.token,
          );
          if (!notifyResult.success) {
            this._message = { type: 'info', text: `Author notification failed: ${notifyResult.error}` };
          }
        }
      } else {
        this._message = { type: 'error', text: result.error };
      }
    } finally {
      this._isProcessing = false;
    }
  }

  async handleReject() {
    if (this._needsEmail) {
      this._rejectError = 'Unable to determine your email. Please log in again.';
      return;
    }

    const textarea = this.shadowRoot.querySelector('#reason');
    const reason = (textarea?.value ?? '').trim();

    if (!reason) {
      this._rejectError = 'Please provide a reason for rejection.';
      return;
    }

    this._rejectError = null;
    this._isProcessing = true;
    this._message = null;

    // Send rejection notification
    const result = await notifyRejection(
      {
        org: this._org,
        site: this._site,
        path: this._path,
        authorEmail: this._authorEmail,
        rejecterEmail: this._userEmail,
        reason,
      },
      this.token,
    );

    this._isProcessing = false;

    if (result.success) {
      await removePublishRequest(this._org, this._site, this._path, this.token);
      this._state = 'rejected';
    } else {
      this._message = { type: 'error', text: result.error };
    }
  }

  // ======== Inbox action handlers ========

  async handleInboxApprove(request) {
    if (this._processingPaths.has(request.path)) return; // guard against re-entry
    this._processingPaths = new Set([...this._processingPaths, request.path]);
    this.requestUpdate();

    const result = await publishContent(this._org, this._site, request.path);

    if (result.success) {
      await removePublishRequest(this._org, this._site, request.path, this.token);

      this._pendingRequests = this._pendingRequests.filter((r) => r.path !== request.path);

      // Notify the author that their content has been published
      const authorEmail = request.requester || request.authorEmail;
      if (authorEmail) {
        const notifyResult = await notifyPublished(
          {
            org: this._org,
            site: this._site,
            paths: [{ path: request.path, authorEmail }],
            approverEmail: this._userEmail,
          },
          this.token,
        );
        this._message = notifyResult.success
          ? { type: 'success', text: `Published: ${request.path}` }
          : { type: 'info', text: `Published: ${request.path}. Author notification failed: ${notifyResult.error}` };
      } else {
        this._message = { type: 'success', text: `Published: ${request.path}` };
      }
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

    const bulkResult = await bulkPublishContent(this._org, this._site, allPaths);

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
        let partialNotifyError = null;

        // Remove only succeeded requests from the sheet in one write
        if (succeededPaths.length > 0) {
          await removeMultiplePublishRequests(this._org, this._site, succeededPaths, this.token);

          // Notify authors of successfully published pages
          const succeededSet = new Set(succeededPaths);
          const succeededEntries = this._pendingRequests
            .filter((r) => succeededSet.has(r.path))
            .map((r) => ({ path: r.path, authorEmail: r.requester || r.authorEmail }));
          if (succeededEntries.length > 0) {
            const notifyResult = await notifyPublished(
              {
                org: this._org,
                site: this._site,
                paths: succeededEntries,
                approverEmail: this._userEmail,
              },
              this.token,
            );
            if (!notifyResult.success) partialNotifyError = notifyResult.error;
          }
        }

        const succeededSet = new Set(succeededPaths);
        this._pendingRequests = this._pendingRequests.filter((r) => !succeededSet.has(r.path));

        this._approveAllProcessing = false;
        this._message = {
          type: 'error',
          text: `Published ${succeededPaths.length} of ${totalCount}. Failed: ${failedPaths.join(', ')}${partialNotifyError ? ` Author notification failed: ${partialNotifyError}` : ''}`,
        };
        return;
      }
    }

    // All succeeded — remove all requests from the sheet in a single write
    await removeMultiplePublishRequests(this._org, this._site, allPaths, this.token);

    // Notify all authors that their content has been published
    const publishedEntries = this._pendingRequests
      .map((r) => ({ path: r.path, authorEmail: r.requester || r.authorEmail }));
    let bulkNotifyError = null;
    if (publishedEntries.length > 0) {
      const notifyResult = await notifyPublished(
        {
          org: this._org,
          site: this._site,
          paths: publishedEntries,
          approverEmail: this._userEmail,
        },
        this.token,
      );
      if (!notifyResult.success) bulkNotifyError = notifyResult.error;
    }

    this._pendingRequests = [];
    this._approveAllProcessing = false;
    this._message = bulkNotifyError
      ? { type: 'info', text: `All ${totalCount} requests published. Author notification failed: ${bulkNotifyError}` }
      : { type: 'success', text: `All ${totalCount} requests published successfully!` };
  }

  // ======== My-requests action handlers ========

  async handleMyRequestResend(request) {
    if (this._myRequestActions.has(request.path)) return;
    this._myRequestActions = new Map([...this._myRequestActions, [request.path, 'resending']]);
    this._message = null;

    const result = await resendPublishRequest(
      this._org, this._site, request.path, this._userEmail, this.token,
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
      this._org, this._site, request.path, this.token,
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

  // ======== Registration handlers ========

  toggleRegisterForm() {
    this._showRegisterForm = !this._showRegisterForm;
  }

  async handleRegister() {
    this._registerProcessing = true;
    this._message = null;

    const getVal = (id) => (this.shadowRoot.querySelector(`#${id}`)?.value ?? '').trim();
    const providers = this._availableProviders;
    const showDropdown = providers.length > 1;
    const emailProvider = showDropdown
      ? (getVal('reg-email-provider') || providers[0])
      : (providers[0] || 'custom-api');
    const apiUrl = getVal('reg-api-url');
    const apiKey = getVal('reg-api-key');
    const fromAddress = getVal('reg-from-address');
    const fromName = getVal('reg-from-name');
    const domainsRaw = getVal('reg-allowed-domains');
    const allowedEmailDomains = domainsRaw
      ? domainsRaw.split(',').map((d) => d.trim()).filter(Boolean)
      : [];

    const emailConfig = { emailProvider };
    if (emailProvider === 'custom-api') {
      if (!apiUrl) {
        this._registerProcessing = false;
        this._message = { type: 'error', text: 'API URL is required for custom API provider.' };
        return;
      }
      emailConfig.apiUrl = apiUrl;
      if (apiKey) emailConfig.apiKey = apiKey;
      if (fromAddress) emailConfig.fromAddress = fromAddress;
      if (fromName) emailConfig.fromName = fromName;
    }
    if (allowedEmailDomains.length > 0) emailConfig.allowedEmailDomains = allowedEmailDomains;

    const result = await registerSite(this._org, this._site, emailConfig, this.token);
    this._registerProcessing = false;

    if (result.success) {
      this._siteRegistered = true;
      this._showRegisterForm = false;
      this._message = { type: 'success', text: `Site ${this._org}/${this._site} registered successfully!` };

      // Now proceed to load the inbox
      this._siteSelectLoading = true;
      await this.loadSiteSettings(this._org, this._site);
      if (this._requester) {
        await this.initMyRequests();
      } else {
        await this.initInbox();
      }
      this._siteSelectLoading = false;
    } else {
      this._message = { type: 'error', text: result.error };
    }
  }

  // ======== Render helpers ========

  renderLoading() {
    return html`
      <div class="loading-container" role="status" aria-live="polite" aria-busy="true">
        <div class="spectrum-loading-indicator" aria-hidden="true"></div>
        <p class="loading-label">Loading...</p>
      </div>
    `;
  }

  renderMessage() {
    if (!this._message) return nothing;
    return html`<div class="message ${this._message.type}">${this._message.text}</div>`;
  }

  // ======== Persistent toolbar (always visible) ========

  renderToolbar() {
    const isRequesterMode = !!this._requester;
    const title = isRequesterMode ? 'My Publish Requests' : 'Publish Request Inbox';
    const primaryLabel = isRequesterMode ? 'View my requests' : 'View publish requests';

    return html`
      <div class="site-select-container">
        <header class="site-select-header">
          <h1 class="site-select-title">${title}</h1>
        </header>

        <div class="site-select-toolbar">
          <div class="site-select-field site-select-field--grow">
            <sl-input
              type="text"
              id="org-site"
              placeholder="/org/site"
              autocomplete="off"
              aria-label="Organization and site, format org slash site"
              .value=${this._orgSiteValue}
              @keydown=${(e) => { if (e.key === 'Enter') this.handleSiteSelect(); }}
            ></sl-input>
          </div>
          <sl-button
            class="pw-fill-accent site-select-submit"
            @click=${() => this.handleSiteSelect()}
            ?disabled=${this._siteSelectLoading}
          >
            ${this._siteSelectLoading ? 'Loading...' : primaryLabel}
          </sl-button>
        </div>
      </div>
    `;
  }

  renderContent() {
    switch (this._state) {
      case 'loading':
        return this.renderLoading();
      case 'idle':
        return nothing;
      case 'error':
        return this.renderError();
      case 'unauthorized':
        return this.renderUnauthorized();
      case 'no-request':
        return this.renderNoRequest();
      case 'site-not-found':
        return this.renderSiteNotFound();
      case 'unregistered':
        return this.renderUnregistered();
      case 'inbox':
        return this.renderInbox();
      case 'my-requests':
        return this.renderMyRequests();
      case 'approved':
        return this.renderApproved();
      case 'rejected':
        return this.renderRejected();
      case 'review':
        return this.renderReview();
      default:
        return nothing;
    }
  }

  // ======== Unregistered site — registration form ========

  renderUnregistered() {
    return html`
      <div class="register-container">
        <div class="register-banner">
          <div class="status-icon status-icon--neutral">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 15a1 1 0 1 1 1-1 1 1 0 0 1-1 1Zm1-4.5a1 1 0 0 1-2 0v-4a1 1 0 0 1 2 0Z" fill="currentColor"/></svg>
          </div>
          <h2 class="register-heading">Site Not Registered</h2>
          <p class="register-body">
            <strong>${this._org}/${this._site}</strong> is not yet registered for the publish workflow.
            Register it to enable publish request approvals and email notifications.
          </p>
          ${!this._showRegisterForm ? html`
            <sl-button
              class="pw-fill-accent"
              @click=${() => this.toggleRegisterForm()}
            >Register Site</sl-button>
          ` : nothing}
        </div>

        ${this._showRegisterForm ? this.renderRegisterForm() : nothing}
      </div>
    `;
  }

  renderRegisterForm() {
    const providers = this._availableProviders;
    const showDropdown = providers.length > 1;
    const onlyCustomApi = providers.length === 1 && providers[0] === 'custom-api';

    return html`
      <section class="review-card register-form-card">
        <h3 class="review-card-title">Registration Settings</h3>
        <p class="review-card-body">Configure the email provider and notification settings for this site.</p>

        <div class="register-form">
          ${showDropdown ? html`
            <div class="form-group">
              <label for="reg-email-provider">Email Provider</label>
              <select id="reg-email-provider" class="reg-select"
                @change=${() => this.requestUpdate()}>
                ${providers.map((p) => html`
                  <option value="${p}">${p === 'default' ? 'MailChannels (default)' : 'Custom API'}</option>
                `)}
              </select>
            </div>
          ` : nothing}

          ${showDropdown ? this.renderCustomApiFields() : nothing}
          ${onlyCustomApi ? this.renderCustomApiFieldsAlways() : nothing}

          <div class="form-group">
            <label for="reg-allowed-domains">Allowed Email Domains</label>
            <sl-input
              id="reg-allowed-domains"
              type="text"
              placeholder="adobe.com, example.com"
            ></sl-input>
            <span class="form-hint">Comma-separated list of domains allowed to receive notifications.</span>
          </div>

          ${this.renderMessage()}

          <div class="register-form-actions">
            <sl-button
              class="pw-fill-accent"
              @click=${() => this.handleRegister()}
              ?disabled=${this._registerProcessing}
            >
              ${this._registerProcessing ? 'Registering...' : 'Register'}
            </sl-button>
            <sl-button
              class="pw-quiet-secondary"
              @click=${() => this.toggleRegisterForm()}
              ?disabled=${this._registerProcessing}
            >Cancel</sl-button>
          </div>
        </div>
      </section>
    `;
  }

  renderCustomApiFields() {
    const sel = this.shadowRoot?.querySelector('#reg-email-provider');
    if (!sel || sel.value !== 'custom-api') return nothing;
    return this.renderCustomApiFieldsAlways();
  }

  renderCustomApiFieldsAlways() {
    return html`
      <div class="form-group">
        <label for="reg-api-url">API URL <span class="required">*</span></label>
        <sl-input
          id="reg-api-url"
          type="text"
          placeholder="https://example.com/api/sendEmail"
        ></sl-input>
      </div>
      <div class="form-group">
        <label for="reg-api-key">API Key</label>
        <sl-input
          id="reg-api-key"
          type="password"
          placeholder="Enter API key"
        ></sl-input>
      </div>
      <div class="form-group">
        <label for="reg-from-address">From Address</label>
        <sl-input
          id="reg-from-address"
          type="text"
          placeholder="noreply@example.com"
        ></sl-input>
      </div>
      <div class="form-group">
        <label for="reg-from-name">From Name</label>
        <sl-input
          id="reg-from-name"
          type="text"
          placeholder="My Organization"
        ></sl-input>
      </div>
    `;
  }

  // ======== Site not found render ========

  renderSiteNotFound() {
    return html`
      <div class="status-page">
        <div class="status-icon status-icon--error">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 15a1 1 0 1 1 1-1 1 1 0 0 1-1 1Zm1-4.5a1 1 0 0 1-2 0v-4a1 1 0 0 1 2 0Z" fill="currentColor"/></svg>
        </div>
        <h2 class="status-heading">Site Not Available</h2>
        <p class="status-body">
          The site <strong>${this._org}/${this._site}</strong> could not be found.
          Please check the organization and site names and try again.
        </p>
      </div>
    `;
  }

  // ======== Inbox renders ========

  renderInbox() {
    return html`
      <div class="inbox-container">
        <header class="inbox-header">
          <div>
            <p class="inbox-subtitle">Logged in as <strong>${this._userEmail}</strong></p>
          </div>
          ${this._pendingRequests.length > 0
            ? html`<span class="inbox-count">${this._pendingRequests.length} pending</span>`
            : nothing}
        </header>

        ${this._pendingRequests.length === 0
          ? this.renderInboxEmpty()
          : this.renderInboxList()}
      </div>
    `;
  }

  renderInboxEmpty() {
    return html`
      <div class="inbox-empty">
        <h2>No Pending Requests</h2>
        <p>You have no publish requests waiting for your approval.</p>
      </div>
    `;
  }

  renderInboxList() {
    return html`
      <div class="inbox-list">
        ${this._pendingRequests.map((request) => this.renderInboxItem(request))}
      </div>

      <div class="inbox-actions-bar">
        <sl-button
          class="pw-fill-accent"
          @click=${this.handleApproveAll}
          ?disabled=${this._approveAllProcessing}
        >
          ${this._approveAllProcessing
            ? 'Publishing all...'
            : `Approve & Publish All (${this._pendingRequests.length})`}
        </sl-button>
      </div>
    `;
  }

  renderInboxItem(request) {
    const isProcessing = this._processingPaths.has(request.path);
    const reviewUrl = this.getReviewUrl(request);
    const diffUrl = this.getDiffUrlForPath(request.path);
    const requester = request.requester || 'Unknown';

    return html`
      <details class="inbox-item">
        <summary class="inbox-item-header">
          <svg class="inbox-item-chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1l4 4-4 4"/></svg>
          <span class="inbox-item-path">${request.path}</span>
          <span class="inbox-item-actions">
            <a href="${diffUrl}" target="_blank" rel="noopener" class="action-link">
              <svg class="action-icon" viewBox="0 0 18 18"><path d="M16.5 1h-15A1.5 1.5 0 0 0 0 2.5v13A1.5 1.5 0 0 0 1.5 17h15a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 16.5 1ZM9 16H1.5a.5.5 0 0 1-.5-.5V3h8v13Zm8-.5a.5.5 0 0 1-.5.5H10V3h7v12.5Z"/></svg>
              Diff
            </a>
            <a href="${reviewUrl}" class="action-link" @click=${(e) => { e.preventDefault(); this.handleInlineReview(request); }}>
              <svg class="action-icon" viewBox="0 0 18 18"><path d="M9 1a8 8 0 1 0 8 8 8 8 0 0 0-8-8Zm0 15a7 7 0 1 1 7-7 7 7 0 0 1-7 7Z"/><path d="M9 4a1 1 0 0 0-1 1v4a1 1 0 0 0 .553.894l3 1.5a1 1 0 0 0 .894-1.788L10 8.382V5a1 1 0 0 0-1-1Z"/></svg>
              Review
            </a>
            <sl-button
              class="pw-fill-accent pw-action-sm"
              @click=${(e) => { e.stopPropagation(); this.handleInboxApprove(request); }}
              ?disabled=${isProcessing || this._approveAllProcessing}
            >
              ${isProcessing ? 'Publishing...' : 'Approve & Publish'}
            </sl-button>
          </span>
        </summary>
        <div class="inbox-item-details">
          <div class="inbox-item-detail-row">
            <span class="detail-label">Requested by</span>
            <span class="detail-value">${requester}</span>
          </div>
          ${request.comment ? html`
            <div class="inbox-item-detail-row">
              <span class="detail-label">Message</span>
              <span class="detail-value">${request.comment}</span>
            </div>
          ` : nothing}
        </div>
      </details>
    `;
  }

  // ======== My Requests (requester view) renders ========

  renderMyRequests() {
    return html`
      <div class="inbox-container">
        <header class="inbox-header">
          <div>
            <p class="inbox-subtitle">Logged in as <strong>${this._userEmail}</strong></p>
          </div>
          ${this._pendingRequests.length > 0
            ? html`<span class="inbox-count">${this._pendingRequests.length} pending</span>`
            : nothing}
        </header>

        ${this._pendingRequests.length === 0
          ? this.renderMyRequestsEmpty()
          : this.renderMyRequestsList()}
      </div>
    `;
  }

  renderMyRequestsEmpty() {
    return html`
      <div class="inbox-empty">
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
    const path = request.path?.replace(/\/index$/, '') || '';
    const previewUrl = `https://main--${this._site}--${this._org}.aem.page${path}`;
    const action = this._myRequestActions.get(request.path);
    const isBusy = !!action;

    return html`
      <details class="inbox-item">
        <summary class="inbox-item-header">
          <svg class="inbox-item-chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1l4 4-4 4"/></svg>
          <span class="inbox-item-path">${request.path}</span>
          <span class="inbox-item-actions">
            <a href="${previewUrl}" target="_blank" rel="noopener" class="action-link">
              <svg class="action-icon" viewBox="0 0 18 18"><path d="M15.5 1h-13A1.5 1.5 0 0 0 1 2.5v13A1.5 1.5 0 0 0 2.5 17h13a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 15.5 1Zm.5 14.5a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 .5.5v13ZM13 4.5a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 0-.354.854L9.793 6.5 5.146 11.146a.5.5 0 0 0 .708.708L10.5 7.207l1.646 1.647A.5.5 0 0 0 13 8.5v-4Z"/></svg>
              Preview
            </a>
            <sl-button
              class="pw-quiet-secondary pw-action-sm"
              @click=${(e) => { e.stopPropagation(); this.handleMyRequestResend(request); }}
              ?disabled=${isBusy}
            >
              ${action === 'resending' ? 'Resending...' : 'Resend'}
            </sl-button>
            <sl-button
              class="pw-fill-negative pw-action-sm"
              @click=${(e) => { e.stopPropagation(); this.handleMyRequestWithdraw(request); }}
              ?disabled=${isBusy}
            >
              ${action === 'withdrawing' ? 'Withdrawing...' : 'Withdraw'}
            </sl-button>
          </span>
        </summary>
        <div class="inbox-item-details">
          <div class="inbox-item-detail-row">
            <span class="detail-label">Status</span>
            <span class="status-badge pending">Pending Approval</span>
          </div>
          ${request.comment ? html`
            <div class="inbox-item-detail-row">
              <span class="detail-label">Message</span>
              <span class="detail-value">${request.comment}</span>
            </div>
          ` : nothing}
        </div>
      </details>
    `;
  }

  // ======== Status page renders ========

  renderUnauthorized() {
    return html`
      <div class="status-page">
        <div class="status-icon status-icon--warning">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 15a1 1 0 1 1 1-1 1 1 0 0 1-1 1Zm1-4.5a1 1 0 0 1-2 0v-4a1 1 0 0 1 2 0Z" fill="currentColor"/></svg>
        </div>
        <h2 class="status-heading">Not Authorized</h2>
        <p class="status-body">
          You do not have permission to approve or reject this publish request.
          Please contact the listed approvers if you believe this is an error.
        </p>

        <section class="review-card">
          <dl class="detail-list">
            <div class="detail-row">
              <dt>Content</dt>
              <dd><code>${this._path}</code></dd>
            </div>
            <div class="detail-row">
              <dt>Logged in as</dt>
              <dd><code>${this._userEmail}</code></dd>
            </div>
          </dl>
        </section>
      </div>
    `;
  }

  renderNoRequest() {
    return html`
      <div class="status-page">
        <div class="status-icon status-icon--neutral">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 15a1 1 0 1 1 1-1 1 1 0 0 1-1 1Zm1-4.5a1 1 0 0 1-2 0v-4a1 1 0 0 1 2 0Z" fill="currentColor"/></svg>
        </div>
        <h2 class="status-heading">No Pending Request</h2>
        <p class="status-body">
          There is no pending publish request for this content.
          It may have already been approved, rejected, or was never submitted.
        </p>

        <section class="review-card">
          <dl class="detail-list">
            <div class="detail-row">
              <dt>Content</dt>
              <dd><code>${this._path}</code></dd>
            </div>
          </dl>
        </section>

        <a href="${this.getInboxUrl()}" class="back-link" @click=${(e) => this.backToInbox(e)}>
          <svg class="back-chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M7 1L3 5l4 4"/></svg>
          Back to Inbox
        </a>
      </div>
    `;
  }

  renderError() {
    return html`
      <div class="status-page">
        <div class="status-icon status-icon--error">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 15a1 1 0 1 1 1-1 1 1 0 0 1-1 1Zm1-4.5a1 1 0 0 1-2 0v-4a1 1 0 0 1 2 0Z" fill="currentColor"/></svg>
        </div>
        <h2 class="status-heading">Error</h2>
        <p class="status-body">
          This page requires URL parameters to identify the content to review.
          Please access this page via the link in your approval email.
        </p>
      </div>
    `;
  }

  renderApproved() {
    return html`
      <div class="status-page">
        <div class="status-icon status-icon--success">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 17.5L3.5 11.5l1.41-1.41L9.5 14.67l9.59-9.59L20.5 6.5z" fill="currentColor"/></svg>
        </div>
        <h2 class="status-heading status-heading--success">Published!</h2>
        <p class="status-body">The content has been published successfully.</p>

        <section class="review-card">
          <dl class="detail-list">
            <div class="detail-row">
              <dt>Page</dt>
              <dd><code>${this._path}</code></dd>
            </div>
            <div class="detail-row">
              <dt>Live URL</dt>
              <dd>
                <a href="${this.liveUrl}" target="_blank" rel="noopener" class="action-link">
                  <svg class="action-icon" viewBox="0 0 18 18"><path d="M15.5 1h-13A1.5 1.5 0 0 0 1 2.5v13A1.5 1.5 0 0 0 2.5 17h13a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 15.5 1Zm.5 14.5a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 .5.5v13ZM13 4.5a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 0-.354.854L9.793 6.5 5.146 11.146a.5.5 0 0 0 .708.708L10.5 7.207l1.646 1.647A.5.5 0 0 0 13 8.5v-4Z"/></svg>
                  View Published Content
                </a>
              </dd>
            </div>
          </dl>
        </section>

        <a href="${this.getInboxUrl()}" class="back-link" @click=${(e) => this.backToInbox(e)}>
          <svg class="back-chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M7 1L3 5l4 4"/></svg>
          Back to Inbox
        </a>
      </div>
    `;
  }

  renderRejected() {
    return html`
      <div class="status-page">
        <div class="status-icon status-icon--error">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.36 5.64a1 1 0 0 0-1.41 0L12 10.59 7.05 5.64a1 1 0 0 0-1.41 1.41L10.59 12l-4.95 4.95a1 1 0 1 0 1.41 1.41L12 13.41l4.95 4.95a1 1 0 0 0 1.41-1.41L13.41 12l4.95-4.95a1 1 0 0 0 0-1.41Z" fill="currentColor"/></svg>
        </div>
        <h2 class="status-heading status-heading--error">Request Rejected</h2>
        <p class="status-body">The author has been notified about the rejection.</p>

        <section class="review-card">
          <dl class="detail-list">
            <div class="detail-row">
              <dt>Page</dt>
              <dd><code>${this._path}</code></dd>
            </div>
            <div class="detail-row">
              <dt>Requested by</dt>
              <dd><code>${this._authorEmail}</code></dd>
            </div>
          </dl>
        </section>

        <a href="${this.getInboxUrl()}" class="back-link" @click=${(e) => this.backToInbox(e)}>
          <svg class="back-chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M7 1L3 5l4 4"/></svg>
          Back to Inbox
        </a>
      </div>
    `;
  }

  // ======== Single-request review render ========

  renderReview() {
    return html`
      <div class="review-container">
        <a href="${this.getInboxUrl()}" class="back-link" @click=${(e) => this.backToInbox(e)}>
          <svg class="back-chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M7 1L3 5l4 4"/></svg>
          Back to Inbox
        </a>

        <header class="review-header">
          <h2>Publish Request Review</h2>
          <p class="review-subtitle">Review the requested content changes for accuracy and compliance before publishing.</p>
        </header>

        <section class="review-card">
          <h3 class="review-card-title">Request Details</h3>
          <dl class="detail-list">
            <div class="detail-row">
              <dt>Page</dt>
              <dd><code>${this._path}</code></dd>
            </div>
            <div class="detail-row">
              <dt>Requested by</dt>
              <dd><code>${this._authorEmail || 'Unknown'}</code></dd>
            </div>
            ${this._comment ? html`
              <div class="detail-row">
                <dt>Author's note</dt>
                <dd class="detail-comment"><code>${this._comment}</code></dd>
              </div>
            ` : nothing}
            ${this._previewUrl ? html`
              <div class="detail-row">
                <dt>Preview</dt>
                <dd>
                  <a href="${this._previewUrl}" target="_blank" rel="noopener" class="action-link">
                    <svg class="action-icon" viewBox="0 0 18 18"><path d="M15.5 1h-13A1.5 1.5 0 0 0 1 2.5v13A1.5 1.5 0 0 0 2.5 17h13a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 15.5 1Zm.5 14.5a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 .5.5v13ZM13 4.5a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 0-.354.854L9.793 6.5 5.146 11.146a.5.5 0 0 0 .708.708L10.5 7.207l1.646 1.647A.5.5 0 0 0 13 8.5v-4Z"/></svg>
                    View Preview
                  </a>
                </dd>
              </div>
            ` : nothing}
          </dl>
        </section>

        <section class="review-card">
          <h3 class="review-card-title">Content Changes</h3>
          <p class="review-card-body">Before publishing, please review the requested changes. Have they been SMART?</p>
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

        <section class="review-card review-card--decision">
          <h3 class="review-card-title">Your Decision</h3>

          ${this._needsEmail
            ? html`
                <div class="warning-banner">
                  <svg class="warning-icon" viewBox="0 0 18 18" aria-hidden="true"><path d="M8.5 1.5a1 1 0 0 1 1.64 0l7 10.5A1 1 0 0 1 16.31 13.5H1.69a1 1 0 0 1-.83-1.5ZM9 5a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 0 1.5 0v-3.5A.75.75 0 0 0 9 5Zm0 6a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" fill="currentColor"/></svg>
                  Unable to determine your email. Please log in to DA first.
                </div>
              `
            : html`
                <p class="reviewer-info">Reviewing as <strong>${this._userEmail}</strong></p>
              `}

          <div class="decision-actions">
            <sl-button
              class="pw-fill-accent"
              @click=${this.handleApprove}
              ?disabled=${this._isProcessing || this._needsEmail}
            >
              ${this._isProcessing ? 'Publishing...' : 'Approve & Publish'}
            </sl-button>
          </div>

          <details class="reject-section" @toggle=${() => { this._rejectError = null; }}>
            <summary class="reject-toggle">
              <svg class="reject-chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1l4 4-4 4"/></svg>
              Reject this request
            </summary>
            <div class="reject-form">
              <div class="form-group">
                <label for="reason">Reason for rejection <span class="required">*</span></label>
                <sl-textarea
                  id="reason"
                  rows="3"
                  placeholder="Please explain why this content cannot be published..."
                ></sl-textarea>
              </div>
              ${this._rejectError ? html`<div class="message error">${this._rejectError}</div>` : nothing}
              <sl-button
                class="pw-fill-negative"
                @click=${() => this.handleReject()}
                ?disabled=${this._isProcessing || this._needsEmail}
              >
                ${this._isProcessing ? 'Sending...' : 'Reject Request'}
              </sl-button>
            </div>
          </details>
        </section>
      </div>
    `;
  }

  render() {
    return html`
      ${this.renderToolbar()}
      ${this._showRegisterForm ? nothing : this.renderMessage()}
      <div class="pw-content">
        ${this.renderContent()}
      </div>
    `;
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
