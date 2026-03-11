# Scheduler Plugin

The Scheduler plugin allows you to schedule page publish actions in AEM Document Authoring (DA) Edge Delivery Services using the [AEM Snapshot API](https://www.aem.live/docs/admin.html#tag/snapshot). It uses the same APIs as the [snapshot-admin](https://main--helix-website--adobe.aem.page/tools/snapshot-admin/) tool.

## Features

- **Schedule Publish**: Schedule when to publish the current page via AEM snapshots
- **Flexible Scheduling**: Use date/time picker
- **Active Schedule Display**: View all scheduled publishes for the site
- **Snapshot Integration**: Creates snapshots, adds the page, locks for review, and registers with the helix-snapshot-scheduler
- **Cleanup on Startup**: Automatically deletes old scheduled snapshots (whose publish time has passed) when the plugin opens
- **Real-time Feedback**: Status messages and loading indicators
- **Accessibility**: Full keyboard navigation and screen reader support

## Prerequisites

- Your org/site must be registered for the [helix-snapshot-scheduler](https://helix-snapshot-scheduler-ci.adobeaem.workers.dev) (done separately; this plugin does not perform registration)

## Required Permissions

Users must have the following AEM Admin API permissions to schedule a snapshot:

| Permission      | Purpose                                                           |
|-----------------|-------------------------------------------------------------------|
| `preview:write` | Create snapshots, add content, and lock for review                |
| `live:write`    | Unlock snapshots during cleanup; used by the scheduler to publish|

The [helix-snapshot-scheduler](https://github.com/adobe/helix-snapshot-scheduler) validates that users have access to the AEM Snapshot List API (`GET /snapshot/{org}/{site}/main`) before allowing scheduling.

The **author** role typically includes `preview:write`; the **publish** role includes `live:write`. Ensure users have both to use the scheduler.

## Setup

### 1. Prerequisites

- AEM Document Authoring (DA) Edge Delivery Services project
- AEM CLI installed (for local dev: `sudo npm install -g @adobe/aem-cli`)

### 2. Installation

The scheduler plugin is already included in this project. To use it:

1. Ensure your DA project is properly configured
2. The scheduler files are located in `tools/scheduler/`
3. No additional installation steps required

### 3. Configuration

The scheduler automatically uses your DA project's library configuration (Site CONFIG > Library Sheet):
- **title**: Scheduler
- **path**: `/tools/scheduler/scheduler.html`  
- **icon**: `https://da.live/blocks/edit/img/S2_icon_Calendar_20_N.svg`
- **experience**: dialog

#### Snapshot Scheduler
- Your site must be registered at `https://helix-snapshot-scheduler-ci.adobeaem.workers.dev/register/{org}/{site}`

## Usage

### Accessing the Scheduler

1. **Via Sidekick**: The scheduler can be accessed through the AEM Sidekick interface
2. **Direct URL**: Navigate to `{your-da-url}/tools/scheduler/scheduler.html`
3. **Local Development**: Run `aem up` and access via localhost

### Scheduling a Page Publish

#### Step 1: Set Schedule Time
1. Use the date/time picker to select when to publish
2. The scheduled time must be at least 5 minutes in the future

#### Step 2: Schedule
Click the "Schedule" button. The plugin will:
1. Create a new snapshot for this scheduled publish
2. Add the current page to the snapshot
3. Lock the snapshot for review
4. Register the publish time with the helix-snapshot-scheduler

At the scheduled time, the snapshot will be automatically published to production.

### Viewing Active Schedules

The scheduler displays all scheduled publishes for the site in the "Active Schedules" section. Each schedule shows:
- **Action**: Publish
- **Time**: Localized display of the scheduled time

### Managing Schedules

- **Real-time Updates**: The active schedules list updates after each new schedule
- **Error Handling**: Failed schedules show error messages with details
- **Snapshot Admin**: Use the [snapshot-admin](https://main--helix-website--adobe.aem.page/tools/snapshot-admin/) tool to view or cancel snapshots

## Technical Details

### Files Structure
```
tools/scheduler/
├── scheduler.html      # Main interface
├── scheduler.js        # Core functionality
├── scheduler.css       # Styling
├── snapshot-utils.js   # AEM Snapshot API utilities (same as snapshot-admin)
└── README.md          # This documentation
```

### Key Functions

- **`init()`**: Initializes the scheduler interface
- **`schedulePublishViaSnapshot()`**: Creates snapshot, adds page, locks, and registers schedule
- **`showCurrentSchedule()`**: Displays scheduled publishes from helix-snapshot-scheduler

### API Endpoints (AEM Snapshot API)

- **GET** `https://admin.hlx.page/snapshot/{org}/{site}/main` - List snapshots
- **GET** `https://admin.hlx.page/snapshot/{org}/{site}/main/{snapshotId}` - Get manifest
- **POST** `https://admin.hlx.page/snapshot/{org}/{site}/main/{snapshotId}` - Create/update manifest
- **POST** `https://admin.hlx.page/snapshot/{org}/{site}/main/{snapshotId}/*` - Add resources
- **POST** `https://admin.hlx.page/snapshot/{org}/{site}/main/{snapshotId}?review=request` - Lock snapshot
- **POST** `https://helix-snapshot-scheduler-ci.adobeaem.workers.dev/schedule` - Register scheduled publish

## Troubleshooting

### Common Issues

1. **"Failed to save schedule"**
   - Check your DA authentication
   - Verify repository permissions
   - Check browser console for detailed errors

2. **"Please select a future date and time"**
   - Ensure the selected date/time is in the future
   - Check your system clock

3. **"No scheduling data available"**
   - This is normal for pages without active schedules
   - Create a new schedule to see it appear

4. **Custom cron expression errors**
   - Verify the format matches the expected pattern
   - Check for typos in month names or time format

### Debug Mode

Enable browser developer tools to see detailed error messages and API responses in the console.

## Best Practices

1. **Future Dates Only**: The system only accepts dates at least 5 minutes in the future
2. **Snapshot Admin**: Use the snapshot-admin tool to manage or cancel snapshots
3. **Documentation**: See the [AEM Snapshot API docs](https://www.aem.live/docs/admin.html#tag/snapshot)

## Support

For additional help:
- Check the [AEM Documentation](https://www.aem.live/docs/scheduling)
- Review browser console for error details
- Ensure your DA project is properly configured

## Security

- All requests are authenticated using DA SDK tokens
- Users require `preview:write` and `live:write` permissions (see [Required Permissions](#required-permissions))
- Schedules are scoped to specific page paths
- No sensitive data is stored in the browser
