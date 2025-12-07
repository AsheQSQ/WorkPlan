// api/chat.js
// 切换为 CommonJS 写法，避免模块加载错误
module.exports = async (req, res) => {
    // 1. 强制写入 CORS 头 (无论代码是否报错，尽量先写头)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // 2. 处理预检请求 (OPTIONS)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 3. 限制 POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { message } = req.body || {};
        const apiKey = process.env.HUNYUAN_API_KEY;

        // 检查 Key
        if (!apiKey) {
            console.error("缺少 API Key");
            return res.status(500).json({ error: "服务器配置错误: 缺少 API Key" });
        }

        console.log("正在请求混元接口..."); // 这行日志会在 Vercel 后台显示

        // 4. 调用腾讯混元 (Node 18 原生 fetch)
        const response = await fetch('https://api.hunyuan.cloud.tencent.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "hunyuan-turbo",
                messages: [{ role: "user", content: message || "你好" }],
                temperature: 0.7
            })
        });

        // 5. 处理腾讯返回的错误
        if (!response.ok) {
            const errorText = await response.text();
            console.error("腾讯 API 错误:", errorText);
            return res.status(response.status).json({ error: "Upstream Error", details: errorText });
        }

        const data = await response.json();
        return res.status(200).json(data);

    } catch (error) {
        console.error("代码执行崩溃:", error);
        // 返回具体的错误信息，方便前端调试
        return res.status(500).json({ error: "Server Error", message: error.message, stack: error.stack });
    }
};
