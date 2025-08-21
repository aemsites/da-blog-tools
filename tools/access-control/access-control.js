/* eslint-disable import/no-unresolved */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { DA_ORIGIN } from 'https://da.live/nx/public/utils/constants.js';

const CONFIG = {
  PERMISSIONS_SHEET_PATH: '.da/da-apps-permissions.json',
};

// Load CSS
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = './access-control/access-control.css';
document.head.appendChild(link);

class ProtectApp {
  constructor() {
    this.currentUser = null;
    this.pathUsers = {};
    this.currentPath = window.location.pathname;
  }

  async getIMSUser() {
    try {
      const { token } = await DA_SDK;

      if (token) {
        const userInfo = ProtectApp.decodeJwt(token);
        if (userInfo) {
          this.currentUser = {
            userId: userInfo.user_id,
          };
          return this.currentUser;
        }

        // Fallback: authenticated but no user details
        this.currentUser = { userId: 'authenticated-user', email: null, name: 'User' };
        return this.currentUser;
      }

      return null;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Authentication failed:', error.message);
      return null;
    }
  }

  static decodeJwt(token) {
    if (!token || typeof token !== 'string') return null;

    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const payload = parts[1];
      const paddedPayload = payload + '='.repeat((4 - (payload.length % 4)) % 4);
      const decodedPayload = atob(paddedPayload);

      return JSON.parse(decodedPayload);
    } catch {
      return null;
    }
  }

  async fetchPermissionsSheet() {
    try {
      const { context, actions } = await DA_SDK;
      const url = `${DA_ORIGIN}/source/${context.org}/${context.repo}/${CONFIG.PERMISSIONS_SHEET_PATH}`;
      const response = await actions.daFetch(url);

      if (!response.ok) return {};

      const data = await response.json();
      const pathUsers = {};

      (data.data || []).forEach(({ path, users }) => {
        if (path) {
          pathUsers[path.trim()] = users?.trim()
            ? users.split(',').map((u) => u.trim())
            : [];
        }
      });

      this.pathUsers = pathUsers;
      return pathUsers;
    } catch {
      this.pathUsers = {};
      return {};
    }
  }

  async checkUserAccess(appPath = this.currentPath) {
    if (!appPath) return { hasAccess: true, user: null, reason: 'No restrictions applied' };

    await this.fetchPermissionsSheet();
    const user = await this.getIMSUser();

    if (!this.pathUsers[appPath]) {
      return { hasAccess: false, user, reason: 'Path not configured' };
    }

    if (!user?.userId) {
      return { hasAccess: false, user: null, reason: 'User not authenticated' };
    }

    const authorizedUsers = this.pathUsers[appPath];
    const hasAccess = authorizedUsers.length === 0 || authorizedUsers.includes(user.userId);

    return {
      hasAccess,
      reason: hasAccess ? 'Access granted' : 'Access denied',
      user,
    };
  }

  // eslint-disable-next-line class-methods-use-this
  async showAccessDenied(accessResult) {
    const appContainer = document.querySelector('.app-container') || document.body;
    try {
      const response = await fetch('./access-control/access-control.html');
      const htmlTemplate = await response.text();
      appContainer.innerHTML = htmlTemplate
        .replace('{{reason}}', accessResult.reason)
        .replace('{{userId}}', accessResult.user?.userId || 'Not available');
    } catch {
      appContainer.innerHTML = `<div class="access-denied">Access Denied: ${accessResult.reason}</div>`;
    }
  }

  async initializeAccessControl() {
    try {
      const accessResult = await this.checkUserAccess();
      if (!accessResult.hasAccess) {
        await this.showAccessDenied(accessResult);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }
}

const protectApp = new ProtectApp();

export default async function addAppAccessControl() {
  return protectApp.initializeAccessControl();
}
