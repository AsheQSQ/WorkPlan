// api/chat.js
// 这里的代码运行在服务器端，用户看不见，很安全

export default async function handler(req, res) {
  // 1. 解决跨域 (CORS) - 允许任何网站访问，或者指定你的网址
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // 处理预检请求 (浏览器的 OPTIONS 请求)
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // 2. 只有 POST 请求才处理
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const userMessage = req.body.message;
    // 获取环境变量里的 Key (在 Vercel 后台配置)
    const apiKey = process.env.HUNYUAN_API_KEY; 

    // 3. 请求腾讯混元接口
    const fetch = await import('node-fetch'); // Vercel Node环境可能需要动态引入或直接用 fetch
    // 注意：Node 18+ 原生支持 fetch，如果报错可能需要安装 node-fetch
    
    const response = await fetch.default('https://api.hunyuan.cloud.tencent.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "hunyuan-turbos-latest",
        messages: [{ role: "user", content: userMessage }]
      })
    });

    const data = await response.json();
    
    // 4. 返回给前端
    res.status(200).json(data);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
