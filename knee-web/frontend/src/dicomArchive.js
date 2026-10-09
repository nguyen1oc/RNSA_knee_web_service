const MAX_DICOM_FILES = 500
const MAX_DICOM_FILE_BYTES = 200 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 600 * 1024 * 1024
const CRC_CHUNK_BYTES = 4 * 1024 * 1024

const crcTable = new Uint32Array(256)
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  crcTable[index] = value >>> 0
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true)
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value, true)
}

function safeArchivePath(file, index) {
  const source = file.webkitRelativePath || file.name || `slice-${index + 1}.dcm`
  const segments = source.replace(/\\/g, '/').split('/').filter((segment) => segment && segment !== '.' && segment !== '..')
  const path = segments.join('/')
  return path || `slice-${index + 1}.dcm`
}

async function fileCrc32(file, onChunk) {
  let crc = 0xffffffff
  for (let offset = 0; offset < file.size; offset += CRC_CHUNK_BYTES) {
    const bytes = new Uint8Array(await file.slice(offset, offset + CRC_CHUNK_BYTES).arrayBuffer())
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
    onChunk(bytes.length)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function localHeader(nameBytes, crc32, size) {
  const header = new Uint8Array(30 + nameBytes.length)
  const view = new DataView(header.buffer)
  writeUint32(view, 0, 0x04034b50)
  writeUint16(view, 4, 20)
  writeUint16(view, 6, 0x0800)
  writeUint16(view, 8, 0)
  writeUint32(view, 14, crc32)
  writeUint32(view, 18, size)
  writeUint32(view, 22, size)
  writeUint16(view, 26, nameBytes.length)
  header.set(nameBytes, 30)
  return header
}

function centralHeader(nameBytes, crc32, size, localOffset) {
  const header = new Uint8Array(46 + nameBytes.length)
  const view = new DataView(header.buffer)
  writeUint32(view, 0, 0x02014b50)
  writeUint16(view, 4, 20)
  writeUint16(view, 6, 20)
  writeUint16(view, 8, 0x0800)
  writeUint16(view, 10, 0)
  writeUint32(view, 16, crc32)
  writeUint32(view, 20, size)
  writeUint32(view, 24, size)
  writeUint16(view, 28, nameBytes.length)
  writeUint32(view, 42, localOffset)
  header.set(nameBytes, 46)
  return header
}

function endRecord(count, centralSize, centralOffset) {
  const record = new Uint8Array(22)
  const view = new DataView(record.buffer)
  writeUint32(view, 0, 0x06054b50)
  writeUint16(view, 8, count)
  writeUint16(view, 10, count)
  writeUint32(view, 12, centralSize)
  writeUint32(view, 16, centralOffset)
  return record
}

export async function createDicomArchive(files, onProgress = () => {}) {
  if (files.length > MAX_DICOM_FILES) {
    throw new Error(`A study can contain at most ${MAX_DICOM_FILES} DICOM files in this preview.`)
  }
  if (files.some((file) => !file.name.toLowerCase().endsWith('.dcm'))) {
    throw new Error('Only DICOM files can be packaged together. Upload ZIP archives separately.')
  }
  const oversized = files.find((file) => file.size > MAX_DICOM_FILE_BYTES)
  if (oversized) throw new Error(`${oversized.name} exceeds the 200 MiB per-DICOM limit.`)

  const encoder = new TextEncoder()
  const entries = files.map((file, index) => {
    const nameBytes = encoder.encode(safeArchivePath(file, index))
    if (nameBytes.length > 0xffff) throw new Error('A DICOM file path is too long to package.')
    return { file, nameBytes, crc32: 0, offset: 0 }
  })
  const rawBytes = files.reduce((sum, file) => sum + file.size, 0)
  if (rawBytes > MAX_ARCHIVE_BYTES) throw new Error('Selected DICOM files exceed the 600 MiB per-upload limit.')
  const archiveSize = rawBytes + entries.reduce((sum, entry) => sum + 76 + 2 * entry.nameBytes.length, 0) + 22
  if (archiveSize > MAX_ARCHIVE_BYTES) throw new Error('Packaged study exceeds the 600 MiB per-upload limit.')

  let preparedBytes = 0
  for (const entry of entries) {
    entry.crc32 = await fileCrc32(entry.file, (chunkBytes) => {
      preparedBytes += chunkBytes
      onProgress({ phase: 'preparing', loaded: preparedBytes, total: rawBytes, percent: rawBytes ? Math.min(100, Math.round(preparedBytes / rawBytes * 100)) : 100 })
    })
  }

  const parts = []
  const centralParts = []
  let offset = 0
  for (const entry of entries) {
    entry.offset = offset
    const header = localHeader(entry.nameBytes, entry.crc32, entry.file.size)
    parts.push(header, entry.file)
    offset += header.length + entry.file.size
    centralParts.push(centralHeader(entry.nameBytes, entry.crc32, entry.file.size, entry.offset))
  }
  const centralOffset = offset
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  parts.push(...centralParts, endRecord(entries.length, centralSize, centralOffset))
  return new File(parts, 'dicom-study-upload.zip', { type: 'application/zip' })
}
