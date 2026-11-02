import { UploadChunk } from './models.js';

export const CHUNK_BYTES = 3 * 1024 * 1024;
export const MAX_PDF_BYTES = 15 * 1024 * 1024;

export async function savePdfChunk(test, userId, index, bytes) {
  if (test.status !== 'uploading') throw new Error('This upload is already being processed.');
  if (!Number.isInteger(index) || index < 0 || index >= test.chunkCount) throw new Error('Invalid chunk index.');
  const expected = Math.min(CHUNK_BYTES, test.expectedBytes - index * CHUNK_BYTES);
  if (bytes.length !== expected) throw new Error('PDF chunk has an unexpected size.');
  if (index === 0 && bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF file.');
  await UploadChunk.updateOne(
    { testId: test._id, index },
    { $set: { userId, data: bytes } },
    { upsert: true },
  );
}

export async function readPdfChunks(test) {
  const chunks = await UploadChunk.find({ testId: test._id }).sort({ index: 1 });
  if (chunks.length !== test.chunkCount) throw new Error('PDF upload is incomplete. Upload the missing chunks before processing.');
  for (let index = 0; index < chunks.length; index++) {
    if (chunks[index].index !== index) throw new Error('PDF upload is missing a chunk.');
  }
  const buffer = Buffer.concat(chunks.map(chunk => chunk.data));
  if (buffer.length !== test.expectedBytes || buffer.subarray(0, 5).toString() !== '%PDF-') {
    throw new Error('Uploaded PDF is incomplete or invalid.');
  }
  return buffer;
}

export async function deletePdfChunks(testId) {
  await UploadChunk.deleteMany({ testId });
}
