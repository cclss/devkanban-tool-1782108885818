import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { BrandFont, Plan } from '@repo/db';
import { BrandingService } from './branding.service';
import { MESSAGES } from '../common/messages';

type Row = {
  id: string;
  brandColor: string | null;
  brandFont: BrandFont | null;
  brandLogoUrl: string | null;
  plan: Plan;
};

function makeService(user: Partial<Row> | null) {
  const row: Row | null = user
    ? { id: 'u1', brandColor: null, brandFont: null, brandLogoUrl: null, plan: Plan.FREE, ...user }
    : null;

  const update = jest.fn(async ({ data }: { data: Partial<Row> }) => {
    Object.assign(row as Row, data);
    return row;
  });
  const prisma = {
    user: {
      findUnique: jest.fn(async () => row),
      update,
    },
  };
  return { service: new BrandingService(prisma as never), prisma, update, getRow: () => row };
}

describe('BrandingService.get', () => {
  it('returns current branding with plan eligibility (FREE → disabled)', async () => {
    const { service } = makeService({
      brandColor: '#4F46E5',
      brandFont: BrandFont.SERIF,
      brandLogoUrl: 'logo/key.png',
      plan: Plan.FREE,
    });
    await expect(service.get('u1')).resolves.toEqual({
      brandColor: '#4F46E5',
      brandFont: BrandFont.SERIF,
      logoUrl: 'logo/key.png',
      brandingEnabled: false,
    });
  });

  it('reports brandingEnabled for paid plans', async () => {
    const { service } = makeService({ plan: Plan.PRO });
    await expect(service.get('u1')).resolves.toMatchObject({ brandingEnabled: true });
  });

  it('throws when the user is missing', async () => {
    const { service } = makeService(null);
    await expect(service.get('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('BrandingService.update', () => {
  it('rejects FREE plan with the upgrade copy (403) and writes nothing', async () => {
    const { service, update } = makeService({ plan: Plan.FREE });
    await expect(service.update('u1', { brandColor: '#123456' })).rejects.toMatchObject({
      message: MESSAGES.branding.upgradeRequired,
    });
    await expect(service.update('u1', { brandColor: '#123456' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('persists color and font for PRO and echoes the updated view', async () => {
    const { service, update, getRow } = makeService({ plan: Plan.PRO });
    const result = await service.update('u1', {
      brandColor: '#0A0A0A',
      brandFont: BrandFont.SCRIPT,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { brandColor: '#0A0A0A', brandFont: BrandFont.SCRIPT },
    });
    expect(getRow()).toMatchObject({ brandColor: '#0A0A0A', brandFont: BrandFont.SCRIPT });
    expect(result).toMatchObject({
      brandColor: '#0A0A0A',
      brandFont: BrandFont.SCRIPT,
      brandingEnabled: true,
    });
  });

  it('also enables ENTERPRISE', async () => {
    const { service, update } = makeService({ plan: Plan.ENTERPRISE });
    await service.update('u1', { brandFont: BrandFont.SANS });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('writes only the fields supplied (undefined is left untouched)', async () => {
    const { service, update } = makeService({
      plan: Plan.PRO,
      brandColor: '#abcdef',
      brandFont: BrandFont.SANS,
    });
    await service.update('u1', { brandColor: '#654321' });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { brandColor: '#654321' },
    });
    // brandFont key absent → existing value preserved.
    expect(update.mock.calls[0][0].data).not.toHaveProperty('brandFont');
  });

  it('clears a field when passed null', async () => {
    const { service, update } = makeService({ plan: Plan.PRO, brandColor: '#abcdef' });
    await service.update('u1', { brandColor: null });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { brandColor: null },
    });
  });
});
