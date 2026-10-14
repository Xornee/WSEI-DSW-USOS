/** Enforce the limit on decoded bytes as chunks arrive, never after response.text(). */
export async function readLimitedText(response, maxBytes = 2_000_000) {
  return (await readLimitedBytes(response, maxBytes)).toString('utf8');
}

export async function readLimitedBytes(response, maxBytes = 2_000_000) {
  const advertised = Number(response.headers?.get('content-length'));
  if (Number.isFinite(advertised) && advertised > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Response body exceeds byte limit');
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Response body exceeds byte limit');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}
