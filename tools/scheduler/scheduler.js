/* eslint-disable import/no-absolute-path */
/* eslint-disable no-console */
/* eslint-disable eol-last */
/* eslint-disable import/no-unresolved */

// Import SDK for Document Authoring
import DA_SDK from 'https://da.live/nx/utils/sdk.js';

// Base URL for Document Authoring source
const DA_SOURCE = 'https://admin.da.live/source';
const CRON_TAB_PATH = '.helix/crontab.json';
const AEM_PREVIEW_REQUEST_URL = 'https://admin.hlx.page/preview';

// Combine message handling into a single utility
const messageUtils = {
  container: document.querySelector('.message-wrapper'),
  show(text, isError = false) {
    const message = this.container.querySelector('.message');
    message.innerHTML = text.replace(/\r?\n/g, '<br>');
    message.classList.toggle('error', isError);
  },
  setLoading(loading) {
    this.container.classList.toggle('loading', loading);
    this.container.classList.toggle('regular', !loading);
  },
};

/**
 * Shows existing schedules for the current path in the feedback container
 * @param {string} path - Current page path to check schedules for
 * @param {Object} json - Crontab data object
 * @param {Array} json.data - Array of schedule entries
 */
function displaySchedules(path, json) {
  if (!json?.data?.length) {
    messageUtils.show(`No scheduling data available for ${path}`, true);
    return;
  }

  const schedules = json.data.filter((row) => row.command.includes(path));
  if (!schedules.length) {
    messageUtils.show(`No scheduling data available for ${path}`, true);
    return;
  }

  const scheduleList = schedules
    .map((row) => `${row.command.split(' ')[0]}ing ${row.when}`)
    .join('\r\n');
  messageUtils.show(`Schedules for ${path}:\r\n${scheduleList}`);
}

/**
 * Previews the crontab file
 * @param {string} url - API endpoint URL
 * @param {Object} opts - Request options
 * @param {string} opts.method - HTTP method (POST)
 * @returns {Promise<void>}
 */
async function previewCronTab(url, opts) {
  const newOpts = { ...opts, method: 'POST' };
  const previewReqUrl = url.replace(DA_SOURCE, AEM_PREVIEW_REQUEST_URL).replace(CRON_TAB_PATH, `main/${CRON_TAB_PATH}`);
  try {
    const resp = await fetch(previewReqUrl, newOpts);
    if (!resp.ok) {
      messageUtils.show('Failed to activate schedule , please check console for more details', true);
      return false;
    }
    return true;
  } finally {
    messageUtils.setLoading(false);
  }
}

/**
 * Sends updated scheduling data to the server
 * @param {string} url - API endpoint URL
 * @param {Object} opts - Request options including body and method
 * @param {FormData} opts.body - Form data containing updated schedule
 * @param {string} opts.method - HTTP method (POST)
 * @returns {Promise<Object|null>} Parsed JSON response or null if failed
 */
async function setSchedules(url, opts) {
  // Send request
  try {
    const resp = await fetch(url, opts);
    if (!resp.ok) {
      throw new Error(`Failed to set schedules: ${resp.status}`);
    }
    return resp.json();
  } catch (error) {
    console.error(error.message);
    messageUtils.show('Failed to save schedule, please check console for more details', true);
    return null;
  }
}

// Add the cleanupPastSchedules function near the top with other utility functions
function cleanupPastSchedules(json) {
  if (!json?.data?.length) return json;

  const now = new Date();
  const cleanedData = json.data.filter((schedule) => {
    const match = schedule.when.match(/at (\d+:\d+\s*(?:AM|PM)) on the (\d+)(?:st|nd|rd|th) day of (\w+) in (\d+)/i);
    if (!match) return true;

    const [, timeStr, day, month, year] = match;
    const monthIndex = new Date(`${month} 1, 2000`).getMonth();

    const [hours, minutes] = timeStr.match(/(\d+):(\d+)/).slice(1);
    let hour = parseInt(hours, 10);
    const minute = parseInt(minutes, 10);
    if (timeStr.toUpperCase().includes('PM') && hour < 12) hour += 12;
    if (timeStr.toUpperCase().includes('AM') && hour === 12) hour = 0;

    const scheduleDate = new Date(Date.UTC(
      parseInt(year, 10),
      monthIndex,
      parseInt(day, 10),
      hour,
      minute,
    ));

    return scheduleDate > now;
  });

  return { ...json, data: cleanedData };
}

