/**
 * Vercel Serverless Function — 大模型中转代理
 * 解决浏览器 CORS 限制，前端 → Vercel API → 智谱AI
 */

// 智谱AI 配置
const ZHIPU_API_KEY = '30bbf2ce64fa4769bdbef742b872dc78.E3NqHF9lUmN9lbZr';
const ZHIPU_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const ZHIPU_MODEL = 'glm-4-flash'; // 永久免费模型

// 请求超时（8秒）
const TIMEOUT = 8000;

export default async function handler(req, res) {
    // 只允许 POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: '只支持 POST 请求' });
    }

    try {
        const { messages, temperature = 0.3, max_tokens = 300 } = req.body;

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: 'messages 不能为空' });
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

        const response = await fetch(ZHIPU_BASE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ZHIPU_API_KEY}`,
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
            const errText = await response.text();
            console.error('[AI Proxy] 智谱API错误:', response.status, errText);
            return res.status(response.status).json({
                error: `智谱API错误: ${response.status}`,
                detail: errText,
            });
        }

        const data = await response.json();

        // 提取回复内容
        const reply = data.choices?.[0]?.message?.content || '';

        return res.status(200).json({
            success: true,
            reply,
            model: ZHIPU_MODEL,
            usage: data.usage || null,
        });

    } catch (err) {
        if (err.name === 'AbortError') {
            console.error('[AI Proxy] 请求超时');
            return res.status(504).json({ error: 'AI 响应超时，请稍后再试' });
        }
        console.error('[AI Proxy] 异常:', err.message);
        return res.status(500).json({ error: `代理异常: ${err.message}` });
    }
}

// Vercel 需要导出 config
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '10kb',
        },
    },
};
