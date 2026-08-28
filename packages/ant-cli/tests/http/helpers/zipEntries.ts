/**
 * ZIP entry names, read from the central directory. The repo ships no unzip
 * dependency (the runtime image never extracts one), and the export tests only
 * need the NAME set — which the archive stores verbatim; only file data is
 * deflated. Shared by the agent and pipeline folder-export tests.
 */
export function zipEntryNames(buffer: Buffer): string[] {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record');
  const total = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < total; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(`bad central directory header at ${offset}`);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    names.push(buffer.toString('utf-8', offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}
