# Template store integration

How the **Postmill template store** (templates.postmill.ai) pushes a template directly
into a user's Postmill org, on top of [Postmill ID](./postmill-id.md) sign-in. This is
the first **write** capability in federation — identity scopes (`profile email org`)
read claims; the `templates:install` capability scope authorizes the install endpoint.

## Flow

```text
1. Sign the user in with Postmill ID (authorization code + PKCE S256), requesting
   scope:  profile email org templates:install
   The consent screen lists "Install templates into your Postmill designs" — the user
   sees the capability by name before approving.
2. Exchange the code at POST /federation/token as usual. The response's `scope`
   echoes what was granted; check it contains templates:install.
3. To install a template, POST /federation/install-template with the posf_ token:
     Authorization: Bearer posf_…
     multipart/form-data, field name: file — the .pdesign bundle (or a raw
     DesignerDoc .json). 1 GB cap; the file is sniffed (zip magic) server-side.
4. The instance runs the full import pipeline (bundled assets are re-uploaded into
   the user's org, doc references rewritten, fonts restored) and returns:
     { "designId": "…", "openUrl": "https://<instance-frontend>/media/designer?designId=…" }
5. Redirect the user to openUrl — the imported design opens in the Designer.
```

```bash
curl -X POST https://instance.example.com/federation/install-template \
  -H 'Authorization: Bearer posf_…' \
  -F 'file=@/path/to/template.pdesign'
```

```json
{
  "designId": "cm…",
  "openUrl": "https://app.example.com/media/designer?designId=cm…"
}
```

## Errors

| Status | Body | Meaning |
|---|---|---|
| 401 | `{ "error": "invalid_token" }` | Missing/malformed/expired/revoked `posf_` token (tokens live 1 h) |
| 403 | `{ "error": "insufficient_scope", … }` | The grant was not consented with `templates:install` — restart the flow with the scope |
| 400 | `{ "message": … }` | Unreadable/foreign/too-new `.pdesign` file, or a schema-invalid document |

The endpoint is throttled to 20 installs/minute per caller.

## Self-hosters and manual import

The store can also serve a plain `.pdesign` **download**: users import it themselves
in the Designer (File → Import Design File…, or the start dialog's Import .pdesign
card). That path needs no federation at all and works for instances unreachable from
the store backend. Format v2 bundles are self-contained (media + fonts included), so
a downloaded file imports cleanly into any org.
