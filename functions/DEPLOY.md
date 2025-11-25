# Firebase Functions Deployment Guide

## Prerequisites

1. Install Firebase CLI globally:
```bash
npm install -g firebase-tools
```

2. Login to Firebase:
```bash
firebase login
```

3. Initialize Firebase in your project (if not already done):
```bash
cd /Volumes/chao/AI/xianyu_profit_calculator
firebase init
```
Select:
- Functions
- Use existing project: `zaoyoe-9bdf2`
- JavaScript
- Install dependencies: Yes

## Setup Resend API Key

1. Register on Resend: https://resend.com
2. Get your API key from the dashboard
3. Set it in Firebase config:

```bash
firebase functions:config:set resend.apikey="YOUR_RESEND_API_KEY_HERE"
```

## Install Dependencies

```bash
cd functions
npm install
```

## Deploy Functions

Deploy only the functions:
```bash
firebase deploy --only functions
```

Or deploy everything:
```bash
firebase deploy
```

## Test the Function

After deployment, test the password reset:
1. Go to your website
2. Click "忘记密码了吗？"
3. Enter a registered email
4. Click "找回"
5. Check your inbox (not spam!) for the beautiful email

## Verify Deployment

Check if the function is deployed:
```bash
firebase functions:list
```

You should see: `sendPasswordResetEmail`

## View Logs

To see real-time logs:
```bash
firebase functions:log
```

## Troubleshooting

### Error: "Cloud Function not found"
- Make sure you deployed: `firebase deploy --only functions`
- Check the function name matches: `sendPasswordResetEmail`

### Error: "Missing API key"
- Set the Resend API key: `firebase functions:config:set resend.apikey="..."`
- Redeploy functions after setting config

### Emails not arriving
- Check Resend dashboard for delivery status
- Verify API key is correct
- Check spam folder (should NOT be there with Resend!)

## Next Steps

Once deployed:
1. Test with an unregistered email (should show error)
2. Test with a registered email (should receive email in inbox)
3. Verify 30-second cooldown works
4. Check email arrives in **inbox**, not spam ✅
