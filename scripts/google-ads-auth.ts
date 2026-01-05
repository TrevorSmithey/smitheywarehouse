/**
 * Google Ads OAuth Token Generator
 *
 * Run: npx tsx scripts/google-ads-auth.ts
 *
 * Requires GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET in .env.local
 */

import http from 'http';
import open from 'open';

const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET!;
const REDIRECT_URI = 'http://localhost:3333/callback';
const SCOPE = 'https://www.googleapis.com/auth/adwords';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing GOOGLE_ADS_CLIENT_ID or GOOGLE_ADS_CLIENT_SECRET in environment');
  process.exit(1);
}

async function getRefreshToken(): Promise<void> {
  return new Promise((resolve) => {
    // Create a simple server to catch the callback
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:3333`);

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');

        if (code) {
          // Exchange code for tokens
          const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              code,
              client_id: CLIENT_ID,
              client_secret: CLIENT_SECRET,
              redirect_uri: REDIRECT_URI,
              grant_type: 'authorization_code',
            }),
          });

          const tokens = await tokenResponse.json();

          if (tokens.refresh_token) {
            console.log('\n' + '='.repeat(60));
            console.log('SUCCESS! Here is your refresh token:');
            console.log('='.repeat(60));
            console.log('\nGOOGLE_ADS_REFRESH_TOKEN=' + tokens.refresh_token);
            console.log('\n' + '='.repeat(60));

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body style="font-family: system-ui; padding: 40px; text-align: center;">
                  <h1>✅ Authorization Successful!</h1>
                  <p>You can close this window and return to the terminal.</p>
                  <p style="color: #666;">Refresh token has been printed to the console.</p>
                </body>
              </html>
            `);
          } else {
            console.error('Error getting refresh token:', tokens);
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`<html><body><h1>Error</h1><pre>${JSON.stringify(tokens, null, 2)}</pre></body></html>`);
          }
        } else {
          const error = url.searchParams.get('error');
          console.error('Authorization error:', error);
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h1>Error: ${error}</h1></body></html>`);
        }

        // Close server after handling
        setTimeout(() => {
          server.close();
          resolve();
        }, 1000);
      }
    });

    server.listen(3333, () => {
      // Build authorization URL
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', SCOPE);
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent'); // Force consent to get refresh token

      console.log('Opening browser for Google authorization...');
      console.log('\nIf browser doesn\'t open, visit this URL:');
      console.log(authUrl.toString());
      console.log('\nWaiting for authorization...\n');

      // Open browser
      open(authUrl.toString());
    });
  });
}

getRefreshToken().then(() => {
  console.log('\nDone! You can now use the Google Ads API.');
  process.exit(0);
}).catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
