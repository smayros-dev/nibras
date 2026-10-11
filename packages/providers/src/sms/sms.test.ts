import { describe, expect, it } from 'vitest';
import { InMemorySmsProvider } from './in-memory';
import { LogSmsProvider, maskPhone, type SmsLogger } from './log';

function recordingLogger() {
  const calls: { level: 'info' | 'debug'; obj: Record<string, unknown>; msg?: string }[] = [];
  const logger: SmsLogger = {
    info: (obj, msg) => calls.push({ level: 'info', obj, msg }),
    debug: (obj, msg) => calls.push({ level: 'debug', obj, msg }),
  };
  return { logger, calls };
}

const MSG = {
  to: '+21620000000',
  templateKey: 'phone.otp',
  locale: 'ar',
  params: { otpCode: '123456' },
} as const;

describe('LogSmsProvider', () => {
  it('logs recipient, template and locale at info and the otpCode only at debug', async () => {
    const { logger, calls } = recordingLogger();
    const { providerMessageId } = await new LogSmsProvider(logger).send(MSG);

    expect(providerMessageId).toMatch(/^log-/);
    const info = calls.filter((c) => c.level === 'info');
    expect(info).toHaveLength(1);
    expect(info[0]!.obj).toEqual({
      to: '+216******00',
      templateKey: 'phone.otp',
      locale: 'ar',
      providerMessageId,
    });
    expect(JSON.stringify(info)).not.toContain('123456');
    expect(JSON.stringify(calls)).not.toContain(MSG.to);
    const debug = calls.filter((c) => c.level === 'debug');
    expect(debug).toHaveLength(1);
    expect(debug[0]!.obj).toMatchObject({ otpCode: '123456' });
  });
});

describe('InMemorySmsProvider', () => {
  it('records messages, returns the last one per recipient and clears', async () => {
    const provider = new InMemorySmsProvider();
    const { providerMessageId } = await provider.send(MSG);
    await provider.send({ ...MSG, to: '+33600000000', params: { otpCode: '654321' } });

    expect(provider.sent).toHaveLength(2);
    expect(provider.sent[0]).toMatchObject({ ...MSG, providerMessageId });
    expect(provider.last()?.params.otpCode).toBe('654321');
    expect(provider.last('+21620000000')?.params.otpCode).toBe('123456');
    expect(provider.last('+1000')).toBeUndefined();
    provider.clear();
    expect(provider.sent).toHaveLength(0);
  });
});

describe('maskPhone', () => {
  it('keeps the country calling code and the last 2 digits', () => {
    expect(maskPhone('+21620000000')).toBe('+216******00');
    expect(maskPhone('+33612345678')).toBe('+33*******78');
    expect(maskPhone('+14155552671')).toBe('+1********71');
  });

  it('masks everything but the last 2 characters of an unparsable number', () => {
    expect(maskPhone('0612345678')).toBe('********78');
    expect(maskPhone('12')).toBe('**');
  });
});
