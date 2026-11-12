# Organization export

Organization owners can download a restorable archive from **Settings → Organization export**.

1. Enter a passphrase of at least 12 characters. Use a password manager to keep it safe.
2. Select **Create organization export** and wait for the job to complete.
3. Select **Create download link**, then **Download archive**. The link works once and expires after five minutes.

The archive contains organization configuration, members, designs, posts, provider settings, file bytes, and uploaded custom brand fonts. Provider credentials are encrypted with your passphrase. Billing entitlements, passwords, sessions, API keys, OAuth grants, and background runtime state are not included. New exports use the v1.1 format; the importer also accepts existing v1 archives.

**The passphrase cannot be recovered.** You need it to import the archive. Do not send it with the ZIP file.

Archives are deleted from the server 24 hours after the export finishes. Create a new export if yours expires. Export does not change the source organization or its integrations.

## Import into a new organization

On a new, empty organization, open **Setup → Import** before configuring an LLM. Select the ZIP and enter the same passphrase, then choose **Upload and verify archive**. After verification, choose **Import organization** to start the background import and wait for the workspace to open. If verification is interrupted by a temporary server problem, choose **Retry verification** to continue without uploading the ZIP again.

Import is available only to an owner of an empty organization whose setup is incomplete; the signup-created Local Storage row does not count as existing content. File and custom-font bytes are copied into the destination's platform storage. Custom roles are restored and active members receive standard team invitations—nobody is joined automatically, and disabled memberships are not invited. Historical authorship is assigned to the importing owner. Channels, providers, sharing and automation remain disabled for review. Files that were already missing at export are reported and their references are cleared; missing custom-font entries are removed. Video thumbnails are regenerated at the destination. Keep the passphrase out of screenshots, tickets, and messages.

> Verified against v1.5.0
