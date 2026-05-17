export const JobStatus = {
  Open: 'Open',
  Funded: 'Funded',
  Submitted: 'Submitted',
  Completed: 'Completed',
  Rejected: 'Rejected',
  Expired: 'Expired',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export const ValidationStatus = {
  Pending: 'PENDING',
  Passed: 'PASSED',
  Failed: 'FAILED',
} as const;
export type ValidationStatus = (typeof ValidationStatus)[keyof typeof ValidationStatus];

export const JobEventType = {
  Created: 'created',
  BudgetSet: 'budgetSet',
  Funded: 'funded',
  Submitted: 'submitted',
  Completed: 'completed',
  Rejected: 'rejected',
} as const;
export type JobEventType = (typeof JobEventType)[keyof typeof JobEventType];
