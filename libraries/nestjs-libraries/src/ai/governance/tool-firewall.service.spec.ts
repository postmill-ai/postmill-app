import { describe, it, expect, vi } from 'vitest';
import { SpanStatusCode } from '@opentelemetry/api';
import { ToolFirewallService, ToolFirewallBlocked } from './tool-firewall.service';
import type { TelemetryService } from '@gitroom/nestjs-libraries/ai/governance/telemetry.service';

class FakeTelemetryService implements Partial<TelemetryService> {
  calls: Array<{ name: string; attrs?: Record<string, string | number | boolean> }> = [];
  statuses: Array<{ code: number; message?: string }> = [];
  attributes: Record<string, string | number | boolean>[] = [];

  async startSpan<T>(
    name: string,
    fn: (span: any) => Promise<T>,
    attrs?: Record<string, string | number | boolean>,
  ): Promise<T> {
    this.calls.push({ name, attrs });
    const capturedAttributes: Record<string, string | number | boolean> = {};
    const span = {
      setAttribute: (key: string, value: string | number | boolean) => {
        capturedAttributes[key] = value;
      },
      setAttributes: vi.fn(),
      setStatus: (status: { code: number; message?: string }) => {
        this.statuses.push(status);
      },
      recordException: vi.fn(),
      end: vi.fn(),
    };
    try {
      const result = await fn(span);
      this.attributes.push(capturedAttributes);
      return result;
    } catch (err) {
      this.attributes.push(capturedAttributes);
      throw err;
    }
  }
}

describe('ToolFirewallService', () => {
  it('allows ordinary tool calls by default', () => {
    const fw = new ToolFirewallService();
    expect(fw.check('schedulePost', { content: 'hello world' })).toEqual({ allowed: true });
  });

  it('blocks denied tools', () => {
    const fw = new ToolFirewallService();
    fw.configure({ deniedTools: ['deleteEverything'] });
    const v = fw.check('deleteEverything', {});
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/denied/);
  });

  it('enforces an allow-list when provided (allow-list wins)', () => {
    const fw = new ToolFirewallService();
    fw.configure({ allowedTools: ['schedulePost'] });
    expect(fw.check('schedulePost', {}).allowed).toBe(true);
    expect(fw.check('integrationSchema', {}).allowed).toBe(false);
  });

  it('rejects oversized input', () => {
    const fw = new ToolFirewallService();
    fw.configure({ maxInputBytes: 16 });
    const v = fw.check('schedulePost', { content: 'x'.repeat(1000) });
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/exceeds/);
  });

  it('rejects control characters smuggled into input (incl. NUL)', () => {
    const fw = new ToolFirewallService();
    const withNul = { content: `a${String.fromCharCode(0)}b` };
    const v = fw.check('schedulePost', withNul);
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/control characters/);
  });

  it('allows tab / newline / carriage-return (not blocked as control chars)', () => {
    const fw = new ToolFirewallService();
    expect(fw.check('schedulePost', { content: 'line1\n\tline2\r' }).allowed).toBe(true);
  });

  it('wrap() blocks a disallowed call before the tool executes', async () => {
    const fw = new ToolFirewallService();
    fw.configure({ deniedTools: ['danger'] });
    const inner = vi.fn().mockResolvedValue('ran');
    const wrapped = fw.wrap('danger', { execute: inner } as any);
    await expect(wrapped.execute!({ context: {} })).rejects.toBeInstanceOf(ToolFirewallBlocked);
    expect(inner).not.toHaveBeenCalled();
  });

  it('wrap() delegates to the original tool when allowed', async () => {
    const fw = new ToolFirewallService();
    const inner = vi.fn().mockResolvedValue('ran');
    const wrapped = fw.wrap('schedulePost', { execute: inner } as any);
    const out = await wrapped.execute!({ context: { content: 'ok' } });
    expect(out).toBe('ran');
    expect(inner).toHaveBeenCalledOnce();
  });

  it('wrap() leaves a tool without execute untouched', () => {
    const fw = new ToolFirewallService();
    const tool = { id: 'noop' } as any;
    expect(fw.wrap('noop', tool)).toBe(tool);
  });

  it('wrap() records a telemetry span on successful execution', async () => {
    const telemetry = new FakeTelemetryService();
    const fw = new ToolFirewallService(undefined, telemetry as unknown as TelemetryService);
    const inner = vi.fn().mockResolvedValue('ran');
    const wrapped = fw.wrap('schedulePost', { execute: inner } as any);
    const out = await wrapped.execute!({ context: { content: 'ok' } });

    expect(out).toBe('ran');
    expect(telemetry.calls).toHaveLength(1);
    expect(telemetry.calls[0].name).toBe('agent.tool.schedulePost');
    expect(telemetry.calls[0].attrs).toEqual({ tool: 'schedulePost' });
    expect(telemetry.statuses).toHaveLength(1);
    expect(telemetry.statuses[0].code).toBe(SpanStatusCode.OK);
    expect(telemetry.attributes[0].inputBytes).toBeGreaterThan(0);
  });

  it('wrap() records a telemetry span with ERROR status when the tool throws', async () => {
    const telemetry = new FakeTelemetryService();
    const fw = new ToolFirewallService(undefined, telemetry as unknown as TelemetryService);
    const error = new Error('boom');
    const inner = vi.fn().mockRejectedValue(error);
    const wrapped = fw.wrap('schedulePost', { execute: inner } as any);

    await expect(wrapped.execute!({ context: {} })).rejects.toThrow('boom');
    expect(telemetry.calls).toHaveLength(1);
    expect(telemetry.calls[0].name).toBe('agent.tool.schedulePost');
    expect(telemetry.statuses).toHaveLength(1);
    expect(telemetry.statuses[0].code).toBe(SpanStatusCode.ERROR);
    expect(telemetry.statuses[0].message).toBe('boom');
  });

  it('wrap() does not record a span when TelemetryService is not injected', async () => {
    const fw = new ToolFirewallService();
    const inner = vi.fn().mockResolvedValue('ran');
    const wrapped = fw.wrap('schedulePost', { execute: inner } as any);
    const out = await wrapped.execute!({ context: {} });

    expect(out).toBe('ran');
    expect(inner).toHaveBeenCalledOnce();
  });
});