/**
 * Fetches current scheduling data from the server
 * @param {string} url - API endpoint URL
 * @param {Object} opts - Request options
 * @param {string} opts.method - HTTP method (GET)
 * @param {Object} opts.headers - Request headers including auth token
 * @returns {Promise<Object|null>} Parsed JSON response or null if failed
 */
async function getSchedules(url, opts) {
  try {
    const resp = await fetch(url, opts);
    if (!resp.ok) {
      throw new Error(`Failed to fetch schedules: ${resp.status}`);
    }
    const json = await resp.json();

    // Clean up past schedules before returning
    const cleanedJson = cleanupPastSchedules(json);

    // If schedules were removed, update the crontab
    if (cleanedJson.data.length < json.data.length) {
      const body = new FormData();
      body.append('data', new Blob([JSON.stringify(cleanedJson)], { type: 'application/json' }));

      // Update crontab with cleaned data
      await setSchedules(url, { ...opts, body, method: 'POST' });

      // Preview the changes
      await previewCronTab(url, opts);
    }

    return cleanedJson;
  } catch (error) {
    console.error(error.message);
    messageUtils.show('Failed to fetch, please check console for more details', true);
    return null;
  }
}

// Update the createCronExpression function
function createCronExpression(localDate) {
  const utcDate = new Date(localDate.toUTCString());
  const day = utcDate.getUTCDate();
  const suffix = ['th', 'st', 'nd', 'rd'][(day % 10 > 3 || day < 21) ? 0 : day % 10];

  // Format time separately
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  });

  // Format month separately
  const monthFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    timeZone: 'UTC',
  });

  return `at ${timeFormatter.format(utcDate)} on the ${day}${suffix} day of ${
    monthFormatter.format(utcDate)
  } in ${utcDate.getUTCFullYear()}`;
}

/**
 * Processes a schedule command by updating the crontab
 * @param {string} url - API endpoint URL
 * @param {Object} opts - Request options
 * @param {string} command - Command type ('preview' or 'publish')
 * @param {string} pagePath - Path of page to schedule
 * @param {string} cronExpression - Schedule expression
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function processCommand(url, opts, command, pagePath, cronExpression) {
  if (!cronExpression?.trim()) return false;

  const json = await getSchedules(url, opts);
  if (!json) {
    messageUtils.show(`Please make sure ${CRON_TAB_PATH} is present and is accessible`, true);
    return false;
  }

  const existingCommand = `${command} ${pagePath}`;

  json.data = [
    ...json.data.filter((row) => row.command !== existingCommand),
    { when: cronExpression.trim(), command: existingCommand },
  ];

  const body = new FormData();
  body.append('data', new Blob([JSON.stringify(json)], { type: 'application/json' }));

  const newJson = await setSchedules(url, { ...opts, body, method: 'POST' });
  if (!newJson) return false;

  // Only clear message and show schedules if preview is successful
  const previewSuccess = await previewCronTab(url, opts);
  if (previewSuccess) {
    messageUtils.show('');
    displaySchedules(pagePath, await getSchedules(url, opts));
    return true;
  }
  return false;
}

// Update showCurrentSchedule function's date parsing logic:
function showCurrentSchedule(path, json) {
  const schedules = json.data.filter((row) => row.command.includes(path));
  const content = document.querySelector('.schedule-content');

  if (schedules.length === 0) {
    content.textContent = 'No active schedules found';
  } else {
    content.innerHTML = '';
    schedules.forEach((schedule) => {
      const row = document.createElement('div');
      row.className = 'schedule-row';

      const action = document.createElement('div');
      action.className = 'schedule-action';
      const actionText = schedule.command.split(' ')[0];
      action.textContent = actionText.charAt(0).toUpperCase() + actionText.slice(1);

      const time = document.createElement('div');
      time.className = 'schedule-time';

      // Convert UTC schedule time to local time for display
      const whenParts = schedule.when.match(/at (.*?) on the/);
      if (whenParts) {
        const utcTimeStr = whenParts[1];
        const utcDateStr = schedule.when.match(/the (\d+).*? day of (.*?) in (\d+)/);
        if (utcDateStr) {
          const [, day, month, year] = utcDateStr;
          // Create a proper date string that JavaScript can parse
          const monthIndex = new Date(`${month} 1, 2000`).getMonth(); // Get month index (0-11)
          const utcDate = new Date(Date.UTC(
            year,
            monthIndex,
            day,
            ...utcTimeStr.match(/(\d+):(\d+)/).slice(1).map(Number),
          ));

          const timeFormatter = new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          });
          const dateFormatter = new Intl.DateTimeFormat('en-US', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          });

          const formattedTime = timeFormatter.format(utcDate);
          const formattedDate = dateFormatter.format(utcDate);
          time.textContent = `at ${formattedTime} on ${formattedDate}`;
        } else {
          time.textContent = schedule.when;
        }
      } else {
        time.textContent = schedule.when;
      }

      row.append(action, time);
      content.appendChild(row);
    });
  }
}

// Add validation function for future date/time
function isDateTimeInFuture(dateStr, timeStr) {
  const selectedDateTime = new Date(`${dateStr}T${timeStr}`);
  const now = new Date();
  return selectedDateTime > now;
}

/**
 * Initializes the scheduler interface
 * @returns {Promise<void>}
 */
