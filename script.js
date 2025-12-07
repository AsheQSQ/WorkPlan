// --- Supabase 配置 (保持不变) ---
const SUPABASE_URL = 'https://scjswpjktydojedqywxq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_TSXrb7sbhV7l5hgqjC0KuA_dVdxmSpu';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const { createApp } = Vue;

// 辅助工具：提取纯净数据
const getPureDataString = (data) => {
    const copy = JSON.parse(JSON.stringify(data));
    ['tasks', 'templates', 'scheduledTasks'].forEach(key => {
        if (copy[key]) copy[key].forEach(item => {
            delete item.expanded;
            delete item.isFromSchedule;
        });
    });
    return JSON.stringify(copy);
};

createApp({
    data() {
        return {
            // 登录与同步
            accessKey: null,
            inputKey: '',
            lastUpdatedAt: 0,
            lastCloudStr: '',
            isSyncing: 'idle',
            saveTimer: null,

            // AI 相关
            aiInput: '',
            chatHistory: [],
            showAiPanel: false,

            // 业务数据
            today: new Date().toISOString().split('T')[0],
            viewDate: new Date().toISOString().split('T')[0],
            now: new Date(),
            currentView: 'dashboard',
            tasks: [],
            templates: [],
            scheduledTasks: [],
            activeTask: null,
            modal: { show: false, isEdit: false, data: {} },
            isAllExpanded: false,

            // 统计相关数据
            statsStart: new Date().toISOString().split('T')[0],
            statsEnd: new Date().toISOString().split('T')[0],
            statsStatus: 'all',
            statsRangeType: 'week',
            draggingIndex: null
        }
    },
    computed: {
        syncStatus() {
            if (this.isSyncing === 'syncing') return { text: '同步中...', class: 'bg-blue-50 text-blue-600 border-blue-200', icon: 'ph ph-spinner animate-spin' };
            if (this.isSyncing === 'done') return { text: '已同步', class: 'bg-green-50 text-green-600 border-green-200', icon: 'ph-bold ph-check' };
            if (this.isSyncing === 'error') return { text: '同步失败', class: 'bg-red-50 text-red-600 border-red-200', icon: 'ph-bold ph-warning' };
            return { text: '就绪', class: 'bg-slate-50 text-slate-400 border-slate-200', icon: 'ph ph-cloud' };
        },
        dateInfo() {
            const date = new Date(this.viewDate);
            return { date: date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }), week: date.toLocaleDateString('zh-CN', { weekday: 'long' }) };
        },
        futurePreviews() {
            if (this.viewDate <= this.today) return [];
            const targetDay = new Date(this.viewDate).getDay();
            return this.scheduledTasks.filter(s => s.enabled && s.repeatDays.includes(targetDay === 0 ? 7 : targetDay)).map(s => ({ ...s, id: 'preview_' + s.id, status: 'todo', isPreview: true }));
        },
        activeTasks() {
            const list = this.tasks.filter(t => {
                const taskDate = t.date.split('T')[0];
                if (t.status === 'done') return false;
                if (this.viewDate === this.today) return taskDate <= this.today;
                else return taskDate === this.viewDate;
            });
            const pMap = { critical: 3, urgent: 2, normal: 1 };
            const sMap = { doing: 2, todo: 1 };
            return list.sort((a, b) => {
                const pDiff = pMap[b.priority] - pMap[a.priority];
                if (pDiff !== 0) return pDiff;
                const aOver = this.isOverdue(a) ? 1 : 0;
                const bOver = this.isOverdue(b) ? 1 : 0;
                if (aOver !== bOver) return bOver - aOver;
                const sDiff = sMap[b.status] - sMap[a.status];
                if (sDiff !== 0) return sDiff;
                return a.date > b.date ? 1 : -1;
            });
        },
        completedTasks() {
            return this.tasks.filter(t => {
                if (t.status !== 'done') return false;
                if (this.viewDate === this.today) return (t.date.split('T')[0] === this.today || (t.completedDate && t.completedDate.split('T')[0] === this.today));
                else return t.date.split('T')[0] === this.viewDate;
            });
        },
        overdueCount() { return this.tasks.filter(t => t.status !== 'done' && this.isOverdue(t)).length; },
        enabledScheduledCount() { return this.scheduledTasks.filter(t => t.enabled).length; },
        statsData() {
            const start = this.statsStart;
            const end = this.statsEnd;
            let list = this.tasks.filter(t => { const d = t.date.split('T')[0]; return d >= start && d <= end; });
            if (this.statsStatus === 'incomplete') { list = list.filter(t => t.status === 'todo' || t.status === 'doing'); }
            else if (this.statsStatus !== 'all') { list = list.filter(t => t.status === this.statsStatus); }
            list.sort((a, b) => new Date(b.date) - new Date(a.date));
            const total = list.length;
            const done = list.filter(t => t.status === 'done').length;
            const doing = list.filter(t => t.status === 'doing').length;
            const todo = list.filter(t => t.status === 'todo').length;
            const rate = total > 0 ? ((done / total) * 100).toFixed(1) : 0;
            return { total, done, doing, todo, rate, list };
        }
    },
    mounted() {
        const savedKey = localStorage.getItem('planpro_access_key');
        if (savedKey) { this.accessKey = savedKey; this.loadData(); }
        this.setStatsRange('week');
        setInterval(() => { this.now = new Date(); if (this.currentView === 'dashboard' && this.viewDate === this.today) this.checkScheduledTasks(); }, 60000);
    },
    watch: {
        tasks: { handler() { if (this.accessKey) this.saveData(); }, deep: true },
        templates: { handler() { if (this.accessKey) this.saveData(); }, deep: true },
        scheduledTasks: { handler() { if (this.accessKey) this.saveData(); }, deep: true }
    },
    methods: {
        login() { if (!this.inputKey.trim()) return alert("Key 不能为空"); this.accessKey = this.inputKey.trim(); localStorage.setItem('planpro_access_key', this.accessKey); this.loadData(); },
        generateKey() { this.inputKey = 'user_' + Math.random().toString(36).substr(2, 9); },
        logout() { if (confirm("确定要退出当前 Key 吗？")) { localStorage.removeItem('planpro_access_key'); this.accessKey = null; this.inputKey = ''; this.tasks = []; this.templates = []; this.scheduledTasks = []; } },

        async loadData() {
            this.isSyncing = 'syncing';
            try {
                const { data } = await supabase.from('user_data').select('content, updated_at').eq('my_key', this.accessKey).single();
                if (data && data.content) {
                    const json = data.content;
                    if (json.tasks) this.tasks = json.tasks;
                    if (json.templates) this.templates = json.templates;
                    if (json.scheduledTasks) this.scheduledTasks = json.scheduledTasks;
                    this.lastUpdatedAt = data.updated_at || 0;
                    this.lastCloudStr = getPureDataString({ tasks: this.tasks, templates: this.templates, scheduledTasks: this.scheduledTasks });
                    this.isSyncing = 'done';
                } else {
                    console.log("新用户或无云端数据"); this.isSyncing = 'idle';
                }
                this.checkScheduledTasks();
            } catch (e) { console.error(e); this.isSyncing = 'error'; }
        },

        saveData() {
            if (!this.accessKey) return;
            const currentPureStr = getPureDataString({ tasks: this.tasks, templates: this.templates, scheduledTasks: this.scheduledTasks });
            if (currentPureStr === this.lastCloudStr) return;

            this.isSyncing = 'syncing';
            if (this.saveTimer) clearTimeout(this.saveTimer);

            this.saveTimer = setTimeout(async () => {
                const nowTimestamp = Date.now();
                const rawData = JSON.parse(currentPureStr);
                const { error } = await supabase.from('user_data').upsert({ my_key: this.accessKey, content: rawData, updated_at: nowTimestamp }, { onConflict: 'my_key' });
                if (error) { this.isSyncing = 'error'; }
                else {
                    this.lastUpdatedAt = nowTimestamp;
                    this.lastCloudStr = currentPureStr;
                    this.isSyncing = 'done';
                    setTimeout(() => { if (this.isSyncing === 'done') this.isSyncing = 'idle'; }, 3000);
                }
            }, 2000);
        },

        checkScheduledTasks() {
            const todayDate = new Date(this.today); let addedCount = 0;
            this.scheduledTasks.forEach(sch => {
                if (!sch.enabled) return;
                let checkDate = sch.lastGeneratedDate ? new Date(new Date(sch.lastGeneratedDate).setDate(new Date(sch.lastGeneratedDate).getDate() + 1)) : new Date(todayDate);
                while (checkDate <= todayDate) {
                    const dayOfWeek = checkDate.getDay();
                    if (sch.repeatDays.includes(dayOfWeek)) {
                        this.tasks.push({ id: Date.now() + Math.random().toString(36).substr(2, 5), title: sch.title, status: 'todo', priority: sch.priority, date: checkDate.toISOString().split('T')[0] + 'T09:00', deadline: '', note: sch.note, subtasks: JSON.parse(JSON.stringify(sch.subtasks)), expanded: false, isFromSchedule: true });
                        addedCount++;
                    }
                    checkDate.setDate(checkDate.getDate() + 1);
                }
                sch.lastGeneratedDate = this.today;
            });
            if (addedCount > 0) this.saveData();
        },

        setStatsRange(type) {
            this.statsRangeType = type;
            const d = new Date();
            const y = d.getFullYear();
            const m = d.getMonth();
            const day = d.getDay() || 7;

            if (type === 'today') { this.statsStart = this.statsEnd = this.today; }
            else if (type === 'yesterday') { d.setDate(d.getDate() - 1); this.statsStart = this.statsEnd = d.toISOString().split('T')[0]; }
            else if (type === 'week') { d.setDate(d.getDate() - day + 1); this.statsStart = d.toISOString().split('T')[0]; d.setDate(d.getDate() + 6); this.statsEnd = d.toISOString().split('T')[0]; }
            else if (type === 'lastWeek') { d.setDate(d.getDate() - day - 6); this.statsStart = d.toISOString().split('T')[0]; d.setDate(d.getDate() + 6); this.statsEnd = d.toISOString().split('T')[0]; }
            else if (type === 'month') { this.statsStart = new Date(y, m, 1, 12).toISOString().split('T')[0]; this.statsEnd = new Date(y, m + 1, 0, 12).toISOString().split('T')[0]; }
            else if (type === 'lastMonth') { this.statsStart = new Date(y, m - 1, 1, 12).toISOString().split('T')[0]; this.statsEnd = new Date(y, m, 0, 12).toISOString().split('T')[0]; }
        },

        handleClearData() { if (confirm(`⚠️ 警告：删除 [${this.accessKey}] 所有数据？`)) { supabase.from('user_data').delete().eq('my_key', this.accessKey).then(() => location.reload()); } },
        exportData() { const blob = new Blob([JSON.stringify({ tasks: this.tasks, templates: this.templates, scheduledTasks: this.scheduledTasks }, null, 2)], { type: "application/json" }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `backup_${this.today}.json`; a.click(); },
        importData(event) {
            const file = event.target.files[0]; if (!file) return;
            const reader = new FileReader(); reader.onload = (e) => {
                try { const json = JSON.parse(e.target.result); if (json.tasks) this.tasks = json.tasks; if (json.templates) this.templates = json.templates; if (json.scheduledTasks) this.scheduledTasks = json.scheduledTasks; alert("导入成功！"); } catch { alert('无效文件'); }
            }; reader.readAsText(file);
        },

        dragStart(i, e) { this.draggingIndex = i; },
        dragDrop(to) { const arr = this.modal.data.subtasks; const item = arr.splice(this.draggingIndex, 1)[0]; arr.splice(to, 0, item); },
        toggleSubtask(task, sub) { sub.status = sub.status === 'done' ? 'todo' : 'done'; if (sub.status === 'done' && task.status === 'todo') { task.status = 'doing'; this.updateStatus(task); } },
        updateStatus(task) { const now = new Date(new Date().getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16); if (task.status === 'doing') { if (!task.startTime) task.startTime = now; task.completedDate = null; } else if (task.status === 'done') { task.completedDate = now; if (task.subtasks) task.subtasks.forEach(s => s.status = 'done'); } else { task.startTime = null; task.completedDate = null; } },
        changeDate(off) { const d = new Date(this.viewDate); d.setDate(d.getDate() + off); this.viewDate = d.toISOString().split('T')[0]; this.activeTask = null; },
        resetToToday() { this.viewDate = this.today; this.checkScheduledTasks(); },
        switchView(view) { this.currentView = view; this.activeTask = null; if (view === 'dashboard') { this.viewDate = this.today; this.checkScheduledTasks(); } },
        
        toggleAiPanel() {
            this.showAiPanel = !this.showAiPanel;
            if (this.showAiPanel) {
                this.activeTask = null;
            }
        },

        selectTask(task) { 
            this.showAiPanel = false;
            this.activeTask = task; 
        },
        toggleAll() { this.isAllExpanded = !this.isAllExpanded; this.activeTasks.forEach(t => t.expanded = this.isAllExpanded); },
        deleteTask(id) { if (confirm('确定删除？')) { if (this.currentView === 'dashboard') this.tasks = this.tasks.filter(t => t.id !== id); else if (this.currentView === 'templates') this.templates = this.templates.filter(t => t.id !== id); else this.scheduledTasks = this.scheduledTasks.filter(t => t.id !== id); if (this.activeTask?.id === id) this.activeTask = null; } },
        loadTemplate(e) { const t = this.templates.find(x => x.id === e.target.value); if (t) { this.modal.data.title = t.title; this.modal.data.priority = t.priority; this.modal.data.subtasks = JSON.parse(JSON.stringify(t.subtasks)); } e.target.value = ''; },
        openModal(task) { this.modal.show = true; this.modal.isEdit = !!task; this.modal.data = task ? JSON.parse(JSON.stringify(task)) : { id: Date.now().toString(), title: '', status: 'todo', priority: 'normal', date: this.currentView === 'dashboard' ? this.viewDate + 'T12:00' : this.today + 'T09:00', subtasks: [], repeatDays: [] }; },
        addModalSubtask() { const v = this.$refs.newSubInput.value.trim(); if (v) { if (!this.modal.data.subtasks) this.modal.data.subtasks = []; this.modal.data.subtasks.push({ title: v, status: 'todo' }); this.$refs.newSubInput.value = ''; } },
        saveTask() { if (!this.modal.data.title) return; const d = this.modal.data; const arr = this.currentView === 'dashboard' ? this.tasks : (this.currentView === 'templates' ? this.templates : this.scheduledTasks); if (this.modal.isEdit) { const i = arr.findIndex(t => t.id === d.id); d.expanded = arr[i].expanded; arr[i] = d; if (this.activeTask?.id === d.id) this.activeTask = d; } else arr.push(d); this.modal.show = false; },
        addInlineSubtask(t, e) { if (e.target.value.trim()) { t.subtasks.push({ title: e.target.value, status: 'todo' }); e.target.value = ''; } },
        isOverdue(t) { if (!t.deadline) return false; const now = new Date(this.now.getTime() - (this.now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16); return t.deadline < now; },
        getLatestNoteLine(n) { return n ? n.split('\n').filter(l => l.trim()).pop() : ''; },
        getStatusStyle(s) { return { 'todo': 'bg-slate-100 text-slate-500', 'doing': 'bg-blue-50 text-blue-600', 'done': 'bg-green-50 text-green-600' }[s]; },
        getPriorityStyle(p) { return { 'normal': 'text-blue-500', 'urgent': 'text-orange-500', 'critical': 'text-red-500' }[p]; },
        formatRepeatDays(d) { if (!d || !d.length) return ['无']; const m = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 0: '日' }; return d.sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b)).map(x => '周' + m[x]); },
        formatTimeOnly(d) { return d && d.includes('T') ? d.split('T')[1] : ''; },
        formatDateTime(d) { return d ? d.replace('T', ' ') : ''; },
        getStatsStatusStyle(t) { return t.status === 'done' ? (t.deadline && t.completedDate > t.deadline ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700') : (t.status === 'doing' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'); },
        getStatsStatusLabel(t) { return t.status === 'done' ? (t.deadline && t.completedDate > t.deadline ? '超时完成' : '已完成') : { 'todo': '未开始', 'doing': '进行中' }[t.status]; },

        // === AI 助手核心逻辑 (使用自定义 Vercel API) ===

        async sendAiMessage() {
            const text = this.aiInput.trim();
            if (!text) return;

            // 添加用户消息
            this.chatHistory.push({ role: 'user', type: 'text', content: text });
            this.aiInput = '';

            // 添加加载状态
            this.chatHistory.push({ role: 'assistant', type: 'loading' });
            this.$nextTick(() => this.scrollToBottom());

            try {
                // 调用新的分析方法
                const result = await this.analyzeAiIntent(text);

                // 移除加载状态
                this.chatHistory.pop();

                if (result) {
                    this.chatHistory.push({
                        role: 'assistant',
                        type: 'task_card',
                        data: result,
                        confirmed: false
                    });
                } else {
                    this.chatHistory.push({
                        role: 'assistant',
                        type: 'text',
                        content: 'AI 似乎没有理解，请尝试描述得更具体一点（例如包含时间）。'
                    });
                }
            } catch (error) {
                this.chatHistory.pop(); // 移除加载
                console.error(error);
                let errorMsg = "请求出错，请检查网络或 Key 配置。";
                if(error.message) errorMsg = `出错了: ${error.message}`;
                
                this.chatHistory.push({
                    role: 'assistant',
                    type: 'text',
                    content: errorMsg
                });
            }

            this.$nextTick(() => this.scrollToBottom());
        },

        // 确认添加
        confirmAiTask(taskData, msgIndex) {
            this.tasks.push(taskData);
            this.saveData(); 

            // 更新卡片状态
            this.chatHistory[msgIndex].confirmed = true;

            // 发送成功提示
            this.chatHistory.push({
                role: 'assistant',
                type: 'text',
                content: `✅ 任务 "${taskData.title}" 已成功添加到列表！`
            });
            this.$nextTick(() => this.scrollToBottom());
        },

        scrollToBottom() {
            const container = this.$refs.chatContainer || this.$refs.chatContainerMobile;
            if (container) container.scrollTop = container.scrollHeight;
        },

        // ⭐⭐⭐ 核心修改：调用本地 Vercel API 代理混元模型 ⭐⭐⭐
