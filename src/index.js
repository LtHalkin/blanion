/**
 * BLANION on Cloudflare Workers.
 *  - Static site (public/) is served through the ASSETS binding.
 *  - /api/* is forwarded to ONE Durable Object ("main") that owns all game state, so answer counts,
 *    rarity and scoring are always consistent.
 */
import { DurableObject } from 'cloudflare:workers';
import { createApp, SEC } from '../lib/core.js';
import { createDoStore } from './do-store.js';

export class Blanion extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.store = createDoStore(ctx.storage, env);
    this.app = null;
    ctx.blockConcurrencyWhile(async () => {
      await this.store.load();
      this.app = createApp({ store: this.store, adminPassword: env.ADMIN_PASSWORD });
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const req = {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      ip: request.headers.get('cf-connecting-ip') || '?',
      json: async () => {
        const text = await request.text();
        if (text.length > 20000) throw Object.assign(new Error('Body too large'), { status: 413 });
        if (!text) return {};
        try { return JSON.parse(text); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
      },
    };
    const out = await this.app.handle(req, url);
    await this.store.persist();
    return new Response(JSON.stringify(out.body), { status: out.code, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
}

const withSec = res => {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(SEC)) r.headers.set(k, v);
  return r;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const stub = env.BLANION.get(env.BLANION.idFromName('main'));
      return withSec(await stub.fetch(request));
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    // /admin is resolved to admin.html by the assets layer (html_handling: auto-trailing-slash)
    return withSec(await env.ASSETS.fetch(request));
  },
};
