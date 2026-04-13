// --- Supabase 配置 ---
const SUPABASE_URL = 'https://scjswpjktydojedqywxq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_TSXrb7sbhV7l5hgqjC0KuA_dVdxmSpu';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const { createApp } = Vue;

createApp({
    data() {
        return {
            // V4 身份与鉴权
            isRegisterMode: false,
            accessKey: null,
            userId: null,
            inputKey: '',
            inputPassword: '',
            
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
        const savedId = localStorage.getItem('planpro_user_id');
        if (savedKey && savedId) { 
            this.accessKey = savedKey; 
            this.userId = savedId;
            this.loadData(); 
        }
        this.setStatsRange('week');
        setInterval(() => { this.now = new Date(); if (this.currentView === 'dashboard' && this.viewDate === this.today) this.checkScheduledTasks(); }, 60000);
    },
    watch: {
        // 监听前端数组变动，触发数据库分表自动保存
        tasks: { handler() { if (this.userId) this.saveData(); }, deep: true },
        templates: { handler() { if (this.userId) this.saveData(); }, deep: true },
        scheduledTasks: { handler() { if (this.userId) this.saveData(); }, deep: true }
    },
    methods: {
        // === V4.0 安全鉴权 ===
        async handleAuth() {
            if (!this.inputKey.trim() || !this.inputPassword.trim()) return alert("账号和密码不能为空");
            
            this.isSyncing = 'syncing';
            try {
                if (this.isRegisterMode) {
                    const { data, error } = await supabaseClient.rpc('register_user', { p_access_key: this.inputKey.trim(), p_password: this.inputPassword });
                    if (error) throw new Error(error.message.includes('unique') ? '该账号已被注册' : error.message);
                    this.userId = data;
                    alert("注册成功！已为您自动登录。");
                } else {
                    const { data, error } = await supabaseClient.rpc('verify_login', { p_access_key: this.inputKey.trim(), p_password: this.inputPassword });
                    if (error) throw error;
                    if (!data) return alert("账号或密码错误");
                    this.userId = data;
                }
                
                this.accessKey = this.inputKey.trim();
                localStorage.setItem('planpro_access_key', this.accessKey);
                localStorage.setItem('planpro_user_id', this.userId);
                
                await this.loadData();
            } catch (e) {
                console.error(e);
                alert("错误: " + e.message);
                this.isSyncing = 'error';
            }
        },
        
        logout() { 
            if (confirm("确定要退出当前账号吗？")) { 
                localStorage.removeItem('planpro_access_key'); 
                localStorage.removeItem('planpro_user_id'); 
                this.accessKey = null; 
                this.userId = null;
                this.inputKey = ''; 
                this.inputPassword = '';
                this.tasks = []; 
                this.templates = []; 
                this.scheduledTasks = []; 
            } 
        },

        // === V4.0 从数据库分表加载数据 ===
        async loadData() {
            this.isSyncing = 'syncing';
            try {
                // 并行从三张表读取
                const [tasksRes, templatesRes, scheduledRes] = await Promise.all([
                    supabaseClient.from('tasks').select('*').eq('user_id', this.userId),
                    supabaseClient.from('templates').select('*').eq('user_id', this.userId),
                    supabaseClient.from('scheduled_tasks').select('*').eq('user_id', this.userId)
                ]);

                // 字段映射：数据库 (下划线) -> 前端 (驼峰)
                this.tasks = (tasksRes.data || []).map(t => ({
                    ...t,
                    date: t.plan_date ? t.plan_date.substring(0, 16) : '',
                    deadline: t.deadline ? t.deadline.substring(0, 16) : '',
                    startTime: t.start_time ? t.start_time.substring(0, 16) : null,
                    completedDate: t.completed_date ? t.completed_date.substring(0, 16) : null,
                    isFromSchedule: t.is_from_schedule,
                    expanded: false
                }));

                this.templates = templatesRes.data || [];

                this.scheduledTasks = (scheduledRes.data || []).map(s => ({
                    ...s,
                    repeatDays: s.repeat_days || [],
                    lastGeneratedDate: s.last_generated_date
                }));

                this.isSyncing = 'done';
                setTimeout(() => { if (this.isSyncing === 'done') this.isSyncing = 'idle'; }, 2000);
                this.checkScheduledTasks();
            } catch (e) { 
                console.error(e); 
                this.isSyncing = 'error'; 
            }
        },

        // === V4.0 保存数据到数据库分表 ===
        saveData() {
            if (!this.userId) return;
            
            this.isSyncing = 'syncing';
            if (this.saveTimer) clearTimeout(this.saveTimer);

            this.saveTimer = setTimeout(async () => {
                try {
                    // 字段映射：前端 (驼峰) -> 数据库 (下划线)
                    const dbTasks = this.tasks.map(t => ({
                        id: t.id,
                        user_id: this.userId,
                        title: t.title,
                        status: t.status,
                        priority: t.priority,
                        plan_date: t.date || null,
                        deadline: t.deadline || null,
                        start_time: t.startTime || null,
                        completed_date: t.completedDate || null,
                        note: t.note || '',
                        subtasks: t.subtasks || [],
                        is_from_schedule: t.isFromSchedule || false,
                        updated_at: new Date().toISOString()
                    }));

                    const dbTemplates = this.templates.map(t => ({
                        id: t.id,
                        user_id: this.userId,
                        title: t.title,
                        priority: t.priority || 'normal',
                        note: t.note || '',
                        subtasks: t.subtasks || []
                    }));

                    const dbScheduled = this.scheduledTasks.map(s => ({
                        id: s.id,
                        user_id: this.userId,
                        title: s.title,
                        enabled: s.enabled,
                        repeat_days: s.repeatDays || [],
                        priority: s.priority || 'normal',
                        note: s.note || '',
                        subtasks: s.subtasks || [],
                        last_generated_date: s.lastGeneratedDate || null
                    }));

                    // 并发执行 Upsert (有则更新，无则插入)
                    const promises = [];
                    if (dbTasks.length > 0) promises.push(supabaseClient.from('tasks').upsert(dbTasks));
                    if (dbTemplates.length > 0) promises.push(supabaseClient.from('templates').upsert(dbTemplates));
                    if (dbScheduled.length > 0) promises.push(supabaseClient.from('scheduled_tasks').upsert(dbScheduled));

                    await Promise.all(promises);

                    this.isSyncing = 'done';
                    setTimeout(() => { if (this.isSyncing === 'done') this.isSyncing = 'idle'; }, 3000);
                } catch (error) { 
                    console.error("保存失败:", error);
                    this.isSyncing = 'error'; 
                }
            }, 1500); // 1.5秒防抖
        },

        // === V4.0 删除数据 (由于 Upsert 无法删除不存在的数据，需单独处理) ===
        async deleteTask(id) { 
            if (confirm('确定删除？')) { 
                try {
                    if (this.currentView === 'dashboard') {
                        this.tasks = this.tasks.filter(t => t.id !== id);
                        await supabaseClient.from('tasks').delete().eq('id', id);
                    } else if (this.currentView === 'templates') {
                        this.templates = this.templates.filter(t => t.id !== id);
                        await supabaseClient.from('templates').delete().eq('id', id);
                    } else {
                        this.scheduledTasks = this.scheduledTasks.filter(t => t.id !== id);
                        await supabaseClient.from('scheduled_tasks').delete().eq('id', id);
                    }
                    if (this.activeTask?.id === id) this.activeTask = null; 
                } catch(e) { console.error("删除失败:", e) }
            } 
        },

        checkScheduledTasks() {
            const todayDate = new Date(this.today); let addedCount = 0;
            this.scheduledTasks.forEach(sch => {
                if (!sch.enabled) return;
                let checkDate = sch.lastGeneratedDate ? new Date(new Date(sch.lastGeneratedDate).setDate(new Date(sch.lastGeneratedDate).getDate() + 1)) : new Date(todayDate);
                while (checkDate <= todayDate) {
                    const dayOfWeek = checkDate.getDay();
                    if (sch.repeatDays.includes(dayOfWeek)) {
                        const taskTime = checkDate.toISOString().split('T')[0] + 'T09:00';
                        this.tasks.push({ 
                            id: Date.now() + Math.random().toString(36).substr(2, 5), 
                            title: sch.title, 
                            status: 'todo', 
                            priority: sch.priority, 
                            date: taskTime, 
                            deadline: '', 
                            note: `计划开始时间：${taskTime}\n${sch.note || ''}`, 
                            subtasks: JSON.parse(JSON.stringify(sch.subtasks)), 
                            expanded: false, 
                            isFromSchedule: true 
                        });
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

        handleClearData() { 
            alert("该版本由数据库直接接管，防止误操作暂关删库功能。如需清除请逐项删除。"); 
        },

        exportData() { const blob = new Blob([JSON.stringify({ tasks: this.tasks, templates: this.templates, scheduledTasks: this.scheduledTasks }, null, 2)], { type: "application/json" }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `backup_${this.today}.json`; a.click(); },
        
        // 普通覆盖导入
        importData(event) {
            const file = event.target.files[0]; if (!file) return;
            const reader = new FileReader(); reader.onload = (e) => {
                try { const json = JSON.parse(e.target.result); if (json.tasks) this.tasks = json.tasks; if (json.templates) this.templates = json.templates; if (json.scheduledTasks) this.scheduledTasks = json.scheduledTasks; alert("导入成功！(稍后会自动同步至云端)"); } catch { alert('无效文件'); }
                event.target.value = '';
            }; reader.readAsText(file);
        },

        // ⭐ 新增：智能追加导入旧数据
        async importOldData(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const json = JSON.parse(e.target.result);
                    let importCount = 0;

                    // 1. 合并任务 (去重：跳过 ID 已存在的任务)
                    if (json.tasks && Array.isArray(json.tasks)) {
                        const existingIds = new Set(this.tasks.map(t => t.id));
                        const newTasks = json.tasks.filter(t => !existingIds.has(t.id));
                        this.tasks = [...this.tasks, ...newTasks];
                        importCount += newTasks.length;
                    }

                    // 2. 合并模板
                    if (json.templates && Array.isArray(json.templates)) {
                        const existingIds = new Set(this.templates.map(t => t.id));
                        const newTmpls = json.templates.filter(t => !existingIds.has(t.id));
                        this.templates = [...this.templates, ...newTmpls];
                        importCount += newTmpls.length;
                    }

                    // 3. 合并定时任务
                    if (json.scheduledTasks && Array.isArray(json.scheduledTasks)) {
                        const existingIds = new Set(this.scheduledTasks.map(t => t.id));
                        const newSch = json.scheduledTasks.filter(t => !existingIds.has(t.id));
                        this.scheduledTasks = [...this.scheduledTasks, ...newSch];
                        importCount += newSch.length;
                    }

                    if (importCount > 0) {
                        alert(`🎉 成功导入了 ${importCount} 条历史数据！系统将自动保存至云端。`);
                        // vue watcher 会检测到数组变化并自动触发 saveData()
                    } else {
                        alert('✅ 文件解析成功，但没有发现新数据（该备份内的数据可能已被导入过）。');
                    }
                } catch (err) {
                    console.error(err);
                    alert('文件解析失败，请确保您选择的是之前导出的 JSON 备份文件。');
                }
                // 清空 input 值，允许连续导入同一个文件
                event.target.value = '';
            };
            reader.readAsText(file);
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

        // === AI 助手核心逻辑 ===
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
                    this.chatHistory.push({
                        role: 'assistant',
                        type: 'task_card',
                        data: result,
                        confirmed: false
                    });
                } else {
                    this.chatHistory.push({ role: 'assistant', type: 'text', content: 'AI 似乎没有理解，请尝试描述得更具体一点。' });
                }
            } catch (error) {
                this.chatHistory.pop();
                console.error(error);
                this.chatHistory.push({ role: 'assistant', type: 'text', content: `请求出错: ${error.message}` });
            }
            this.$nextTick(() => this.scrollToBottom());
        },

        confirmAiTask(taskData, msgIndex) {
            this.tasks.push(taskData);
            // 保存由 Watcher 自动接管
            this.chatHistory[msgIndex].confirmed = true;
            this.chatHistory.push({ role: 'assistant', type: 'text', content: `✅ 任务 "${taskData.title}" 已成功添加到列表！` });
            this.$nextTick(() => this.scrollToBottom());
        },

        scrollToBottom() {
            const container = this.$refs.chatContainer || this.$refs.chatContainerMobile;
            if (container) container.scrollTop = container.scrollHeight;
        },

        async analyzeAiIntent(userText) {
            const nowStr = new Date().toLocaleString('zh-CN', { hour12: false });
            const systemInstructions = `你是一个任务管理助手。当前时间：${nowStr}。请根据用户的自然语言输入生成一个任务 JSON。包含字段: title, date(YYYY-MM-DDTHH:mm), priority(normal/urgent), note。`;

            const fullMessage = `${systemInstructions}\n\n用户输入: ${userText}`;

            const VERCEL_HOST = 'https://www.yuyuworkplan-pro.xyz'; 
            
            try {
                const response = await fetch(`${VERCEL_HOST}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: fullMessage })
                });

                if (!response.ok) throw new Error(`API 响应错误: ${response.status}`);

                const data = await response.json();
                const aiRawContent = data.choices?.[0]?.message?.content;
                if (!aiRawContent) return null;

                const cleanJsonStr = aiRawContent.replace(/```json/g, '').replace(/```/g, '').trim();
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
                throw error;
            }
        }
    }
}).mount('#app');
