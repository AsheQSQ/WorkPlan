// scripts/send-reminder.js
// GitHub Actions 定时执行版 - 企业微信应用消息推送
// 直接运行，无需 HTTP Server

const https = require('https');
const http = require('http');

async function main() {
    console.log('========== WorkPlan 企微提醒任务启动 ==========');

    // 从环境变量读取配置
    const SUPABASE_URL    = process.env.SUPABASE_URL;
    const SUPABASE_KEY    = process.env.SUPABASE_KEY;
    const WEIXIN_CORP_ID   = process.env.WEIXIN_CORP_ID;
    const WEIXIN_SECRET    = process.env.WEIXIN_SECRET;
    const WEIXIN_AGENT_ID  = process.env.WEIXIN_AGENT_ID;
    const WEIXIN_USER_ID   = process.env.WEIXIN_USER_ID || 'QinSiQi';

    // 验证必需变量
    const missing = [];
    if (!SUPABASE_URL)    missing.push('SUPABASE_URL');
    if (!SUPABASE_KEY)    missing.push('SUPABASE_KEY');
    if (!WEIXIN_CORP_ID)  missing.push('WEIXIN_CORP_ID');
    if (!WEIXIN_SECRET)   missing.push('WEIXIN_SECRET');
    if (!WEIXIN_AGENT_ID) missing.push('WEIXIN_AGENT_ID');

    if (missing.length > 0) {
        throw new Error(`缺少环境变量: ${missing.join(', ')}`);
    }

    console.log('环境变量检查通过');

    // 1. 获取 Access Token
    const accessToken = await getAccessToken(WEIXIN_CORP_ID, WEIXIN_SECRET);

    // 2. 查询 Supabase 未完成任务
    const tasks = await fetchTasks(SUPABASE_URL, SUPABASE_KEY);

    // 3. 构造消息内容
    const today = new Date().toISOString().split('T')[0];
    const reportText = buildReport(tasks, today);
    console.log(`查询到 ${tasks.length} 条未完成任务`);

    // 4. 发送企微消息
    await sendWechatMessage(accessToken, WEIXIN_AGENT_ID, WEIXIN_USER_ID, reportText);

    console.log('========== 任务完成 ==========');
}

// ============ 企业微信 API ============

function getAccessToken(corpId, secret) {
    return new Promise((resolve, reject) => {
        const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}`;
        httpsGet(url).then(data => {
            if (data.errcode !== 0) {
                reject(new Error(`获取 Token 失败: ${data.errmsg} (${data.errcode})`));
            } else {
                console.log('Access Token 获取成功');
                resolve(data.access_token);
            }
        }).catch(reject);
    });
}

function sendWechatMessage(token, agentId, userId, description) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            touser:  userId,
            toparty: '',
            totag:   '',
            msgtype: 'textcard',
            agentid: parseInt(agentId),
            textcard: {
                title:        '【WorkPlan】每日工作提醒',
                description:  description,
                url:          'https://www.yuyuworkplan-pro.xyz/',
                btntxt:       '打开 WorkPlan'
            }
        });

        const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;
        httpsPost(url, payload).then(data => {
            if (data.errcode !== 0) {
                reject(new Error(`发送消息失败: ${data.errmsg} (${data.errcode})`));
            } else {
                console.log('企微消息发送成功');
                resolve(data);
            }
        }).catch(reject);
    });
}

// ============ Supabase API ============

function fetchTasks(supabaseUrl, supabaseKey) {
    return new Promise((resolve, reject) => {
        const url = `${supabaseUrl}/rest/v1/tasks?select=*&status=neq.done&order=deadline.asc.nullsfirst&order=priority.desc&limit=20`;
        const headers = {
            'apikey':       supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
        };

        httpsGet(url, headers).then(data => {
            if (Array.isArray(data)) {
                resolve(data);
            } else {
                reject(new Error(`Supabase 返回异常: ${JSON.stringify(data)}`));
            }
        }).catch(reject);
    });
}

// ============ HTTP 工具 ============

function httpsGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path:     urlObj.pathname + urlObj.search,
            method:   'GET',
            headers:  { 'User-Agent': 'WorkPlan-Reminder/1.0', ...headers }
        };

        const req = https.request(options, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch {
                    reject(new Error(`HTTP 响应解析失败: ${body.slice(0, 200)}`));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('请求超时')); });
        req.end();
    });
}

function httpsPost(url, payload) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path:     urlObj.pathname + urlObj.search,
            method:   'POST',
            headers:  {
                'User-Agent':  'WorkPlan-Reminder/1.0',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const req = https.request(options, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch {
                    reject(new Error(`HTTP 响应解析失败: ${body.slice(0, 200)}`));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('请求超时')); });
        req.write(payload);
        req.end();
    });
}

// ============ 报告生成 ============

function buildReport(tasks, today) {
    if (!tasks || tasks.length === 0) {
        return `<div class="highlight">🎉 太棒了！今日任务已全部完成，继续保持！</div>`;
    }

    const overdue  = tasks.filter(t => t.deadline && t.status !== 'done' && t.deadline < new Date().toISOString().slice(0, 16));
    const critical = tasks.filter(t => t.priority === 'critical' && t.status !== 'done');
    const urgent   = tasks.filter(t => t.priority === 'urgent'   && t.status !== 'done');
    const normal   = tasks.filter(t => (t.priority === 'normal' || !t.priority) && t.status !== 'done');

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

// 启动
main().catch(err => {
    console.error('任务执行失败:', err.message);
    process.exit(1);
});
