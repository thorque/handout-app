// A minimal multipart/form-data body builder for tests, since fastify.inject
// takes a raw payload rather than a browser FormData object.

export function buildMultipart(fields) {
  const boundary = `----handoutTestBoundary${Math.random().toString(16).slice(2)}`;
  const parts = [];

  for (const field of fields) {
    if (field.type === "file") {
      parts.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${field.name}"; filename="${field.filename}"\r\n` +
            `Content-Type: ${field.contentType || "application/octet-stream"}\r\n\r\n`,
        ),
        Buffer.isBuffer(field.content)
          ? field.content
          : Buffer.from(field.content),
        Buffer.from("\r\n"),
      );
    } else {
      parts.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${field.name}"\r\n\r\n` +
            `${field.value}\r\n`,
        ),
      );
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