// ... 在 analyzeAiIntent 函数内部 ...

        async analyzeAiIntent(userText) {
            // 构造系统提示词 (保持不变)
            const nowStr = new Date().toLocaleString('zh-CN', { hour12: false });
            const systemInstructions = `你是一个任务管理助手。当前时间：${nowStr}。
            请根据用户的自然语言输入生成一个任务对象。
            【要求】
            1. 严格只返回纯 JSON 格式字符串，不要包含 markdown 标记。
            2. 不要包含任何解释性文字。
            3. JSON 需包含以下字段：
               - "title": 任务标题 (String)
               - "date": 计划日期时间, 格式 "YYYY-MM-DDTHH:mm" (String)
               - "priority": 优先级, 只能是 "normal" 或 "urgent" (String)
               - "note": 备注信息 (String)
            `;

            const fullMessage = `${systemInstructions}\n\n用户输入: ${userText}`;

            // ⭐⭐ 修改这里：使用你的 Vercel 完整域名 ⭐⭐
            // 请将 https://你的项目名.vercel.app 替换为你真实的 Vercel 访问地址
            const VERCEL_HOST = 'https://work-plan-puce.vercel.app/'; 
            
            try {
                const response = await fetch(`${VERCEL_HOST}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: fullMessage })
                });

                if (!response.ok) {
                    // 如果跨域配置正确但这里报错，可能是 500 服务器错误
                    throw new Error(`API Error: ${response.status}`);
                }

                const data = await response.json();
                
                // ... (后续解析逻辑保持不变)
                const aiRawContent = data.choices?.[0]?.message?.content;
                if (!aiRawContent) return null;

                const cleanJsonStr = aiRawContent
                    .replace(/```json/g, '')
                    .replace(/```/g, '')
                    .trim();

                const parsed = JSON.parse(cleanJsonStr);

                return {
                    id: Date.now().toString(),
                    title: parsed.title || "未命名任务",
                    date: parsed.date || this.today + "T09:00",
                    status: 'todo',
                    priority: parsed.priority || 'normal',
                    subtasks: [],
                    note: parsed.note || ''
                };
            } catch (error) {
                console.error("AI 请求失败:", error);
                throw error; // 抛出错误以便上层捕获显示
            }
        }
    }
}).mount('#app');
