/* eslint-disable import/no-unresolved */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { daFetch } from 'https://da.live/nx/utils/daFetch.js';
import { DA_ORIGIN } from 'https://da.live/nx/public/utils/constants.js';

const API_ENDPOINTS = {
  IMS_USERINFO: 'https://ims-na1.adobelogin.com/ims/userinfo/v2',
};

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
      if (!token) return null;

      const response = await daFetch(API_ENDPOINTS.IMS_USERINFO, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const userInfo = await response.json();
        if (userInfo.sub) {
          this.currentUser = { userId: userInfo.sub };
          return this.currentUser;
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Authentication failed:', error.message);
    }
    return null;
  }

  async fetchPermissionsSheet() {
    try {
      const { context } = await DA_SDK;
      const url = `${DA_ORIGIN}/source/${context.org}/${context.repo}/${CONFIG.PERMISSIONS_SHEET_PATH}`;

      const response = await daFetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch permissions sheet: ${response.status}`);
      }

      const data = await response.json();
      const sheetData = data.data || [];

      const pathUsers = {};
      sheetData.forEach((row) => {
        const { path, users } = row;
        if (path) {
          if (users && users.trim()) {
            pathUsers[path.trim()] = users.split(',').map((u) => u.trim());
          } else {
            pathUsers[path.trim()] = []; // Empty array = open for all
          }
        }
      });

      this.pathUsers = pathUsers;
      return pathUsers;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Permissions fetch failed:', error.message);
      this.pathUsers = {};
      return {};
    }
  }

  async checkUserAccess(appPath = this.currentPath) {
    if (!appPath) return { hasAccess: true, user: null, reason: 'No restrictions applied' };

    await this.fetchPermissionsSheet();

    if (!this.pathUsers[appPath]) {
      return { hasAccess: false, user: null, reason: 'Path not configured for access' };
    }

    const user = await this.getIMSUser();
    if (!user?.userId) {
      return { hasAccess: false, reason: 'User not authenticated', user: null };
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
      let htmlTemplate = await response.text();
      htmlTemplate = htmlTemplate
        .replace('{{reason}}', accessResult.reason)
        .replace('{{userId}}', accessResult.user?.userId || 'Not available');
      appContainer.innerHTML = htmlTemplate;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to load access denied template:', error);
    }
  }

  async initializeAccessControl() {
    try {
      const accessResult = await this.checkUserAccess();
      if (accessResult.hasAccess) return true;

      await this.showAccessDenied(accessResult);
      return false;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Access control failed:', error.message);
      return false;
    }
  }
}

const protectApp = new ProtectApp();

export default async function addAppAccessControl() {
  return protectApp.initializeAccessControl();
}
