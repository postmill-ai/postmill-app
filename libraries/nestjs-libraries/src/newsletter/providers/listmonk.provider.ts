import { NewsletterInterface } from '@gitroom/nestjs-libraries/newsletter/newsletter.interface';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';

export class ListmonkProvider implements NewsletterInterface {
  name = 'listmonk';
  async register(email: string) {
    const body = {
      email,
      status: 'enabled',
      lists: [+process.env.LISTMONK_LIST_ID].filter((f) => f),
    };

    const authString = `${process.env.LISTMONK_USER}:${process.env.LISTMONK_API_KEY}`;
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('Accept', 'application/json');
    headers.set(
      'Authorization',
      'Basic ' + Buffer.from(authString).toString('base64')
    );

    // D5: routed through safeFetch for SSRF-safe dispatch consistency.
    // LISTMONK_DOMAIN is an operator-set env var; self-hosted instances on a
    // private network must allow their host via SSRF_ALLOWED_PRIVATE_CIDRS,
    // otherwise safeFetch's public-only check rejects it.
    try {
      const {
        data: { id },
      } = await (
        await safeFetch(`${process.env.LISTMONK_DOMAIN}/api/subscribers`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        })
      ).json();

      const welcomeEmail = {
        subscriber_id: id,
        template_id: +process.env.LISTMONK_WELCOME_TEMPLATE_ID,
        subject: 'Welcome to Postmill 🚀',
      };

      await safeFetch(`${process.env.LISTMONK_DOMAIN}/api/tx`, {
        method: 'POST',
        headers,
        body: JSON.stringify(welcomeEmail),
      });
    } catch (err) {}
  }
}
