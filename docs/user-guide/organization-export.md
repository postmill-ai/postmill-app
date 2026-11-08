# Organization export

Organization owners can download a restorable archive from **Settings → Organization export**.

1. Enter a passphrase of at least 12 characters. Use a password manager to keep it safe.
2. Select **Create organization export** and wait for the job to complete.
3. Select **Create download link**, then **Download archive**. The link works once and expires after five minutes.

The archive contains organization configuration, members, designs, posts, provider settings, and file bytes. Provider credentials are encrypted with your passphrase. Billing entitlements, passwords, sessions, API keys, OAuth grants, and background runtime state are not included.

**The passphrase cannot be recovered.** You need it to import the archive. Do not send it with the ZIP file.

Archives are deleted from the server after 24 hours. Create a new export if yours expires. Organization import is delivered separately; export does not change the organization or its integrations.
