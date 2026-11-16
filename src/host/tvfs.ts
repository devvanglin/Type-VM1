/** Host-side builder and reader for the TVFS disk format used by the guest. */

export const TVFS_SECTOR_SIZE = 512;
export const TVFS_MAX_FILES = 16;
export const TVFS_HEADER_SECTORS = 3;

export interface DiskFile {
  name: string;
  data: Uint8Array;
}

export interface TvfsEntry {
  name: string;
  size: number;
  startSector: number;
  flags: number;
}

function putU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function getU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

export function buildTvfs(files: DiskFile[], totalSectors = 2048): Uint8Array {
  if (files.length > TVFS_MAX_FILES) {
    throw new Error(`TVFS supports at most ${TVFS_MAX_FILES} files, got ${files.length}`);
  }
  const disk = new Uint8Array(totalSectors * TVFS_SECTOR_SIZE);
  // Superblock.
  disk.set([0x54, 0x56, 0x46, 0x53, 0x30, 0x30, 0x30, 0x31], 0); // "TVFS0001"
  putU32(disk, 8, 1);
  putU32(disk, 12, TVFS_SECTOR_SIZE);
  putU32(disk, 16, totalSectors);
  putU32(disk, 20, files.length);
  putU32(disk, 24, 1); // file table sector
  putU32(disk, 28, TVFS_HEADER_SECTORS);

  let sector = TVFS_HEADER_SECTORS;
  files.forEach((file, index) => {
    const name = file.name.toUpperCase();
    if (name.length > 31) throw new Error(`file name too long: ${name}`);
    if (file.data.length > 0xffff_ffff) throw new Error(`file too large: ${name}`);
    const entry = TVFS_SECTOR_SIZE + index * 64;
    for (let i = 0; i < name.length; i++) disk[entry + i] = name.charCodeAt(i);
    putU32(disk, entry + 32, file.data.length);
    putU32(disk, entry + 36, sector);
    putU32(disk, entry + 40, 0);
    const sectors = Math.ceil(file.data.length / TVFS_SECTOR_SIZE);
    if ((sector + sectors) * TVFS_SECTOR_SIZE > disk.length) {
      throw new Error(`disk image too small for ${file.name}`);
    }
    disk.set(file.data, sector * TVFS_SECTOR_SIZE);
    sector += sectors;
  });
  return disk;
}

export function parseTvfs(disk: Uint8Array): { entries: TvfsEntry[]; files: Map<string, Uint8Array> } {
  const magic = String.fromCharCode(...disk.slice(0, 8));
  if (magic !== "TVFS0001") throw new Error(`bad TVFS magic: ${JSON.stringify(magic)}`);
  const count = getU32(disk, 20);
  const entries: TvfsEntry[] = [];
  const files = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const entry = TVFS_SECTOR_SIZE + i * 64;
    let name = "";
    for (let j = 0; j < 32 && disk[entry + j] !== 0; j++) name += String.fromCharCode(disk[entry + j]);
    const size = getU32(disk, entry + 32);
    const startSector = getU32(disk, entry + 36);
    const flags = getU32(disk, entry + 40);
    entries.push({ name, size, startSector, flags });
    files.set(name, disk.slice(startSector * TVFS_SECTOR_SIZE, startSector * TVFS_SECTOR_SIZE + size));
  }
  return { entries, files };
}
