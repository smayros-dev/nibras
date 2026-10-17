import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Joins class names (clsx) and resolves Tailwind conflicts so the last utility wins. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
