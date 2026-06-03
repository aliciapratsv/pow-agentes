// api/check.js — Vercel Cron Function
// Corre cada día a las 9am. Revisa Asana y guarda historial en KV.

import { kv } from '@vercel/kv';

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

async function asanaComment(taskGid, text) {
  await fetch(`https://app.asana.com/api/1.0/tasks/${taskGid}/stories`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ASANA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data: { text } }),
  });
}

async function sendEmail(subject, htmlBody, config) {
  if (!config.notifyEmail || !process.env.GMAIL_USER) return;
  const nodemailer = await import('nodemailer');
  const t = nodemailer.default.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
  });
  await t.sendMail({ from: process.env.GMAIL_USER, to: config.notifyEmail, subject, html: htmlBody });
}

function emailTemplate({ title, taskName, assignee, projectName, detail, taskGid, projectGid }) {
  const taskUrl = `https://app.asana.com/0/${projectGid}/${taskGid}`;
  return `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;"><div style="background:#FF722D;padding:12px 16px;border-radius:4px;margin-bottom:20px;"><strong style="color:#020001;">${title}</strong></div><p>Tarea: <strong>${taskName}</strong></p><p>Responsable: ${assignee}</p><p>Proyecto: ${projectName}</p><p>${detail}</p><a href="${taskUrl}" style="display:inline-block;margin-top:20px;background:#020001;color:white;padding:10px 20px;border-radius:4px;text-decoration:none;">Ver tarea →</a></div>`;
}

async function checkProject(project, config) {
  const alerts = [];
  const cutoff = Date.now() - config.alertHours * 3600 * 1000;
  const now = new Date();
  const tasks = await asanaGet(`/projects/${project.gid}/tasks?opt_fields=gid,name,assignee.name,assignee.gid,due_on,modified_at,completed`);
  for (const task of tasks) {
    if (task.completed || !task.assignee) continue;
    const stories = await asanaGet(`/tasks/${task.gid}/stories?opt_fields=type,text,created_at,created_by.gid`);
    const oldMentions = stories.filter(s => s.type === 'comment' && s.text?.includes('@') && new Date(s.created_at).getTime() < cutoff);
    for (const mention of oldMentions) {
      const replied = stories.some(s => s.type === 'comment' && s.created_by?.gid === task.assignee.gid && new Date(s.created_at) > new Date(mention.created_at));
      if (!replied) {
        const hoursAgo = Math.round((Date.now() - new Date(mention.created_at).getTime()) / 3600000);
        await asanaComment(task.gid, `⚠️ Recordatorio: @${task.assignee.name}, tenés una mención sin responder hace ${hoursAgo}hs.`);
        alerts.push({ type: 'mention', title: 'Mención sin respuesta', taskName: task.name, taskGid: task.gid, projectName: project.name, projectGid: project.gid, assignee: task.assignee.name, detail: `Sin respuesta hace ${hoursAgo}hs`, ts: new Date().toISOString() });
      }
    }
    if (task.due_on) {
      const dueDate = new Date(task.due_on);
      if (dueDate < now && new Date(task.modified_at).getTime() < cutoff) {
        const daysOverdue = Math.round((now - dueDate) / 86400000);
        await asanaComment(task.gid, `🔴 Esta tarea venció hace ${daysOverdue}d sin actividad. @${task.assignee.name}: ¿cuál es el estado?`);
        alerts.push({ type: 'overdue', title: 'Tarea vencida sin update', taskName: task.name, taskGid: task.gid, projectName: project.name, projectGid: project.gid, assignee: task.assignee.name, detail: `Vencida el ${task.due_on} · ${daysOverdue}d de retraso`, ts: new Date().toISOString() });
      }
    }
  }
  return alerts;
}

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorized' });
  try {
    let config;
    try { config = await kv.get('bot_config') || { enabled: true, alertHours: 24 }; }
    catch { config = { enabled: true, alertHours: parseInt(process.env.ALERT_HOURS || '24') }; }
    if (!config.enabled) return res.status(200).json({ ok: true, skipped: true });
    const projects = await asanaGet(`/projects?workspace=${WORKSPACE_GID}&archived=false&opt_fields=gid,name`);
    const allAlerts = [];
    for (const project of projects) allAlerts.push(...await checkProject(project, config));
    if (allAlerts.length > 0) {
      try { for (const a of allAlerts) await kv.lpush('alerts_log', JSON.stringify(a)); await kv.ltrim('alerts_log', 0, 99); } catch {}
      for (const alert of allAlerts) await sendEmail(`[Taskpatrol] ${alert.title}: ${alert.taskName}`, emailTemplate(alert), config);
    }
    try { await kv.set('last_run', { ts: new Date().toISOString(), alertCount: allAlerts.length }); } catch {}
    return res.status(200).json({ ok: true, checked: new Date().toISOString(), alertsSent: allAlerts.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
