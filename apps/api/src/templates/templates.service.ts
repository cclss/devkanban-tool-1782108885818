import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Plan, Prisma, type Template } from '@repo/db';
import { PrismaService } from '../prisma/prisma.service';
import { MESSAGES } from '../common/messages';
import type { CreateTemplateDto, RenameTemplateDto } from './dto/templates.dto';

/**
 * Per-plan cap on how many templates one account may keep. Mirrors the intent
 * of the Free-plan send quota (`SendQuotaService`): the Free tier gets a small
 * allowance to try the feature, paid tiers get room to standardize their common
 * contracts. Enterprise is effectively unmetered.
 */
const TEMPLATE_LIMIT_BY_PLAN: Record<Plan, number> = {
  [Plan.FREE]: 3,
  [Plan.PRO]: 50,
  [Plan.ENTERPRISE]: Number.MAX_SAFE_INTEGER,
};

/** A saved field placement inside a template (normalized 0..1 geometry). */
export interface TemplateField {
  type: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  recipientIndex: number;
}

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Persist a new template for the owner, guarded by the per-plan cap. */
  async create(ownerId: string, dto: CreateTemplateDto): Promise<TemplateDetail> {
    await this.assertWithinTemplateQuota(ownerId);

    const fields = (dto.fields ?? []).map(normalizeField);
    const template = await this.prisma.template.create({
      data: {
        ownerId,
        name: dto.name.trim(),
        storageKey: dto.storageKey,
        pageCount: dto.pageCount ?? 0,
        fields: fields as unknown as Prisma.InputJsonValue,
      },
    });
    return toDetail(template);
  }

  /** Owner's templates, newest first (list view — no field layout). */
  async list(ownerId: string): Promise<TemplateSummary[]> {
    const templates = await this.prisma.template.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
    });
    return templates.map(toSummary);
  }

  /** Single template incl. its full field layout (for loading into the wizard). */
  async detail(ownerId: string, id: string): Promise<TemplateDetail> {
    const template = await this.requireOwnedTemplate(ownerId, id);
    return toDetail(template);
  }

  /** Change only the display name. */
  async rename(ownerId: string, id: string, dto: RenameTemplateDto): Promise<TemplateDetail> {
    await this.requireOwnedTemplate(ownerId, id);
    const template = await this.prisma.template.update({
      where: { id },
      data: { name: dto.name.trim() },
    });
    return toDetail(template);
  }

  /** Delete a template the owner holds. */
  async remove(ownerId: string, id: string): Promise<void> {
    await this.requireOwnedTemplate(ownerId, id);
    await this.prisma.template.delete({ where: { id } });
  }

  // --- internals ----------------------------------------------------------

  private async requireOwnedTemplate(ownerId: string, id: string): Promise<Template> {
    const template = await this.prisma.template.findUnique({ where: { id } });
    if (!template) throw new NotFoundException(MESSAGES.template.notFound);
    if (template.ownerId !== ownerId) throw new ForbiddenException(MESSAGES.template.forbidden);
    return template;
  }

  /** Reject creation once the owner has reached their plan's template cap. */
  private async assertWithinTemplateQuota(ownerId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { plan: true },
    });
    const limit = TEMPLATE_LIMIT_BY_PLAN[user?.plan ?? Plan.FREE];
    const used = await this.prisma.template.count({ where: { ownerId } });
    if (used >= limit) {
      throw new ForbiddenException(MESSAGES.template.limitReached);
    }
  }
}

/** Coerce a validated field DTO into the stored JSON shape (recipientIndex defaulted). */
function normalizeField(f: {
  type: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  recipientIndex?: number;
}): TemplateField {
  return {
    type: f.type,
    page: f.page,
    x: f.x,
    y: f.y,
    width: f.width,
    height: f.height,
    recipientIndex: f.recipientIndex ?? 0,
  };
}

function toSummary(template: Template): TemplateSummary {
  const fields = readFields(template.fields);
  return {
    id: template.id,
    name: template.name,
    pageCount: template.pageCount,
    fieldCount: fields.length,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

function toDetail(template: Template): TemplateDetail {
  return {
    ...toSummary(template),
    storageKey: template.storageKey,
    fields: readFields(template.fields),
  };
}

/** Read the persisted JSON field layout back as a typed array (empty on absence). */
function readFields(value: Template['fields']): TemplateField[] {
  return Array.isArray(value) ? (value as unknown as TemplateField[]) : [];
}

export interface TemplateSummary {
  id: string;
  name: string;
  pageCount: number;
  fieldCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateDetail extends TemplateSummary {
  storageKey: string;
  fields: TemplateField[];
}
