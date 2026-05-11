// api/wechat-reminder.js
// 企业微信应用消息推送 - WorkPlan 定时提醒
module.exports = async (req, res) => {
    // CORS 头
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        await sendReminder();
        return res.status(200).json({ success: true, message: '提醒已发送' });
    } catch (error) {
        console.error('发送失败:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

// ============ 核心逻辑 ============

async function sendReminder() {
    // 从环境变量读取，读不到时用硬编码默认值（来自 js/services.js）
    const SUPABASE_URL  = process.env.SUPABASE_URL  || 'https://scjswpjktydojedqywxq.supabase.co';
    const SUPABASE_KEY  = process.env.SUPABASE_KEY  || 'sb_publishable_TSXrb7sbhV7l5hgqjC0KuA_dVdxmSpu';
    const WEIXIN_CORP_ID  = process.env.WEIXIN_CORP_ID;
    const WEIXIN_AGENT_ID = process.env.WEIXIN_AGENT_ID;
    const WEIXIN_SECRET  = process.env.WEIXIN_SECRET;
    const WEIXIN_USER_ID = process.env.WEIXIN_USER_ID || 'QinSiQi';

    // ---- 调试日志 ----
    console.log('ENV DEBUG:', {
        hasCorpId:  !!WEIXIN_CORP_ID,
        corpId:     WEIXIN_CORP_ID,
        hasSecret:  !!WEIXIN_SECRET,
        hasAgentId: !!WEIXIN_AGENT_ID,
        hasUserId:  !!WEIXIN_USER_ID,
    });
    // ---- 结束调试 ----

    if (!WEIXIN_CORP_ID || !WEIXIN_SECRET) {
        throw new Error('缺少企业微信环境变量，请在 Vercel 后台配置 WEIXIN_CORP_ID / WEIXIN_SECRET');
    }

    // 1. 获取 Access Token
    const tokenUrl = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${WEIXIN_CORP_ID}&corpsecret=${WEIXIN_SECRET}`;
    console.log('请求 Token URL（已隐去 Secret）');

    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();

    if (tokenData.errcode !== 0) {
        throw new Error(`获取 Token 失败: ${JSON.stringify(tokenData)}`);
    }
    const accessToken = tokenData.access_token;

    // 2. 查询 Supabase 获取未完成任务
    // 直接用 rest api 查询，user_id 用环境变量中的默认用户 key
    const today = new Date().toISOString().split('T')[0];

    const tasksRes = await fetch(
        `${SUPABASE_URL}/rest/v1/tasks?select=*&status=neq.done&order=deadline.asc.nullsfirst&order=priority.desc&limit=20`,
        {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            }
        }
    );
    const tasks = await tasksRes.json();

    // 3. 生成本地测试用 user_id 映射（首次部署后手动设置）
    const targetUserId = WEIXIN_USER_ID || 'QinSiQi';

    // 4. 构造消息内容
    const reportText = buildReport(tasks, today);

    // 5. 发送应用消息
    const sendRes = await fetch(
        `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                touser: targetUserId,
                toparty: '',
                totag: '',
                msgtype: 'textcard',
                agentid: parseInt(WEIXIN_AGENT_ID),
                textcard: {
                    title: '【WorkPlan】每日工作提醒',
                    description: reportText,
                    url: 'https://www.yuyuworkplan-pro.xyz/',
                    btntxt: '打开 WorkPlan'
                }
            })
        }
    );

    const sendData = await sendRes.json();
    if (sendData.errcode !== 0) {
        throw new Error(`发送消息失败: ${JSON.stringify(sendData)}`);
    }

    console.log('消息发送成功');
}

function buildReport(tasks, today) {
    if (!tasks || tasks.length === 0) {
        return `<div class="highlight">🎉 太棒了！今日任务已全部完成，继续保持！</div>`;
    }

    // 按优先级分组
    const critical = tasks.filter(t => t.priority === 'critical' && t.status !== 'done');
    const urgent = tasks.filter(t => t.priority === 'urgent' && t.status !== 'done');
    const normal = tasks.filter(t => (t.priority === 'normal' || !t.priority) && t.status !== 'done');
    const overdue = tasks.filter(t => {
        if (!t.deadline || t.status === 'done') return false;
        const now = new Date().toISOString().slice(0, 16);
        return t.deadline < now;
    });

    let html = `<b>📅 ${today}</b><br>`;
    html += `<b>📊 共 ${tasks.length} 条未完成任务</b><br><br>`;

    if (overdue.length > 0) {
        html += `🔴 <b>已逾期（${overdue.length}条）</b><br>`;
        overdue.slice(0, 5).forEach(t => {
            html += `　• ${escapeHtml(t.title || '无标题')}${t.deadline ? ` <font color="red">⚠️ ${t.deadline.slice(0, 16).replace('T', ' ')}</font>` : ''}<br>`;
        });
        if (overdue.length > 5) html += `　…等 ${overdue.length} 条<br>`;
        html += `<br>`;
    }

    if (critical.length > 0) {
        html += `🔴 <b>紧急（${critical.length}条）</b><br>`;
        critical.slice(0, 5).forEach(t => {
            html += `　• ${escapeHtml(t.title || '无标题')}${t.deadline ? ` ⏰ ${t.deadline.slice(0, 16).replace('T', ' ')}` : ''}<br>`;
        });
        html += `<br>`;
    }

    if (urgent.length > 0) {
        html += `🟠 <b>重要（${urgent.length}条）</b><br>`;
        urgent.slice(0, 5).forEach(t => {
            html += `　• ${escapeHtml(t.title || '无标题')}${t.deadline ? ` ⏰ ${t.deadline.slice(0, 16).replace('T', ' ')}` : ''}<br>`;
        });
        html += `<br>`;
    }

    const rest = tasks.length - overdue.length - critical.length - urgent.length;
    if (normal.length > 0 || rest > 0) {
        const normalCount = normal.length + Math.max(0, rest);
        html += `🟡 <b>普通（${normalCount}条）</b><br>`;
        normal.slice(0, 5).forEach(t => {
            html += `　• ${escapeHtml(t.title || '无标题')}<br>`;
        });
        if (normal.length > 5 || rest > normal.length) html += `　…等 ${normalCount} 条<br>`;
    }

    html += `<br>— WorkPlan 自动提醒`;
    return html;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
