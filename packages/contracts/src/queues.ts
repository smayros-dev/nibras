/** BullMQ queue names (PRD §13.5). */
export const QUEUES = {
  sessions: 'sessions',
  notifications: 'notifications',
  media: 'media',
  imports: 'imports',
  compliance: 'compliance',
  analytics: 'analytics',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
