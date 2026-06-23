import { DocumentStatus } from '@repo/db';

/** Human-facing Korean labels for document/contract status. */
export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  [DocumentStatus.DRAFT]: '작성 중',
  [DocumentStatus.IN_PROGRESS]: '진행 중',
  [DocumentStatus.COMPLETED]: '완료됨',
  [DocumentStatus.CANCELLED]: '취소됨',
};
