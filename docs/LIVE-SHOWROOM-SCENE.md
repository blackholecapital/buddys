# Live showroom scene

Showroom now requests registered avatar variant `showroom` on assistant `buddy`.
The canonical Command Center adapter selects the committed buddy-show.PNG URL,
while retaining Buddy's currently stored voice and ordinary avatar. The browser
cannot supply another image URL. Unknown variants fail without a fallback.
The UI keeps its showroom scene during connection and after failure. Other
formats continue requesting the existing default Buddy avatar.

The kit was generated with the Command Center tenant:kit exporter, including its
current canonical settings components. No sealed files were hand-patched.
The prior BUDDY_SHOWROOM_ASSISTANT_ID variable is no longer used or needed.

## Deploy after the companion Command Center and Buddy PRs are merged

From the Buddy repository only:

```bash
bash scripts/deploy-buddy-showroom.sh
```

This checks the published scene hash, deploys buddys-assistant-adapter with
existing ordinary variables preserved, then uses the existing customer release
script for Pages, Dashboard and Concierge. No Command Center Worker or host
service deployment is needed. No new keys or voice upload is required.

Verify in the browser: Showroom video animates the standing scene, with voice;
Message and regular Video retain seated Buddy. Test switching formats and ending
sessions. A fixed wide-camera prompt requests full-body framing, but actual
provider motion/framing must be checked live. Automated tests use media doubles.

Rollback: redeploy the previous Buddy kit and customer release from the prior
reviewed commit. Stored default avatar and voice are not modified by this release.