async function init() {
  const { context, token } = await DA_SDK;

  // Set page path
  const pageInput = document.getElementById('page-path');
  pageInput.value = context.path;

  // Handle custom button
  const customButton = document.querySelector('.custom-button');
  const cronExpressionContainer = document.querySelector('.cron-expression-container');
  const customInput = document.querySelector('.custom-input');
  const dateInput = document.querySelector('#date-input');
  const timeInput = document.querySelector('#time-input');

  // Set current date and time as default values
  const now = new Date();
  const [dateValue] = now.toISOString().split('T');
  dateInput.value = dateValue;
  timeInput.value = now.toTimeString().slice(0, 5);

  customButton.addEventListener('click', () => {
    const isCustom = !cronExpressionContainer.classList.contains('custom-mode');
    cronExpressionContainer.classList.toggle('custom-mode');

    // Clear any existing empty states
    [dateInput, timeInput, customInput].forEach((input) => {
      input.classList.remove('input-empty');
    });

    if (isCustom) {
      customInput.remove();
      cronExpressionContainer.insertBefore(customInput, customButton);
    } else {
      customInput.remove();
      const whenGroup = document.querySelector('.input-group:has(#date-input)');
      whenGroup.appendChild(customInput);
    }
  });

  // Handle docs button
  const docsButton = document.querySelector('.docs-button');
  docsButton.addEventListener('click', () => {
    window.open('https://www.aem.live/docs/scheduling', '_blank');
  });
  const url = `${DA_SOURCE}/${context.org}/${context.repo}/${CRON_TAB_PATH}`;
  const opts = {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };
  // Handle schedule button
  const scheduleButton = document.querySelector('.schedule-button');
  scheduleButton.addEventListener('click', async (e) => {
    e.preventDefault();

    const action = document.querySelector('.action-select').value;
    const isCustomMode = cronExpressionContainer.classList.contains('custom-mode');

    // Clear previous empty states
    [dateInput, timeInput, customInput].forEach((input) => {
      input.classList.remove('input-empty');
    });

    // Check for empty inputs and future date/time based on mode
    if (isCustomMode) {
      if (!customInput.value) {
        customInput.classList.add('input-empty');
        return;
      }
    } else {
      let hasError = false;
      if (!dateInput.value) {
        dateInput.classList.add('input-empty');
        hasError = true;
      }
      if (!timeInput.value) {
        timeInput.classList.add('input-empty');
        hasError = true;
      }
      if (hasError) return;

      // Validate if date/time is in the future
      if (!isDateTimeInFuture(dateInput.value, timeInput.value)) {
        dateInput.classList.add('input-empty');
        timeInput.classList.add('input-empty');
        messageUtils.show('Please select a future date and time', true);
        return;
      }
    }

    let cronExpression;
    if (isCustomMode) {
      cronExpression = customInput.value;
    } else {
      const localDate = new Date(`${dateInput.value}T${timeInput.value}`);
      cronExpression = createCronExpression(localDate);
    }

    messageUtils.show('Scheduling page...');
    const success = await processCommand(url, opts, action, context.path, cronExpression);
    if (success) {
      messageUtils.show('');
      // Fetch and update current schedules after successful scheduling
      const json = await getSchedules(url, opts);
      if (json && json.data) {
        showCurrentSchedule(context.path, json);
      }
    }
  });

  // Check existing schedules
  const json = await getSchedules(url, opts);
  if (json && json.data) {
    showCurrentSchedule(context.path, json);
  }
}

init();
