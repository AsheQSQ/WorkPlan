// --- Supabase 配置 ---
const SUPABASE_URL = 'https://scjswpjktydojedqywxq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_TSXrb7sbhV7l5hgqjC0KuA_dVdxmSpu';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const { createApp } = Vue;

createApp({
    data() {
        return {
            isRegisterMode: false,
            accessKey: null,
            userId: null,
            inputKey: '',
            inputPassword: '',
            
            isSyncing: 'idle',
            saveTimer: null,
            lastDataHash: '',

            aiInput: '',
            chatHistory: [],
            showAiPanel: false,

            today: new Date().toISOString().split('T')[0],
            viewDate: new Date().toISOString().split('T')[0],
            now: new Date(),
            currentView: 'dashboard',
            
            groups: [],
            activeGroupId: 'all',

            tasks: [],
            templates: [],
            scheduledTasks: [],
            activeTask: null,
            modal: { show: false, isEdit: false, data: {} },
            isAllExpanded: false,

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
        activeTasks() {
            const list = this.tasks.filter(t => {
                if (t.status === 'done') return false;
                
                const taskDate = t.date ? t.date.split('T')[0] : '';
                
                // --- BUG 修复点：今日看板不再过滤未来任务 ---
                if (this.viewDate === this.today) {
                    // 原逻辑：if (taskDate > this.today) return false; (已删除)
                    // 只要状态不是 done，今日视图均显示
                } else {
                    // 如果是在日历里选择了特定某一天，则只显示那一天的任务
                    if (taskDate !== this.viewDate) return false;
                }
                
                // 过滤分组
                if (this.activeGroupId !== 'all' && (t.groupId || '') !== this.activeGroupId) {
                    return false;
                }
                
                return true;
            });
            
            // 排序逻辑保持不变
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
                if (this.viewDate === this.today) {
                    if (t.date.split('T')[0] !== this.today && !(t.completedDate && t.completedDate.split('T')[0] === this.today)) return false;
                } else {
                    if (t.date.split('T')[0] !== this.viewDate) return false;
                }
                if (this.activeGroupId !== 'all' && (t.groupId || '') !== this.activeGroupId) return false;
                return true;
            });
        },
        enabledScheduledCount() { return this.scheduledTasks.filter(t => t.enabled).length; },
        statsData() {
            const start = this.statsStart;
            const end = this.statsEnd;
            let list = this.tasks.filter(t => { const d = t.date.split('T')[0]; return d >= start && d <= end; });
            const total = list.length;
            const done = list.filter(t => t.status === 'done').length;
            const rate = total > 0 ? ((done / total) * 100).toFixed(1) : 0;
            return { total, done, rate, list };
        }
    },
    mounted() {
        const savedKey = localStorage.getItem('planpro_access_key');
        const savedId = localStorage.getItem('planpro_user_id');
        if (savedKey && savedId) { 
            this.accessKey = savedKey; 
            this.userId = savedId;
            this.loadData(); 
        }
        this.setStatsRange('week');

        setInterval(() => {
            this.now = new Date();
            const nowIso = new Date(this.now.getTime() - (this.now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
            let tasksChanged = false;

            this.tasks.forEach(t => {
                // 当计划日期到达时，自动从“未开始”转为“进行中”
                if (t.status === 'todo' && t.date && t.date <= nowIso) {
                    t.status = 'doing';
                    this.updateStatus(t);
                    tasksChanged = true;
                }
            });

            if (tasksChanged && this.userId) this.saveData();
        }, 60000);
    },
    watch: {
        tasks: { handler() { if (this.userId) this.saveData(); }, deep: true },
        templates: { handler() { if (this.userId) this.saveData(); }, deep: true },
        scheduledTasks: { handler() { if (this.userId) this.saveData(); }, deep: true },
        groups: { handler() { if (this.userId) this.saveData(); }, deep: true }
    },
    methods: {
        generateDataHash() {
            return JSON.stringify({
                t: this.tasks.map(({ expanded, ...rest }) => rest),
                tm: this.templates,
                s: this.scheduledTasks,
                g: this.groups
            });
        },
        getGroupName(id) {
            if (!id) return '无';
            const g = this.groups.find(x => x.id === id);
            return g ? g.name : '无';
        },
        createGroup() {
            const name = prompt('请输入新工作组名称:');
            if (name && name.trim()) {
                const newId = 'g_' + Date.now();
                this.groups.push({ id: newId, name: name.trim(), user_id: this.userId });
                this.activeGroupId = newId;
            }
        },
        deleteGroup(id) {
            if (confirm('确定删除该分组吗？此分组下的任务将被归为"无"分组。')) {
                this.groups = this.groups.filter(g => g.id !== id);
                this.activeGroupId = 'all';
                this.tasks.forEach(t => { if (t.groupId === id) t.groupId = ''; });
            }
        },
        async handleAuth() {
            if (!this.inputKey.trim() || !this.inputPassword.trim()) return alert("账号和密码不能为空");
            this.isSyncing = 'syncing';
            try {
                if (this.isRegisterMode) {
                    const { data, error } = await supabaseClient.rpc('register_user', { p_access_key: this.inputKey.trim(), p_password: this.inputPassword });
                    if (error) throw new Error('该账号已被注册或格式错误');
                    this.userId = data;
                } else {
                    const { data, error } = await supabaseClient.rpc('verify_login', { p_access_key: this.inputKey.trim(), p_password: this.inputPassword });
                    if (error || !data) throw new Error("账号或密码错误");
                    this.userId = data;
                }
                localStorage.setItem('planpro_access_key', this.inputKey.trim());
                localStorage.setItem('planpro_user_id', this.userId);
                this.accessKey = this.inputKey.trim();
                await this.loadData();
            } catch (e) { alert(e.message); this.isSyncing = 'error'; }
        },
        logout() { 
            if (confirm("确定要退出吗？")) { 
                localStorage.clear(); 
                window.location.reload();
            } 
        },
        async loadData() {
            this.isSyncing = 'syncing';
            try {
                const [tasksRes, templatesRes, scheduledRes, groupsRes] = await Promise.all([
                    supabaseClient.from('tasks').select('*').eq('user_id', this.userId),
                    supabaseClient.from('templates').select('*').eq('user_id', this.userId),
                    supabaseClient.from('scheduled_tasks').select('*').eq('user_id', this.userId),
                    supabaseClient.from('groups').select('*').eq('user_id', this.userId)
                ]);
                this.groups = groupsRes.data || [];
                this.tasks = (tasksRes.data || []).map(t => ({ ...t, date: t.plan_date ? t.plan_date.substring(0, 16) : '', expanded: false, groupId: t.group_id || '' }));
                this.templates = (templatesRes.data || []).map(t => ({ ...t, groupId: t.group_id || '' }));
                this.scheduledTasks = (scheduledRes.data || []).map(s => ({ ...s, repeatDays: s.repeat_days || [], groupId: s.group_id || '' }));
                this.lastDataHash = this.generateDataHash();
                this.isSyncing = 'done';
            } catch (e) { this.isSyncing = 'error'; }
        },
        saveData() {
            if (!this.userId) return;
            const currentHash = this.generateDataHash();
            if (this.lastDataHash === currentHash) return; 
            this.lastDataHash = currentHash;
            this.isSyncing = 'syncing';
            if (this.saveTimer) clearTimeout(this.saveTimer);
            this.saveTimer = setTimeout(async () => {
                try {
                    const dbTasks = this.tasks.map(t => ({ id: t.id, user_id: this.userId, title: t.title, status: t.status, priority: t.priority, plan_date: t.date || null, group_id: t.groupId || null, updated_at: new Date().toISOString() }));
                    const dbGroups = this.groups.map(g => ({ id: g.id, user_id: this.userId, name: g.name }));
                    if (dbTasks.length > 0) await supabaseClient.from('tasks').upsert(dbTasks);
                    if (dbGroups.length > 0) await supabaseClient.from('groups').upsert(dbGroups);
                    this.isSyncing = 'done';
                } catch (error) { this.isSyncing = 'error'; }
            }, 1500); 
        },
        async deleteTask(id) { 
            if (confirm('确定删除？')) { 
                this.tasks = this.tasks.filter(t => t.id !== id);
                await supabaseClient.from('tasks').delete().eq('id', id);
            } 
        },
        updateStatus(task) { 
            const nowIso = new Date(this.now.getTime() - (this.now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16); 
            if (task.status === 'done') task.completedDate = nowIso; else task.completedDate = null;
        },
        setStatsRange(type) {
            this.statsRangeType = type;
            const d = new Date();
            if (type === 'week') { d.setDate(d.getDate() - 7); this.statsStart = d.toISOString().split('T')[0]; this.statsEnd = this.today; }
            else if (type === 'month') { d.setMonth(d.getMonth() - 1); this.statsStart = d.toISOString().split('T')[0]; this.statsEnd = this.today; }
        },
        exportData() { const blob = new Blob([JSON.stringify({ tasks: this.tasks, groups: this.groups }, null, 2)], { type: "application/json" }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `backup_${this.today}.json`; a.click(); },
        importData(event) {
            const file = event.target.files[0]; if (!file) return;
            const reader = new FileReader(); reader.onload = (e) => {
                try { const json = JSON.parse(e.target.result); if (json.tasks) this.tasks = json.tasks; if(json.groups) this.groups = json.groups; alert("导入成功！"); } catch { alert('文件错误'); }
            }; reader.readAsText(file);
        },
        changeDate(off) { const d = new Date(this.viewDate); d.setDate(d.getDate() + off); this.viewDate = d.toISOString().split('T')[0]; },
        resetToToday() { this.viewDate = this.today; },
        switchView(view) { this.currentView = view; this.activeTask = null; },
        toggleAiPanel() { this.showAiPanel = !this.showAiPanel; },
        selectTask(task) { this.activeTask = task; },
        toggleAll() { this.isAllExpanded = !this.isAllExpanded; this.activeTasks.forEach(t => t.expanded = this.isAllExpanded); },
        openModal(task) { 
            this.modal.show = true; this.modal.isEdit = !!task;
            const defaultGroupId = this.activeGroupId === 'all' ? '' : this.activeGroupId;
            this.modal.data = task ? JSON.parse(JSON.stringify(task)) : { id: Date.now().toString(), title: '', status: 'todo', priority: 'normal', date: this.viewDate + 'T12:00', groupId: defaultGroupId }; 
        },
        saveTask() { if (!this.modal.data.title) return; const d = this.modal.data; if (this.modal.isEdit) { const i = this.tasks.findIndex(t => t.id === d.id); this.tasks[i] = d; } else this.tasks.push(d); this.modal.show = false; },
        isOverdue(t) { if (!t.deadline) return false; return t.deadline < new Date().toISOString(); },
        getStatusStyle(s) { return { 'todo': 'bg-slate-100 text-slate-500', 'doing': 'bg-blue-50 text-blue-600', 'done': 'bg-green-50 text-green-600' }[s]; },
        getPriorityStyle(p) { return { 'normal': 'text-blue-500', 'urgent': 'text-orange-500', 'critical': 'text-red-500' }[p]; },
        formatTimeOnly(d) { return d && d.includes('T') ? d.split('T')[1] : ''; },
        formatDateTime(d) { return d ? d.replace('T', ' ') : ''; },

        // --- AI 逻辑修复：删除成功后的弹窗提示 ---
        confirmAiTask(taskData, msgIndex) {
            this.tasks.push(taskData);
            this.chatHistory[msgIndex].confirmed = true;
            // 去掉原本推送到 chatHistory 的成功信息
            this.$nextTick(() => this.scrollToBottom());
        },

        async sendAiMessage() {
            const text = this.aiInput.trim();
            if (!text) return;
            this.chatHistory.push({ role: 'user', type: 'text', content: text });
            this.aiInput = '';
            this.chatHistory.push({ role: 'assistant', type: 'loading' });
            this.$nextTick(() => this.scrollToBottom());
            try {
                const result = await this.analyzeAiIntent(text);
                this.chatHistory.pop();
                if (result) {
                    this.chatHistory.push({ role: 'assistant', type: 'task_card', data: result, confirmed: false });
                }
            } catch (e) { this.chatHistory.pop(); }
        },

        async analyzeAiIntent(userText) {
            const nowStr = new Date().toISOString().replace('Z', '').substring(0, 16);
            const systemInstructions = `你是一个任务管理助手。当前时间：${nowStr}。请严格遵守以下规则：根据用户的输入生成一个 JSON 对象。格式必须为：{"title":"任务名", "date":"YYYY-MM-DDTHH:mm", "priority":"normal/urgent", "note":""}`;
            const VERCEL_HOST = 'https://www.yuyuworkplan-pro.xyz'; 
            try {
                const response = await fetch(`${VERCEL_HOST}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: systemInstructions + "\n\n用户输入: " + userText })
                });
                const data = await response.json();
                const aiRaw = data.choices?.[0]?.message?.content || "";
                const cleanJsonStr = aiRaw.replace(/```json/g, '').replace(/```/g, '').trim();
                const parsed = JSON.parse(cleanJsonStr);
                return {
                    id: Date.now().toString(),
                    title: parsed.title || "新任务",
                    date: (parsed.date || this.today + "T09:00").replace(' ', 'T'),
                    status: 'todo',
                    priority: parsed.priority || 'normal',
                    subtasks: [],
                    note: parsed.note || '',
                    groupId: this.activeGroupId === 'all' ? '' : this.activeGroupId
                };
            } catch (error) { throw new Error("解析失败"); }
        },
        scrollToBottom() {
            const container = this.$refs.chatContainer;
            if (container) container.scrollTop = container.scrollHeight;
        }
    }
}).mount('#app');