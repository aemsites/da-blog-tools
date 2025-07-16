# Scheduler Plugin

The Scheduler plugin allows you to schedule page actions (preview, publish, unpublish) in AEM Document Authoring (DA) Edge Delivery Services. This tool provides both a user-friendly date/time picker interface and support for custom cron expressions.

## Features

- **Multiple Actions**: Schedule preview, publish, or unpublish actions
- **Flexible Scheduling**: Use date/time picker or custom cron expressions
- **Active Schedule Display**: View all currently scheduled actions for the current page
- **Automatic Cleanup**: Past schedules are automatically removed
- **Real-time Feedback**: Status messages and loading indicators
- **Accessibility**: Full keyboard navigation and screen reader support

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

#### Cron setup [reference](https://www.aem.live/docs/scheduling)
- **Crontab Path**: `.helix/crontab.json` (create this)

## Usage

### Accessing the Scheduler

1. **Via Sidekick**: The scheduler can be accessed through the AEM Sidekick interface
2. **Direct URL**: Navigate to `{your-da-url}/tools/scheduler/scheduler.html`
3. **Local Development**: Run `aem up` and access via localhost

### Scheduling a Page Action

#### Step 1: Select Action
Choose from three available actions:
- **Preview**: Creates a preview version of the page
- **Publish**: Publishes the page to production
- **Unpublish**: Removes the page from production

#### Step 2: Set Schedule Time

**Option A: Date/Time Picker (Recommended)**
1. Select a date using the date picker
2. Select a time using the time picker
3. The system automatically converts to UTC and creates the appropriate cron expression

**Option B: Custom Cron Expression**
1. Click the "Custom" button to switch to custom mode
2. Enter a cron expression in the format: `at {time} on the {day}{suffix} day of {month} in {year}`
   - Example: `at 2:30 PM on the 15th day of December in 2024`

#### Step 3: Schedule
Click the "Schedule" button to create the scheduled action.

### Viewing Active Schedules

The scheduler displays all active schedules for the current page in the "Active Schedules" section. Each schedule shows:
- **Action**: Preview, Publish, or Unpublish
- **Time**: Localized display of the scheduled time

### Managing Schedules

- **Automatic Cleanup**: Past schedules are automatically removed
- **Real-time Updates**: The active schedules list updates after each new schedule
- **Error Handling**: Failed schedules show error messages with details

## Cron Expression Format

The scheduler uses a custom cron expression format:

```
at {time} on the {day}{suffix} day of {month} in {year}
```

### Examples:
- `at 2:30 PM on the 15th day of December in 2024`
- `at 9:00 AM on the 1st day of January in 2025`
- `at 11:45 PM on the 31st day of March in 2024`

### Time Format:
- 12-hour format with AM/PM
- Hours: 1-12
- Minutes: 00-59

### Date Format:
- Day: 1-31 with appropriate suffix (st, nd, rd, th)
- Month: Full month name
- Year: 4-digit year

## Technical Details

### Files Structure
```
tools/scheduler/
├── scheduler.html      # Main interface
├── scheduler.js        # Core functionality
├── scheduler.css       # Styling
└── README.md          # This documentation
```

### Key Functions

- **`init()`**: Initializes the scheduler interface
- **`processCommand()`**: Handles schedule creation
- **`getSchedules()`**: Fetches current schedules
- **`setSchedules()`**: Saves new schedules
- **`cleanupPastSchedules()`**: Removes expired schedules
- **`createCronExpression()`**: Converts date/time to cron format

### API Endpoints

- **GET** `{DA_SOURCE}/{org}/{repo}/.helix/crontab.json` - Fetch schedules
- **POST** `{DA_SOURCE}/{org}/{repo}/.helix/crontab.json` - Save schedules
- **POST** `https://admin.hlx.page/preview/main/.helix/crontab.json` - Preview changes

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

1. **Test with Preview**: Always test your scheduling with preview actions before publishing
2. **Future Dates Only**: The system only accepts future dates and times
3. **UTC Awareness**: All times are stored in UTC but displayed in local time
4. **Regular Cleanup**: The system automatically removes past schedules
5. **Documentation**: Use the "Read Documentation" button for official AEM scheduling docs

## Support

For additional help:
- Check the [AEM Documentation](https://www.aem.live/docs/scheduling)
- Review browser console for error details
- Ensure your DA project is properly configured

## Security

- All requests are authenticated using DA SDK tokens
- Schedules are scoped to specific page paths
- No sensitive data is stored in the browser
