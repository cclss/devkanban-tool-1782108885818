import { DocumentStatus } from '@repo/db';

/** Human-facing Korean labels for document/contract status. */
export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  [DocumentStatus.DRAFT]: '작성 중',
  // 서명란 확정·저장 후, 발송 전 대기 상태. design-spec status-badge `ready-to-send`
  // 어휘를 데이터 계층 상태 라벨로 적용("발송 준비 완료" = 준비됨이지 발송 완료 아님).
  [DocumentStatus.READY]: '발송 준비 완료',
  [DocumentStatus.IN_PROGRESS]: '진행 중',
  [DocumentStatus.COMPLETED]: '완료됨',
  [DocumentStatus.CANCELLED]: '취소됨',
};
