export function PrivacySteps() {
  return (
    <ol>
      <li>
        After this page has loaded, turn off Wi-Fi or switch to airplane mode. Blackout keeps working, because it
        never needs the network.
      </li>
      <li>
        Or open your browser’s developer tools (F12), go to the <em>Network</em> tab, then open and export a file. No
        request is made.
      </li>
      <li>
        The page’s Content Security Policy sets <code>connect-src 'self'</code>, so the browser itself refuses to send
        data to any other server.
      </li>
      <li>The code is open source. You can read it, build it yourself and compare.</li>
    </ol>
  );
}

export function PrivacyBanner() {
  return (
    <details className="privacy" data-testid="privacy-banner">
      <summary>
        <strong>Your file never leaves this device.</strong> Everything runs in your browser. Nothing is uploaded or
        stored. <span className="link">How to verify</span>
      </summary>
      <div className="privacy-body">
        <PrivacySteps />
      </div>
    </details>
  );
}
