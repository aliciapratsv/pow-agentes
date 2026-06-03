import { Redis } from '@upstash/redis';
const kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

const ASANA_TOKEN = process.env.ASANA_TOKEN;
const WORKSPACE_GID = process.env.ASANA_WORKSPACE_GID;

async function asanaGet(path) {
  const res = await fetch(`https://app.asana.com/api/1.0${path}`, {
    headers: { Authorization: `Bearer ${ASANA_TOKEN}` },
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const projects = await asanaGet(`/projects?workspace=${WORKSPACE_GID}&archived=false&opt_fields=gid,name`);
    const allTasks = [];
    for (const p of projects.slice(0, 8)) {
      const tasks = await asanaGet(`/projects/${p.gid}/tasks?opt_fields=gid,completed`);
      allTasks.push(...tasks.filter(t => !t.completed));
    }
    let lastRun = null, alertCount = 0;
    try {
      const lr = await kv.get('last_run');
      if (lr) { lastRun = lr.ts; alertCount = lr.alertCount; }
    } catch {}
    return res.status(200).json({ projects, tasks: allTasks, lastRun, alertCount });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
