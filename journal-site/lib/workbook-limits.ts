import { JournalError } from '@/lib/journal-errors';

/** Bound expanded ZIP payload before SheetJS allocates XML strings. ZIP64 is not needed for a journal. */
export function checkWorkbookArchive(buffer: Buffer): void {
  if (buffer.subarray(0, 2).toString() !== 'PK') return;
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw new JournalError('JOURNAL_PARSE_FAILED');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  if (count > 5000 || offset === 0xffffffff) throw new JournalError('JOURNAL_TOO_LARGE');
  let expanded = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new JournalError('JOURNAL_PARSE_FAILED');
    const bytes = buffer.readUInt32LE(offset + 24);
    expanded += bytes;
    if (bytes > 20 * 1024 * 1024 || expanded > 64 * 1024 * 1024) throw new JournalError('JOURNAL_TOO_LARGE');
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
}
