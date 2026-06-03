import { Redis } from '@upstash/redis';
const kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

const DEFAULT_CONFIG = {
  enabled: true,
  alertHours: 24,
  notifyEmail: process.env.NOTIFY_EMAIL || '',
  schedule: '9:00',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET' && req.query.log === '1') {
    try {
      const log = await kv.lrange('alerts_log', 0, 49) || [];
      return res.status(200).json({ log });
    } catch {
      return res.status(200).json({ log: [] });
    }
  }

  if (req.method === 'GET') {
    try {
      const config = await kv.get('bot_config') || DEFAULT_CONFIG;
      return res.status(200).json(config);
    } catch {
      return res.status(200).json(DEFAULT_CONFIG);
    }
  }

  if (req.method === 'POST') {
    try {
      const body = req.body;
      const current = await kv.get('bot_config') || DEFAULT_CONFIG;
      const updated = { ...current, ...body };
      await kv.set('bot_config', updated);
      return res.status(200).json({ ok: true, config: updated });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
}
