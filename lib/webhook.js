// 业务通知外推：企业微信/钉钉群机器人（文本消息格式相同），未配置时静默跳过
async function sendBusinessWebhook(message) {
  const url = process.env.BIZ_WEBHOOK_URL || '';
  if (!url || !message) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: String(message).slice(0, 2000) } }),
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        message: '业务通知推送失败',
        status: res.status
      }));
      return false;
    }
    return true;
  } catch (e) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      message: '业务通知推送异常',
      error: e.message
    }));
    return false;
  }
}

module.exports = { sendBusinessWebhook };
