/**
 * Cloudflare Worker — 智谱AI + 百度ASR 代理
 * 
 * 部署步骤：
 * 1. 登录 https://dash.cloudflare.com
 * 2. 左侧菜单 → Workers & Pages → 创建 Worker
 * 3. 粘贴此代码，保存并部署
 * 4. 设置 → 变量和机密 → 添加变量：
 *    名称: ZHIPU_API_KEY
 *    值: 30bbf2ce64fa4769bdbef742b872dc78.E3NqHF9lUmN9lbZr
 *    名称: BAIDU_API_KEY
 *    值: 你的百度API_KEY
 *    名称: BAIDU_SECRET_KEY
 *    值: 你的百度SECRET_KEY
 * 5. 部署后你会得到一个地址，类似 https://indoor-nav-ai.your-name.workers.dev
 * 6. 把这个地址填到 app.js 和 indoor-app.js 的相应位置
 */

const ZHIPU_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const ZHIPU_MODEL = 'glm-4-flash'; // 永久免费模型
const TIMEOUT_MS = 12000; // 12秒超时

// 百度ASR token 缓存（Worker 生命周期内有效）
let baiduToken = '';
let baiduTokenExpire = 0;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 路由分发
    if (path === '/baidu-asr') {
      return handleBaiduASR(request, env);
    }

    // 默认：智谱AI代理
    return handleZhipuAI(request, env);
  }
};

// ── 百度ASR代理 ──
async function handleBaiduASR(request, env) {
  const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'Content-Type',
    'access-control-max-age': '86400',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  try {
    const body = await request.json();

    // 获取百度 access token
    const token = await getBaiduToken(env);

    // 调用百度ASR API
    const asrRes = await fetch('https://vop.baidu.com/server_api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format: 'pcm',
        rate: 16000,
        channel: 1,
        cuid: 'web-user',
        token: token,
        speech: body.speech,
        len: body.len,
        dev_pid: 1537, // 普通话
      }),
    });

    const result = await asrRes.json();

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });

  } catch (err) {
    console.error('[Baidu ASR] 错误:', err.message);
    return new Response(JSON.stringify({ error: 'ASR代理异常: ' + err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
}

// 获取百度 access token（带缓存）
async function getBaiduToken(env) {
  const now = Date.now();
  if (baiduToken && baiduTokenExpire > now) {
    return baiduToken;
  }

  const res = await fetch(
    `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${env.BAIDU_API_KEY}&client_secret=${env.BAIDU_SECRET_KEY}`,
    { method: 'POST' }
  );

  const data = await res.json();
  if (!data.access_token) throw new Error('获取百度token失败');

  baiduToken = data.access_token;
  baiduTokenExpire = now + (data.expires_in || 2592000) * 1000 - 60000; // 提前1分钟过期
  return baiduToken;
}

// ── 智谱AI代理 ──
async function handleZhipuAI(request, env) {
  const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'Content-Type',
    'access-control-max-age': '86400',
  };

  // 处理 CORS 预检请求
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // 只允许 POST
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  try {
    const { messages, temperature = 0.3, max_tokens = 300 } = await request.json();

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return new Response(JSON.stringify({ error: 'messages 不能为空' }), {
          status: 400,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }

      // 从环境变量读取 API Key
      const apiKey = env.ZHIPU_API_KEY;
      if (!apiKey) {
        console.error('[AI Proxy] ZHIPU_API_KEY 未配置');
        return new Response(JSON.stringify({ error: 'API Key 未配置' }), {
          status: 500,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(ZHIPU_BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: ZHIPU_MODEL,
          messages,
          temperature,
          max_tokens,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.error('[AI Proxy] 智谱API错误:', response.status, errText);
        return new Response(JSON.stringify({
          error: `智谱API错误: ${response.status}`,
          detail: errText.substring(0, 500),
        }), {
          status: response.status,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }

      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content || '';

      if (!reply) {
        return new Response(JSON.stringify({ error: 'AI 返回空内容' }), {
          status: 502,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        success: true,
        reply,
        model: ZHIPU_MODEL,
        usage: data.usage || null,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });

    } catch (err) {
      const msg = err.name === 'AbortError' ? 'AI 响应超时' : err.message;
      console.error('[AI Proxy] 异常:', msg);
      return new Response(JSON.stringify({ error: `代理异常: ${msg}` }), {
        status: 500,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }
  }
};
