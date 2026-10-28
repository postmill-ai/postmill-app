import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateDto, WebhooksDto } from './webhooks.dto';
import { SUPPORTED_WEBHOOK_EVENTS } from './webhooks.events';

// Literal public IP keeps IsSafeWebhookUrl off the network (no DNS lookup for IPs).
const validBody = {
  name: 'My hook',
  url: 'https://8.8.8.8/hook',
  events: ['post.published'],
  integrations: [],
};

const eventsErrors = (errors: { property: string }[]) =>
  errors.filter((e) => e.property === 'events');

describe('WebhooksDto events validation', () => {
  it('accepts a valid create body', async () => {
    const dto = plainToInstance(WebhooksDto, validBody);

    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts every supported event type', async () => {
    const dto = plainToInstance(WebhooksDto, {
      ...validBody,
      events: [...SUPPORTED_WEBHOOK_EVENTS],
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a missing events field', async () => {
    const { events: _events, ...withoutEvents } = validBody;
    const dto = plainToInstance(WebhooksDto, withoutEvents);

    expect(eventsErrors(await validate(dto)).length).toBeGreaterThan(0);
  });

  it('rejects an empty events array', async () => {
    const dto = plainToInstance(WebhooksDto, { ...validBody, events: [] });

    expect(eventsErrors(await validate(dto)).length).toBeGreaterThan(0);
  });

  it('rejects an unsupported event type', async () => {
    const dto = plainToInstance(WebhooksDto, {
      ...validBody,
      events: ['post.published', 'user.signup'],
    });

    expect(eventsErrors(await validate(dto)).length).toBeGreaterThan(0);
  });

  it('rejects non-string event entries', async () => {
    const dto = plainToInstance(WebhooksDto, {
      ...validBody,
      events: ['post.published', 42],
    });

    expect(eventsErrors(await validate(dto)).length).toBeGreaterThan(0);
  });
});

describe('UpdateDto events validation', () => {
  it('accepts a valid update body', async () => {
    const dto = plainToInstance(UpdateDto, { ...validBody, id: 'hook-1' });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an unsupported event type on update too', async () => {
    const dto = plainToInstance(UpdateDto, {
      ...validBody,
      id: 'hook-1',
      events: ['analytics.anomaly_detected', 'not.real'],
    });

    expect(eventsErrors(await validate(dto)).length).toBeGreaterThan(0);
  });
});

describe('SUPPORTED_WEBHOOK_EVENTS catalog', () => {
  it('locks the supported event set (UI options and dispatch sites must match)', () => {
    expect([...SUPPORTED_WEBHOOK_EVENTS]).toEqual([
      'post.published',
      'post.failed',
      'comment.new',
      'comment.reply',
      'analytics.snapshot_complete',
      'analytics.anomaly_detected',
    ]);
  });
});
