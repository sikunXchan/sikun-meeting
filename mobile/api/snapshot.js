import { del, get, put } from '@vercel/blob';
import { createHandler } from '../lib/handler.js';

const storage = {
  async read(pathname) {
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return new Response(result.stream).text();
  },
  async write(pathname, text) {
    await put(pathname, text, {
      access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json',
    });
  },
  async remove(pathname) {
    await del(pathname);
  },
};

const handle = createHandler({ storage, syncToken: process.env.SYNC_TOKEN || '' });

export default {
  fetch(request) {
    return handle(request);
  },
};
