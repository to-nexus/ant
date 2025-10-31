/**
 * Reporter Port
 * Interface for report generation
 */

export interface ReporterPort {
  writeReport(path: string, content: string): Promise<string>;
  writeRunLog(path: string, data: any): Promise<string>;
}

