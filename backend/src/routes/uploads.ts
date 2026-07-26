import { mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { badRequest, json, notFound, unauthorized } from '../lib/http.ts';
import { newId } from '../lib/ids.ts';
import { route } from '../router.ts';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? new URL('../../data/uploads/', import.meta.url).pathname;
mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/gif': '.gif',
};

const MAX_BYTES = 5 * 1024 * 1024;

route.post('/api/admin/uploads', async ({ req }) => {
  const expected = process.env.ADMIN_TOKEN;
  if (expected && req.headers.get('X-Admin-Token') !== expected) throw unauthorized();

  // Inferred rather than annotated: Bun's FormData and undici's differ, and an
  // explicit `FormData` annotation picks the wrong one.
  const form = await req.formData().catch(() => {
    throw badRequest('Expected a multipart/form-data upload');
  });

  const file = form.get('file');
  if (!(file instanceof File)) throw badRequest('No file provided', { file: 'Choose an image' });
  if (file.size === 0) throw badRequest('The uploaded file is empty', { file: 'Choose an image' });
  if (file.size > MAX_BYTES) {
    throw badRequest('Image must be 5 MB or smaller', { file: 'File is too large' });
  }

  const extension = ALLOWED_TYPES[file.type];
  if (!extension) {
    throw badRequest('Only JPEG, PNG, WebP, AVIF and GIF images are allowed', {
      file: 'Unsupported image format',
    });
  }

  // Filename comes from a server-generated id, never from user input, so a
  // crafted name cannot escape the upload directory.
  const filename = `${newId()}${extension}`;
  await Bun.write(join(UPLOAD_DIR, filename), file);

  return json({ url: `/uploads/${filename}`, filename, size: file.size }, { status: 201 });
});

route.get('/uploads/:filename', async ({ params }) => {
  const filename = params.filename as string;
  // Defence in depth: reject anything that is not a plain generated filename.
  if (!/^[A-Za-z0-9-]+\.(jpg|png|webp|avif|gif)$/.test(filename)) throw notFound('File not found');

  const file = Bun.file(join(UPLOAD_DIR, filename));
  if (!(await file.exists())) throw notFound('File not found');

  return new Response(file, {
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': process.env.CORS_ORIGIN ?? '*',
    },
  });
});

export { UPLOAD_DIR };
