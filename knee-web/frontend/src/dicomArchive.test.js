import assert from 'node:assert/strict'
import test from 'node:test'
import { createDicomArchive } from './dicomArchive.js'

test('packages DICOM files into a valid stored ZIP with relative series paths', async () => {
  const first = new File(['first dicom'], 'image-1.dcm', { type: 'application/dicom' })
  Object.defineProperty(first, 'webkitRelativePath', { value: 'study/series-1/image-1.dcm' })
  const second = new File(['second dicom'], 'image-2.dcm', { type: 'application/dicom' })
  Object.defineProperty(second, 'webkitRelativePath', { value: 'study/series-2/image-2.dcm' })

  const archive = await createDicomArchive([first, second])
  const bytes = new Uint8Array(await archive.arrayBuffer())
  const view = new DataView(bytes.buffer)
  assert.equal(archive.name, 'dicom-study-upload.zip')
  assert.equal(view.getUint32(0, true), 0x04034b50)
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50)
  const contents = new TextDecoder().decode(bytes)
  assert.match(contents, /study\/series-1\/image-1\.dcm/)
  assert.match(contents, /study\/series-2\/image-2\.dcm/)
  assert.match(contents, /first dicom/)
  assert.match(contents, /second dicom/)
})

test('rejects non-DICOM files and studies beyond the per-file limit', async () => {
  await assert.rejects(createDicomArchive([new File(['x'], 'notes.txt')]), /Only DICOM files/)
  const tooLarge = new File([], 'large.dcm')
  Object.defineProperty(tooLarge, 'size', { value: 201 * 1024 * 1024 })
  await assert.rejects(createDicomArchive([tooLarge]), /200 MiB per-DICOM limit/)
})
