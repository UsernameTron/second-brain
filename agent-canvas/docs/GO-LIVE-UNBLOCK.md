# Unblocking "Access blocked: … has not completed the Google verification process"

**Symptom:** Sign-in works, but **Connect Google Workspace** ends in
`Error 403: access_denied` — "can only be accessed by developer-approved
testers."

**Why (one paragraph):** The app requests Gmail scopes, which Google classes
as *restricted*. The project lives under a personal Google account, outside
the cloudtechgurus.com organization, so the consent screen cannot be
**Internal** (which would waive all of this). An External, unverified app in
**Testing** may grant restricted scopes ONLY to accounts listed as test
users. This is Google's wall, not the app's — the app's own allowlist never
even gets a chance to run.

Three ways through, ranked:

## Path 1 — Test users (10 minutes, full capability, the intended v1 path)

1. Open **as the project-owner identity** (the personal gmail — the work
   account has no access to this project):
   `https://console.cloud.google.com/auth/audience?project=agent-canvas-ctg-0811&authuser=cpeteconnor@gmail.com`
2. Confirm the page header shows project **agent-canvas-ctg-0811** and
   Publishing status **Testing**.
3. Under **Test users → + Add users**: `pete@cloudtechgurus.com`, `fred@…`,
   `darren@…`, `jessica@…` (real mailboxes). **Save.**
4. Verify they now appear in the list. If the page errors, the browser tab is
   on the wrong Google identity — fix the `authuser`.
5. Wait 2–5 minutes. Retry Connect **in a fresh tab** (Google caches the
   denial for a bit). Still blocked after 15 minutes with the list verified →
   the consent screen being edited is not the one this client id belongs to;
   re-check the project selector.

## Path 2 — Move the project into the org, go Internal (permanent fix)

Internal consent screens have **no verification, no tester list, no caps** —
this is the destination state. Requires a cloudtechgurus.com **Organization
Administrator** (likely via Workspace super-admin):

```bash
gcloud beta projects move agent-canvas-ctg-0811 --organization <ORG_ID>
```
Non-destructive; nothing redeploys. Then: Google Auth Platform → Audience →
switch User type to **Internal**. Done forever. (Also fixes billing
ownership and the recurring authuser whack-a-mole.)

## Path 3 — Standard scope mode (5 minutes, no tester list, costs Gmail)

Built 2026-08-12 as the escape hatch. Drops exactly the restricted scopes
(gmail.readonly, gmail.compose, drive.readonly); Sheets, Calendar, and
Docs-create connect for ANY member via Google's click-through interstitial.
Gmail tools disappear from agents entirely (absent, not erroring), and the
GMAIL lamp says why.

```bash
gcloud run services update agent-canvas --project agent-canvas-ctg-0811 \
  --region us-central1 --update-env-vars GOOGLE_WORKSPACE_SCOPES=standard
```
Anyone already connected should disconnect/reconnect. Flip back with
`GOOGLE_WORKSPACE_SCOPES=full` after Path 1 or 2 lands.

## While blocked, everything else still works

Canvas, agents on Vertex, memory, roundtable, workbook, HubSpot Ops Runner
(when wired), MCP — none of these touch the Google OAuth grant. The block
only fences the six Workspace scopes.
