# Access Control for Custom DA Applications

Restrict app access for your Custom DA apps using Adobe IMS and DA sheets.

## Setup

1. Add to your app:

```javascript
import addAppAccessControl from '../access-control/access-control.js';

async function startApp() {
  const hasAccess = await addAppAccessControl();
  if (hasAccess) {
    // Your app code
  }
}
startApp();
```

2. Create permissions sheet:
   - Go to `https://da.live/#/ORG/SITE/.da`
   - Create sheet named `da-apps-permissions`
   - Add columns: `Path` | `Users`
   - Add rows like: `/tools/search.html` | `USER_ID_1, USER_ID_2`

## Get your User ID

1. Login to DA: `https://da.live/#/ORG/SITE`
2. Click emoji icon (top right)
3. Click your name to copy Adobe Entity ID
4. Use this ID in the permissions sheet

## How it works

- Checks current app path against `https://da.live/sheet#/ORG/SITE/.da/da-apps-permissions.json`
- Authenticates user via Adobe IMS
- Grants access if user ID is in the sheet
- Shows access denied screen if not authorized

