/**
 * Cloudflare Worker — 智谱AI + 百度ASR 代理
 * Service Worker 格式：环境变量直接作为全局变量使用
 */
const ZHIPU_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const ZHIPU_MODEL = 'glm-4-flash';
const TIMEOUT_MS = 12000;
let baiduToken = '';
let baiduTokenExpire = 0;

async function getBaiduToken() {
  const now = Date.now();
  if (baiduToken && baiduTokenExpire > now) return baiduToken;
  const res = await fetch(
    `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${BAIDU_API_KEY}&client_secret=${BAIDU_SECRET_KEY}`,
    { method: 'POST' }
  );
  const data = await res.json();
  if (!data.access_token) throw new Error('获取百度token失败');
  baiduToken = data.access_token;
  baiduTokenExpire = now + (data.expires_in || 2592000) * 1000 - 60000;
  return baiduToken;
}

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (path === '/baidu-asr') return handleBaiduASR(request, corsHeaders);
  if (path === '/baidu-token') return handleBaiduToken(corsHeaders);
  return handleZhipuAI(request, corsHeaders);
}

async function handleBaiduASR(request, corsHeaders) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'content-type': 'application/json' } });
  }
  try {
    const body = await request.json();
    const token = await getBaiduToken();
    const asrRes = await fetch('https://vop.baidu.com/server_api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'pcm', rate: 16000, channel: 1, cuid: 'web-user', token: token, speech: body.speech, len: body.len, dev_pid: 1537 }),
    });
    const result = await asrRes.json();
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'content-type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'ASR代理异常: ' + err.message }), { status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' } });
  }
}

async function handleBaiduToken(corsHeaders) {
  try {
    const token = await getBaiduToken();
    return new Response(JSON.stringify({ token: token, expireAt: baiduTokenExpire }), { status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' } });
  }
}

async function handleZhipuAI(request, corsHeaders) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'content-type': 'application/json' } });
  }
  try {
    const { messages, temperature = 0.3, max_tokens = 300 } = await request.json();
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages 不能为空' }), { status: 400, headers: { ...corsHeaders, 'content-type': 'application/json' } });
    }
    const apiKey = ZHIPU_API_KEY;
    if (!apiKey) return new Response(JSON.stringify({ error: 'API Key 未配置' }), { status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' } });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(ZHIPU_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: ZHIPU_MODEL, messages, temperature, max_tokens }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return new Response(JSON.stringify({ error: `智谱API错误: ${response.status}`, detail: errText.substring(0, 500) }), { status: response.status, headers: { ...corsHeaders, 'content-type': 'application/json' } });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || '';
    if (!reply) return new Response(JSON.stringify({ error: 'AI 返回空内容' }), { status: 502, headers: { ...corsHeaders, 'content-type': 'application/json' } });

    return new Response(JSON.stringify({ success: true, reply, model: ZHIPU_MODEL, usage: data.usage || null }), { status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' } });
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'AI 响应超时' : err.message;
    return new Response(JSON.stringify({ error: `代理异常: ${msg}` }), { status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' } });
  }
}
