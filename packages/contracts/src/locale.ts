import { z } from 'zod';
import { LOCALES } from './locale-codes';

export * from './locale-codes';

export const LocaleSchema = z.enum(LOCALES);
