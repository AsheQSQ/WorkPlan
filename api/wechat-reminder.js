// api/wechat-reminder.js
// 企业微信应用消息推送 - WorkPlan 定时提醒 (Vercel Serverless)
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        await sendReminder();
        return res.status(200).json({ success: true, message: '提醒已发送' });
    } catch (error) {
        console.error('发送失败:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

async function sendReminder() {
    const SUPABASE_URL    = process.env.SUPABASE_URL    || 'https://scjswpjktydojedqywxq.supabase.co';
    const SUPABASE_KEY    = process.env.SUPABASE_KEY    || 'sb_publishable_TSXrb7sbhV7l5hgqjC0KuA_dVdxmSpu';
    const WEIXIN_CORP_ID  = process.env.WEIXIN_CORP_ID;
    const WEIXIN_AGENT_ID = process.env.WEIXIN_AGENT_ID;
    const WEIXIN_SECRET   = process.env.WEIXIN_SECRET;
    const WEIXIN_USER_ID  = process.env.WEIXIN_USER_ID || 'QinSiQi';

    if (!WEIXIN_CORP_ID || !WEIXIN_SECRET) {
        throw new Error('缺少 WEIXIN_CORP_ID / WEIXIN_SECRET 环境变量');
    }

    // 1. 获取 Access Token
    const tokenRes = await fetch(
        `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${WEIXIN_CORP_ID}&corpsecret=${WEIXIN_SECRET}`
    );
    const tokenData = await tokenRes.json();
    if (tokenData.errcode !== 0) throw new Error(`获取 Token 失败: ${JSON.stringify(tokenData)}`);
    const accessToken = tokenData.access_token;

    // 2. 查询 Supabase 未完成任务
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

    // 3. 生成报告
    const reportText = buildReport(tasks, today);

    // 4. 发送企微消息
    const sendRes = await fetch(
        `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                touser:  WEIXIN_USER_ID,
                toparty: '',
                totag:   '',
                msgtype: 'textcard',
                agentid: parseInt(WEIXIN_AGENT_ID),
                textcard: {
                    title:       '【WorkPlan】每日工作提醒',
                    description: reportText,
                    url:         'https://www.yuyuworkplan-pro.xyz/',
                    btntxt:      '打开 WorkPlan'
                }
            })
        }
    );
    const sendData = await sendRes.json();
    if (sendData.errcode !== 0) throw new Error(`发送失败: ${JSON.stringify(sendData)}`);
}

function buildReport(tasks, today) {
    if (!tasks || tasks.length === 0) {
        return `🎉 太棒了！今日任务已全部完成，继续保持！`;
    }
    const overdue  = tasks.filter(t => t.deadline && t.status !== 'done' && t.deadline < new Date().toISOString().slice(0, 16));
    const critical = tasks.filter(t => t.priority === 'critical');
    const urgent   = tasks.filter(t => t.priority === 'urgent');
    const normal   = tasks.filter(t => !t.priority || t.priority === 'normal');

    let html = `<b>📅 ${today}</b><br><b>📊 共 ${tasks.length} 条未完成任务</b><br><br>`;

    if (overdue.length) {
        html += `🔴 <b>已逾期（${overdue.length}条）</b><br>`;
        overdue.slice(0,5).forEach(t => {
            html += `　• ${esc(t.title||'无标题')}${t.deadline?` <font color="red">⚠️ ${t.deadline.slice(0,16).replace('T',' ')}</font>`:''}<br>`;
        });
        if (overdue.length > 5) html += `　…等 ${overdue.length} 条<br>`;
        html += `<br>`;
    }
    if (critical.length) {
        html += `🔴 <b>紧急（${critical.length}条）</b><br>`;
        critical.slice(0,5).forEach(t => {
            html += `　• ${esc(t.title||'无标题')}${t.deadline?` ⏰ ${t.deadline.slice(0,16).replace('T',' ')}`:''}<br>`;
        });
        html += `<br>`;
    }
    if (urgent.length) {
        html += `🟠 <b>重要（${urgent.length}条）</b><br>`;
        urgent.slice(0,5).forEach(t => {
            html += `　• ${esc(t.title||'无标题')}${t.deadline?` ⏰ ${t.deadline.slice(0,16).replace('T',' ')}`:''}<br>`;
        });
        html += `<br>`;
    }
    if (normal.length) {
        html += `🟡 <b>普通（${normal.length}条）</b><br>`;
        normal.slice(0,5).forEach(t => {
            html += `　• ${esc(t.title||'无标题')}<br>`;
        });
        if (normal.length > 5) html += `　…等 ${normal.length} 条<br>`;
    }
    html += `<br>— WorkPlan 自动提醒`;
    return html;
}

function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
