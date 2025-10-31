import { promises as fs } from "fs";
import { dirname } from "path";
import { ReporterPort } from "../../../core/ports";

export class FileReporter implements ReporterPort {
  async writeReport(path: string, content: string): Promise<string> {
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, content, "utf8");
    return path;
  }
  async writeRunLog(path: string, data: any): Promise<string> {
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, JSON.stringify(data, null, 2), "utf8");
    return path;
  }
}
