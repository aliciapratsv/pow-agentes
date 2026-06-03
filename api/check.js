// api/check.js — Vercel Cron Function
import { kv } from '@vercel/kv';

const ASANA_TOKEN = process.env.ASANA_TOKEN;
const WORKSPACE_GID = process.env.ASANA_WORKSPACE_GID;

const TEAM_EMAILS = [
  'brenda@pow.la',
  'luciana@pow.la',
  'martina.arias@pow.la',
  'florencia@pow.la',
];

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
    headers: { Authorization: `Bearer ${ASANA_TOKEN}`, 'Content-Type': 'application/json' },
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
  const taskUrl = `https://app.asana.com/
