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
            lastDataHash: '',

            // AI 相关
            aiInput: '',
            chatHistory: [],
            showAiPanel: false,

            // 业务数据
            today: new Date().toISOString().split('T')[0],
            viewDate: new Date().toISOString().split('T')[0],
            now: new Date(),
            currentView: 'dashboard',
            
            groups: [], // 新增分组数据
            activeGroupId: 'all', // 当前选中的分组页

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
            statsGroupId: 'all', // 统计页的分组筛选
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
            let list = this.scheduledTasks.filter(s => s.enabled && s.repeatDays.includes(targetDay === 0 ? 7 : targetDay));
            if (this.activeGroupId !== 'all') {
                list = list.filter(t => (t.groupId || '') === this.activeGroupId);
            }
            return list.map(s => ({ ...s, id: 'preview_' + s.id, status: 'todo', isPreview: true }));
        },
        activeTasks() {
            const list = this.tasks.filter(t => {
                const taskDate = t.date.split('T')[0];
                if (t.status === 'done') return false;
                
                if (this.viewDate === this.today) {
                    // 今日看板放行所有未来的任务，不再用 taskDate > this.today 拦截
                } else {
                    if (taskDate !== this.viewDate) return false;
                }
                
                // 过滤分组
                if (this.activeGroupId !== 'all' && (t.groupId || '') !== this.activeGroupId) {
                    return false;
                }
                
                return true;
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
                
                if (this.viewDate === this.today) {
                    if (t.date.split('T')[0] !== this.today && !(t.completedDate && t.completedDate.split('T')[0] === this.today)) {
                        return false;
                    }
                } else {
                    if (t.date.split('T')[0] !== this.viewDate) return false;
                }

                if (this.activeGroupId !== 'all' && (t.groupId || '') !== this.activeGroupId) {
                    return false;
                }

                return true;
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
            
            // 新增：分组筛选逻辑
            if (this.statsGroupId !== 'all') {
                list = list.filter(t => (t.groupId || '') === this.statsGroupId);
            }

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

        setInterval(() => {
            this.now = new Date();
            const nowIso = new Date(this.now.getTime() - (this.now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
            let tasksChanged = false;

            this.tasks.forEach(t => {
                if (t.status === 'todo' && t.date && t.date <= nowIso) {
                    t.status = 'doing';
                    this.updateStatus(t);
                    tasksChanged = true;
                }
            });

            if (this.currentView === 'dashboard' && this.viewDate === this.today) {
                this.checkScheduledTasks();
            }

            if (tasksChanged && this.userId) {
                this.saveData();
            }
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
                this.templates.forEach(t => { if (t.groupId === id) t.groupId = ''; });
                this.scheduledTasks.forEach(t => { if (t.groupId === id) t.groupId = ''; });
            }
        },

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
        
        logout(skipConfirm = false) { 
            if (skipConfirm || confirm("确定要退出当前账号吗？")) { 
                localStorage.removeItem('planpro_access_key'); 
                localStorage.removeItem('planpro_user_id'); 
                this.accessKey = null; 
                this.userId = null;
                this.inputKey = ''; 
                this.inputPassword = '';
                this.tasks = []; 
                this.templates = []; 
                this.scheduledTasks = []; 
                this.groups = [];
            } 
        },

        // --- 新增注销账号逻辑 ---
        async deleteAccount() {
            const pwd = prompt("⚠️ 危险操作：注销账号将清空您的所有云端数据！\n请输入您的密码以确认注销：");
            if (pwd === null) return; 
            if (!pwd.trim()) return alert("密码不能为空");

            this.isSyncing = 'syncing';
            try {
                // 1. 二次验证密码
                const { data, error } = await supabaseClient.rpc('verify_login', {
                    p_access_key: this.accessKey,
                    p_password: pwd
                });
                
                if (error) throw error;
                if (!data) return alert("密码错误，注销失败！");

                // 2. 密码验证成功后执行数据清理
                if (confirm("密码验证成功。最后一次确认：是否永久删除该账号下的所有数据？（此操作不可逆）")) {
                    // 并发删除所有相关表的数据
                    await Promise.all([
                        supabaseClient.from('tasks').delete().eq('user_id', this.userId),
                        supabaseClient.from('templates').delete().eq('user_id', this.userId),
                        supabaseClient.from('scheduled_tasks').delete().eq('user_id', this.userId),
                        supabaseClient.from('groups').delete().eq('user_id', this.userId)
                    ]);
                    
                    // 尝试删除可能存在的 user 表记录
                    try { await supabaseClient.from('users').delete().eq('id', this.userId); } catch (e) {}

                    alert("账号数据已成功清空并注销。");
                    this.logout(true); // 传入 true 跳过退出确认
                } else {
                    this.isSyncing = 'idle';
                }
            } catch (e) {
                console.error(e);
                alert("注销时发生错误：" + e.message);
                this.isSyncing = 'error';
            }
        },

        async loadData() {
            this.isSyncing = 'syncing';
            try {
                let groupsRes = { data: [] };
                try {
                    groupsRes = await supabaseClient.from('groups').select('*').eq('user_id', this.userId);
                    if (groupsRes.error) throw groupsRes.error;
                } catch (e) {
                    console.warn("未能获取 groups 表，可能是数据库还未执行 SQL，分组功能将仅在本地运行 。", e);
                }

                const [tasksRes, templatesRes, scheduledRes] = await Promise.all([
                    supabaseClient.from('tasks').select('*').eq('user_id', this.userId),
                    supabaseClient.from('templates').select('*').eq('user_id', this.userId),
                    supabaseClient.from('scheduled_tasks').select('*').eq('user_id', this.userId)
                ]);

                this.groups = groupsRes.data || [];

                this.tasks = (tasksRes.data || []).map(t => ({
                    ...t,
                    date: t.plan_date ? t.plan_date.substring(0, 16) : '',
                    deadline: t.deadline ? t.deadline.substring(0, 16) : '',
                    startTime: t.start_time ? t.start_time.substring(0, 16) : null,
                    completedDate: t.completed_date ? t.completed_date.substring(0, 16) : null,
                    isFromSchedule: t.is_from_schedule,
                    groupId: t.group_id || '',
                    expanded: false
                }));

                this.templates = (templatesRes.data || []).map(t => ({
                    ...t,
                    groupId: t.group_id || ''
                }));

                this.scheduledTasks = (scheduledRes.data || []).map(s => ({
                    ...s,
                    repeatDays: s.repeat_days || [],
                    lastGeneratedDate: s.last_generated_date,
                    groupId: s.group_id || ''
                }));

                this.lastDataHash = this.generateDataHash();

                this.isSyncing = 'done';
                setTimeout(() => { if (this.isSyncing === 'done') this.isSyncing = 'idle'; }, 2000);
                this.checkScheduledTasks();
            } catch (e) { 
                console.error(e); 
                this.isSyncing = 'error'; 
            }
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
                        group_id: t.groupId || null,
                        updated_at: new Date().toISOString()
                    }));

                    const dbTemplates = this.templates.map(t => ({
                        id: t.id,
                        user_id: this.userId,
                        title: t.title,
                        priority: t.priority || 'normal',
                        note: t.note || '',
                        subtasks: t.subtasks || [],
                        group_id: t.groupId || null
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
                        last_generated_date: s.lastGeneratedDate || null,
                        group_id: s.groupId || null
                    }));

                    const dbGroups = this.groups.map(g => ({
                        id: g.id,
                        user_id: this.userId,
                        name: g.name
                    }));

                    const promises = [];
                    if (dbTasks.length > 0) promises.push(supabaseClient.from('tasks').upsert(dbTasks));
                    if (dbTemplates.length > 0) promises.push(supabaseClient.from('templates').upsert(dbTemplates));
                    if (dbScheduled.length > 0) promises.push(supabaseClient.from('scheduled_tasks').upsert(dbScheduled));
                    
                    if (dbGroups.length > 0) {
                        try {
                            promises.push(supabaseClient.from('groups').upsert(dbGroups));
                        } catch(e) {}
                    }

                    await Promise.all(promises);

                    this.isSyncing = 'done';
                    setTimeout(() => { if (this.isSyncing === 'done') this.isSyncing = 'idle'; }, 3000);
                } catch (error) { 
                    console.error("保存失败:", error);
                    this.isSyncing = 'error'; 
                }
            }, 1500); 
        },

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

        onScheduleToggle(sch) {
            if (sch.enabled) {
                const yesterday = new Date(this.now);
                yesterday.setDate(yesterday.getDate() - 1);
                sch.lastGeneratedDate = yesterday.toISOString().split('T')[0];
            }
        },

        checkScheduledTasks() {
            const todayDate = new Date(this.today); 
            let addedCount = 0;
            
            this.scheduledTasks.forEach(sch => {
                if (!sch.enabled) return;
                
                if (!sch.lastGeneratedDate) {
                    const yesterday = new Date(todayDate);
                    yesterday.setDate(yesterday.getDate() - 1);
                    sch.lastGeneratedDate = yesterday.toISOString().split('T')[0];
                }

                let checkDate = new Date(sch.lastGeneratedDate);
                checkDate.setDate(checkDate.getDate() + 1);

                while (checkDate <= todayDate) {
                    const dayOfWeek = checkDate.getDay();
                    if (sch.repeatDays.includes(dayOfWeek)) {
                        const taskTime = checkDate.toISOString().split('T')[0] + 'T09:00';
                        const newNote = `${taskTime} ${sch.note || ''}`.trim();
                        
                        this.tasks.push({ 
                            id: Date.now() + Math.random().toString(36).substr(2, 5), 
                            title: sch.title, 
                            status: 'todo', 
                            priority: sch.priority, 
                            date: taskTime, 
                            deadline: '', 
                            note: newNote, 
                            subtasks: JSON.parse(JSON.stringify(sch.subtasks || [])), 
                            expanded: false, 
                            isFromSchedule: true,
                            groupId: sch.groupId || ''
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

        exportData() { const blob = new Blob([JSON.stringify({ tasks: this.tasks, templates: this.templates, scheduledTasks: this.scheduledTasks, groups: this.groups }, null, 2)], { type: "application/json" }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `backup_${this.today}.json`; a.click(); },
        
        importData(event) {
            const file = event.target.files[0]; if (!file) return;
            const reader = new FileReader(); reader.onload = (e) => {
                try { const json = JSON.parse(e.target.result); if (json.tasks) this.tasks = json.tasks; if (json.templates) this.templates = json.templates; if (json.scheduledTasks) this.scheduledTasks = json.scheduledTasks; if(json.groups) this.groups = json.groups; alert("导入成功！(稍后会自动同步至云端)"); } catch { alert('无效文件'); }
                event.target.value = '';
            }; reader.readAsText(file);
        },

        dragStart(i, e) { this.draggingIndex = i; },
        dragDrop(to) { const arr = this.modal.data.subtasks; const item = arr.splice(this.draggingIndex, 1)[0]; arr.splice(to, 0, item); },
        
        toggleSubtask(task, sub) { 
            sub.status = sub.status === 'done' ? 'todo' : 'done'; 
            
            if (sub.status === 'done') {
                if (task.subtasks.every(s => s.status === 'done')) {
                    task.status = 'done';
                    this.updateStatus(task);
                } else if (task.status === 'todo') {
                    task.status = 'doing';
                    this.updateStatus(task);
                }
            } else {
                if (task.status === 'done') {
                    task.status = 'doing';
                    this.updateStatus(task);
                }
            }
        },

        updateStatus(task) { 
            const nowIso = new Date(this.now.getTime() - (this.now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16); 
            
            if (task.status === 'doing') { 
                if (!task.startTime) task.startTime = nowIso; 
                if (!task.date) task.date = nowIso; 
                task.completedDate = null; 
            } else if (task.status === 'done') { 
                if (!task.startTime) task.startTime = nowIso; 
                if (!task.date) task.date = nowIso;           
                task.completedDate = nowIso; 
                if (task.subtasks) task.subtasks.forEach(s => s.status = 'done'); 
            } else { 
                task.startTime = null; 
                task.completedDate = null; 
            } 
        },

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
        
        loadTemplate(e) { 
            const t = this.templates.find(x => x.id === e.target.value); 
            if (t) { 
                this.modal.data.title = t.title; 
                this.modal.data.priority = t.priority; 
                this.modal.data.subtasks = JSON.parse(JSON.stringify(t.subtasks)); 
            } 
            e.target.value = ''; 
        },
        
        openModal(task) { 
            this.modal.show = true; 
            this.modal.isEdit = !!task; 
            
            const defaultGroupId = this.activeGroupId === 'all' ? '' : this.activeGroupId;
            
            this.modal.data = task ? JSON.parse(JSON.stringify(task)) : { 
                id: Date.now().toString(), 
                title: '', 
                status: 'todo', 
                priority: 'normal', 
                date: this.currentView === 'dashboard' ? this.viewDate + 'T12:00' : this.today + 'T09:00', 
                subtasks: [], 
                repeatDays: [],
                groupId: defaultGroupId 
            }; 
        },
        
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
            this.chatHistory[msgIndex].confirmed = true;
            this.chatHistory.push({ 
                role: 'assistant', 
                type: 'text', 
                content: `✅ 任务 "${taskData.title}" 已成功添加到列表！\n(注: 若未在看板显示，请检查任务日期或左上方分组是否匹配)` 
            });
            this.$nextTick(() => this.scrollToBottom());
        },

        async analyzeAiIntent(userText) {
            const now = new Date();
            const nowIso = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
            
            const systemInstructions = `你是一个严格的 API 接口，负责将自然语言转化为 JSON。当前时间：${nowIso}。
请严格遵守以下规则：
1. 必须且只能输出合法的 JSON 对象。
2. 绝不能包含任何 markdown 代码块标记 (\`\`\`)。
3. 绝不能输出任何解释性、引导性文字（如“根据输入”、“这是生成的任务”等）。
4. 格式必须严格为：{"title":"任务名", "date":"YYYY-MM-DDTHH:mm", "priority":"normal/urgent", "note":""}。
5. 日期中的 T 是强制要求的，绝不能用空格或斜杠！
只允许输出 JSON 字符串，不要有其他任何字符。`;

            const fullMessage = `${systemInstructions}\n\n用户输入: ${userText}`;

            const VERCEL_HOST = 'https://www.yuyuworkplan-pro.xyz'; 
            let aiRawContent = "";
            
            try {
                const response = await fetch(`${VERCEL_HOST}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: fullMessage })
                });

                if (!response.ok) throw new Error(`API 响应错误: ${response.status}`);

                const data = await response.json();
                aiRawContent = data.choices?.[0]?.message?.content || data.reply || data.response || ""; 
                
                if (!aiRawContent) {
                    console.error("未获取到 AI 回复，API完整返回:", data);
                    throw new Error("API返回为空");
                }

                let cleanJsonStr = aiRawContent.replace(/`{3}(?:json)?/gi, '').trim();
                const jsonMatch = cleanJsonStr.match(/\{[\s\S]*\}/);
                
                if (jsonMatch) {
                    cleanJsonStr = jsonMatch[0];
                } else {
                    console.error("未能找到 JSON 结构, AI 原文:", aiRawContent);
                    throw new Error("AI 未能生成有效的任务格式，请换个说法重试。"); 
                }

                let parsed;
                try {
                    parsed = JSON.parse(cleanJsonStr);
                } catch (parseErr) {
                    console.warn("初次 JSON 解析失败，尝试自动修复格式...", parseErr);
                    const fixedStr = cleanJsonStr
                        .replace(/“|”/g, '"') 
                        .replace(/'/g, '"') 
                        .replace(/,\s*([\}\]])/g, '$1'); 
                    parsed = JSON.parse(fixedStr);
                }

                if (Array.isArray(parsed) && parsed.length > 0) {
                    parsed = parsed[0];
                }

                let aiDate = parsed.date || this.today + "T09:00";
                aiDate = aiDate.replace(' ', 'T').replace(/\//g, '-'); 
                if (aiDate.length === 10) aiDate += "T09:00"; 
                if (aiDate.length > 16) aiDate = aiDate.substring(0, 16); 

                return {
                    id: Date.now().toString() + Math.random().toString(36).substr(2, 5), 
                    title: parsed.title || "未命名任务",
                    date: aiDate,
                    status: 'todo',
                    priority: parsed.priority || 'normal',
                    subtasks: [],
                    note: parsed.note || '',
                    groupId: this.activeGroupId === 'all' ? '' : this.activeGroupId,
                    expanded: false,
                    deadline: '',
                    startTime: null,
                    completedDate: null,
                    isFromSchedule: false
                };
            } catch (error) {
                console.error("===== AI 解析失败 =====");
                console.error("AI 原始返回字符串:", aiRawContent);
                console.error("最终报错信息:", error);
                throw new Error(error.message.includes("Unexpected token") ? "AI 生成的数据格式异常，请稍后再试。" : error.message);
            }
        },

        scrollToBottom() {
            const container = this.$refs.chatContainer || this.$refs.chatContainerMobile;
            if (container) container.scrollTop = container.scrollHeight;
        }
    }
}).mount('#app');