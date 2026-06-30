import { NotFoundException } from '@nestjs/common';
import {
  BrandFont,
  DocumentStatus,
  Plan,
  SignRequestStatus,
} from '@repo/db';
import { SigningService } from './signing.service';
import { MESSAGES } from '../common/messages';

/**
 * Focused on `meta()`'s plan-gated branding enforcement: a sender's brand
 * color / logo / font must reach the signer ONLY while the sender's plan still
 * qualifies for branding. A downgrade (or a never-eligible FREE sender) is
 * stripped server-side, so non-eligible branding can never leak to a signer —
 * the screen falls back to the default design tokens.
 */
type OwnerRow = {
  name: string | null;
  plan: Plan;
  brandColor: string | null;
  brandFont: BrandFont | null;
  brandLogoUrl: string | null;
};

const FULL_BRANDING = {
  brandColor: '#4F46E5',
  brandFont: BrandFont.SERIF,
  brandLogoUrl: 'https://api.example.com/api/branding/u1/logo?v=abc',
} as const;

function makeService(owner: OwnerRow | null) {
  const signRequest = owner
    ? {
        accessToken: 'tok',
        recipientName: '김토스',
        status: SignRequestStatus.PENDING,
        document: {
          title: '서비스 이용 계약서',
          pageCount: 3,
          status: DocumentStatus.IN_PROGRESS,
          owner,
        },
      }
    : null;

  const prisma = {
    signRequest: {
      findUnique: jest.fn(async () => signRequest),
    },
  };

  const service = new SigningService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma };
}

function ownerWithBranding(plan: Plan): OwnerRow {
  return { name: '주식회사 토스', plan, ...FULL_BRANDING };
}

describe('SigningService.meta — sender branding plan gate', () => {
  it('passes a fully-branded payload through for an eligible (PRO) sender', async () => {
    const { service } = makeService(ownerWithBranding(Plan.PRO));
    const meta = await service.meta('tok');
    expect(meta.sender).toEqual({
      name: '주식회사 토스',
      brandColor: FULL_BRANDING.brandColor,
      brandFont: FULL_BRANDING.brandFont,
      brandLogoUrl: FULL_BRANDING.brandLogoUrl,
    });
  });

  it('passes branding through for an ENTERPRISE sender', async () => {
    const { service } = makeService(ownerWithBranding(Plan.ENTERPRISE));
    const meta = await service.meta('tok');
    expect(meta.sender.brandColor).toBe(FULL_BRANDING.brandColor);
    expect(meta.sender.brandFont).toBe(FULL_BRANDING.brandFont);
    expect(meta.sender.brandLogoUrl).toBe(FULL_BRANDING.brandLogoUrl);
  });

  it('strips color, logo, AND font for a non-eligible (FREE) sender — falls back to default tokens', async () => {
    // A downgraded sender still has branding stored, but it must not leak.
    const { service } = makeService(ownerWithBranding(Plan.FREE));
    const meta = await service.meta('tok');
    expect(meta.sender).toEqual({
      name: '주식회사 토스',
      brandColor: null,
      brandFont: null,
      brandLogoUrl: null,
    });
  });

  it('keeps the sender name even when branding is stripped', async () => {
    const { service } = makeService(ownerWithBranding(Plan.FREE));
    const meta = await service.meta('tok');
    // Name is identity (for the monogram/header), not gated branding.
    expect(meta.sender.name).toBe('주식회사 토스');
  });

  it('throws for an unknown access token', async () => {
    const { service } = makeService(null);
    await expect(service.meta('missing')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.meta('missing')).rejects.toThrow(
      MESSAGES.signing.invalidLink,
    );
  });
});
