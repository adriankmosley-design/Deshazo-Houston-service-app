// Microsoft sends the sign-in popup back here; this hands the result to the app window.
import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge'

broadcastResponseToMainFrame().catch(() => {
  document.body.textContent = 'Sign-in finished. You can close this window.'
})
