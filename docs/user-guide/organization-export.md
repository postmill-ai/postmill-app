# Organization export

Organization owners can download a restorable archive from **Settings → Organization export**.

1. Enter a passphrase of at least 12 characters. Use a password manager to keep it safe.
2. Select **Create organization export** and wait for the job to complete.
3. Select **Create download link**, then **Download archive**. The link works once and expires after five minutes.

The archive contains organization configuration, members, designs, posts, provider settings, and file bytes. Provider credentials are encrypted with your passphrase. Billing entitlements, passwords, sessions, API keys, OAuth grants, and background runtime state are not included.

**The passphrase cannot be recovered.** You need it to import the archive. Do not send it with the ZIP file.

Archives are deleted from the server after 24 hours. Create a new export if yours expires. Export does not change the source organization or its integrations.

## Import into a new organization

On a new, empty organization, open **Setup → Import** before configuring an LLM. Select the ZIP and enter the same passphrase, then choose **Upload and verify archive**. After verification, choose **Import organization** to start the background import and wait for the workspace to open.

Import is available only to an owner of an empty organization whose setup is incomplete. File bytes are copied into the destination's platform storage. Members and custom roles are restored, while channels, providers, sharing and automation remain disabled for review. Files that were already missing at export are reported and their references are cleared. Keep the passphrase out of screenshots, tickets, and messages.
