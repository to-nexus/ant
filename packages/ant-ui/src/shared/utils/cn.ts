import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS classes with conflict resolution
 * Later classes override earlier ones when they conflict
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

